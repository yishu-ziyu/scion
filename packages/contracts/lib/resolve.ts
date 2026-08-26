import type { Capability } from './capabilities';
import type { FeatureBinding, FeatureRequirement } from './feature';
import type { ModelDescriptor } from './model';
import type { ProviderProfile } from './provider';

export interface ResolveFeatureModelInput {
  featureId: string;
  bindings: FeatureBinding[];
  requirements: FeatureRequirement[];
  providers: ProviderProfile[];
  models: ModelDescriptor[];
}

/** Why one candidate model in the chain was rejected. */
export interface CandidateRejection {
  modelId: string;
  reason: 'model_not_found' | 'provider_not_found' | 'provider_disabled' | 'capability_missing';
  /** Required capabilities this candidate does not provide; only set for capability_missing. */
  missingCapabilities?: Capability[];
}

export type ResolutionFailure =
  | { kind: 'no_binding'; featureId: string }
  | { kind: 'no_requirement'; featureId: string }
  | {
      kind: 'unresolved';
      featureId: string;
      /** Required capabilities that no enabled candidate provides. */
      missingCapabilities: Capability[];
      candidates: CandidateRejection[];
    };

export type FeatureResolution =
  | {
      ok: true;
      featureId: string;
      via: 'primary' | 'fallback';
      provider: ProviderProfile;
      model: ModelDescriptor;
    }
  | { ok: false; featureId: string; failure: ResolutionFailure };

/**
 * Pick the model that serves a feature. Pure: no I/O, no clock, no randomness.
 *
 * A candidate is usable only when the model exists, its provider exists and is
 * enabled, and every required capability is declared on BOTH the model and the
 * provider. Capabilities are never inferred from adapterType, so an
 * openai_compatible endpoint without a declared capability simply cannot serve
 * a feature that needs it.
 */
export function resolveFeatureModel(input: ResolveFeatureModelInput): FeatureResolution {
  const { featureId, bindings, requirements, providers, models } = input;

  const binding = bindings.find(b => b.featureId === featureId);
  if (!binding) {
    return { ok: false, featureId, failure: { kind: 'no_binding', featureId } };
  }

  const requirement = requirements.find(r => r.featureId === featureId);
  if (!requirement) {
    return { ok: false, featureId, failure: { kind: 'no_requirement', featureId } };
  }
  const required = requirement.requiredCapabilities;

  const chain = [binding.primaryModel, ...binding.fallbackModels];
  const rejections: CandidateRejection[] = [];

  for (let index = 0; index < chain.length; index += 1) {
    const modelId = chain[index];
    const model = models.find(m => m.modelId === modelId);
    if (!model) {
      rejections.push({ modelId, reason: 'model_not_found' });
      continue;
    }
    const provider = providers.find(p => p.id === model.providerId);
    if (!provider) {
      rejections.push({ modelId, reason: 'provider_not_found' });
      continue;
    }
    if (!provider.enabled) {
      rejections.push({ modelId, reason: 'provider_disabled' });
      continue;
    }
    const missing = required.filter(
      capability => !model.capabilities.includes(capability) || !provider.declaredCapabilities.includes(capability),
    );
    if (missing.length > 0) {
      rejections.push({ modelId, reason: 'capability_missing', missingCapabilities: missing });
      continue;
    }
    return { ok: true, featureId, via: index === 0 ? 'primary' : 'fallback', provider, model };
  }

  // Report which required capabilities nobody enabled can provide, so the user
  // sees "no one offers ocr" rather than a bare failure.
  const missingCapabilities = required.filter(capability =>
    chain.every(modelId => {
      const model = models.find(m => m.modelId === modelId);
      if (!model) return true;
      const provider = providers.find(p => p.id === model.providerId);
      if (!provider || !provider.enabled) return true;
      return !model.capabilities.includes(capability) || !provider.declaredCapabilities.includes(capability);
    }),
  );

  return {
    ok: false,
    featureId,
    failure: { kind: 'unresolved', featureId, missingCapabilities, candidates: rejections },
  };
}
