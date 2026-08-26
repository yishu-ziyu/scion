import {
  resolveFeatureModel,
  type FeatureBinding,
  type FeatureRequirement,
  type FeatureResolution,
  type ModelDescriptor,
  type ProviderProfile,
} from '@extension/contracts';
import type { AgentRuntime, RuntimeFactory } from './types';

/**
 * Read-only key lookup injected by the host (e.g. a chrome.storage-backed
 * vault). This package never imports chrome.* itself; the vault boundary is
 * this function signature.
 */
export type GetApiKey = (apiKeyRef: string) => Promise<string | null> | string | null;

export interface SelectRuntimeInput {
  featureId: string;
  bindings: FeatureBinding[];
  requirements: FeatureRequirement[];
  providers: ProviderProfile[];
  models: ModelDescriptor[];
  factory: RuntimeFactory;
}

export type SelectRuntimeResult =
  | {
      ok: true;
      featureId: string;
      via: 'primary' | 'fallback';
      provider: ProviderProfile;
      model: ModelDescriptor;
      runtime: AgentRuntime;
    }
  | { ok: false; reason: 'unresolved'; featureId: string; resolution: FeatureResolution }
  | {
      ok: false;
      reason: 'missing_api_key';
      featureId: string;
      apiKeyRef: string;
      provider: ProviderProfile;
      model: ModelDescriptor;
    };

/**
 * Pick the model for a feature and build a runtime for it. Pure apart from
 * the injected key lookup: no I/O, no storage import, no clock.
 *
 * Resolution runs first; the vault is touched only for the winning provider.
 */
export async function selectRuntime(input: SelectRuntimeInput, getApiKey: GetApiKey): Promise<SelectRuntimeResult> {
  const { featureId, factory } = input;
  const resolution = resolveFeatureModel({
    featureId,
    bindings: input.bindings,
    requirements: input.requirements,
    providers: input.providers,
    models: input.models,
  });

  if (!resolution.ok) {
    return { ok: false, reason: 'unresolved', featureId, resolution };
  }

  const { provider, model } = resolution;
  const apiKey = await getApiKey(provider.apiKeyRef);
  if (!apiKey) {
    return { ok: false, reason: 'missing_api_key', featureId, apiKeyRef: provider.apiKeyRef, provider, model };
  }

  return {
    ok: true,
    featureId,
    via: resolution.via,
    provider,
    model,
    runtime: factory(model, apiKey, provider),
  };
}
