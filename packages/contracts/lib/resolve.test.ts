import { describe, expect, it } from 'vitest';
import { CapabilitySchema, type Capability } from './capabilities';
import { FeatureBindingSchema, FeatureRequirementSchema } from './feature';
import { ModelDescriptorSchema, type ModelDescriptor } from './model';
import { ProviderProfileSchema, type ProviderProfile } from './provider';
import { resolveFeatureModel } from './resolve';

const openaiProvider: ProviderProfile = {
  id: 'openai',
  adapterType: 'native_openai',
  apiKeyRef: 'secret/openai',
  enabled: true,
  declaredCapabilities: ['chat', 'reasoning', 'vision', 'tool_calling', 'structured_output'],
};

const localProvider: ProviderProfile = {
  id: 'local-ollama',
  adapterType: 'openai_compatible',
  baseUrl: 'http://localhost:11434/v1',
  apiKeyRef: 'secret/ollama',
  enabled: true,
  declaredCapabilities: ['chat'],
};

const gpt4o: ModelDescriptor = {
  providerId: 'openai',
  modelId: 'gpt-4o',
  capabilities: ['chat', 'reasoning', 'vision', 'tool_calling', 'structured_output'],
  contextWindow: 128000,
  maxOutputTokens: 16384,
  supportsStreaming: true,
};

const localVision: ModelDescriptor = {
  providerId: 'local-ollama',
  modelId: 'llava-local',
  capabilities: ['chat', 'vision'],
  supportsStreaming: true,
};

const baseInput = {
  providers: [openaiProvider, localProvider],
  models: [gpt4o, localVision],
};

describe('zod schemas', () => {
  it('parses valid contracts', () => {
    expect(ProviderProfileSchema.parse(openaiProvider).id).toBe('openai');
    expect(ModelDescriptorSchema.parse(gpt4o).modelId).toBe('gpt-4o');
    expect(FeatureBindingSchema.parse({ featureId: 'f', primaryModel: 'gpt-4o' }).fallbackModels).toEqual([]);
    expect(FeatureRequirementSchema.parse({ featureId: 'f', requiredCapabilities: ['chat'] }).featureId).toBe('f');
  });

  it('rejects unknown capabilities and malformed profiles', () => {
    expect(CapabilitySchema.safeParse('mind_reading').success).toBe(false);
    expect(ModelDescriptorSchema.safeParse({ ...gpt4o, contextWindow: -1 }).success).toBe(false);
    expect(ProviderProfileSchema.safeParse({ ...openaiProvider, id: '' }).success).toBe(false);
    expect(ProviderProfileSchema.safeParse({ ...openaiProvider, adapterType: 'native_qwen' }).success).toBe(false);
  });
});

describe('resolveFeatureModel', () => {
  const bindings = [{ featureId: 'page-qa', primaryModel: 'gpt-4o', fallbackModels: ['llava-local'] }];
  const requirements = [{ featureId: 'page-qa', requiredCapabilities: ['chat', 'vision'] as Capability[] }];

  it('resolves the primary model when it is usable', () => {
    const result = resolveFeatureModel({ featureId: 'page-qa', bindings, requirements, ...baseInput });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('primary');
      expect(result.model.modelId).toBe('gpt-4o');
      expect(result.provider.id).toBe('openai');
    }
  });

  it('falls back when the primary provider is disabled', () => {
    const result = resolveFeatureModel({
      featureId: 'page-qa',
      bindings,
      requirements,
      providers: [
        { ...openaiProvider, enabled: false },
        { ...localProvider, declaredCapabilities: ['chat', 'vision'] },
      ],
      models: baseInput.models,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('fallback');
      expect(result.model.modelId).toBe('llava-local');
    }
  });

  it('fails with the exact missing capability when nobody provides it', () => {
    const result = resolveFeatureModel({
      featureId: 'page-ocr',
      bindings: [{ featureId: 'page-ocr', primaryModel: 'gpt-4o', fallbackModels: ['llava-local'] }],
      requirements: [{ featureId: 'page-ocr', requiredCapabilities: ['chat', 'ocr'] }],
      ...baseInput,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('unresolved');
      if (result.failure.kind === 'unresolved') {
        expect(result.failure.missingCapabilities).toEqual(['ocr']);
        expect(result.failure.candidates.every(c => c.reason === 'capability_missing')).toBe(true);
      }
    }
  });

  it('reports provider_disabled when the only candidate sits on a disabled provider', () => {
    const result = resolveFeatureModel({
      featureId: 'page-qa',
      bindings: [{ featureId: 'page-qa', primaryModel: 'gpt-4o', fallbackModels: [] }],
      requirements,
      providers: [{ ...openaiProvider, enabled: false }],
      models: [gpt4o],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === 'unresolved') {
      expect(result.failure.candidates).toEqual([{ modelId: 'gpt-4o', reason: 'provider_disabled' }]);
      // vision IS offered by the chain in general; the blocker here is the disabled provider,
      // which shows up in candidates, not in missingCapabilities semantics of "nobody provides it".
      expect(result.failure.missingCapabilities).toEqual(['chat', 'vision']);
    }
  });

  it('never assumes an openai_compatible endpoint has undeclared capabilities', () => {
    // The model claims vision, but the openai_compatible provider only declared chat.
    const result = resolveFeatureModel({
      featureId: 'page-qa',
      bindings: [{ featureId: 'page-qa', primaryModel: 'llava-local', fallbackModels: [] }],
      requirements,
      providers: [localProvider],
      models: [localVision],
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.failure.kind === 'unresolved') {
      expect(result.failure.missingCapabilities).toEqual(['vision']);
      expect(result.failure.candidates[0]).toMatchObject({
        reason: 'capability_missing',
        missingCapabilities: ['vision'],
      });
    }
  });

  it('serves the feature once the user declares the capability on the openai_compatible provider', () => {
    const declared: ProviderProfile = { ...localProvider, declaredCapabilities: ['chat', 'vision'] };
    const result = resolveFeatureModel({
      featureId: 'page-qa',
      bindings: [{ featureId: 'page-qa', primaryModel: 'llava-local', fallbackModels: [] }],
      requirements,
      providers: [declared],
      models: [localVision],
    });
    expect(result.ok).toBe(true);
  });

  it('fails explicitly when the feature has no binding or no requirement', () => {
    const noBinding = resolveFeatureModel({ featureId: 'ghost', bindings: [], requirements, ...baseInput });
    expect(noBinding).toMatchObject({ ok: false, failure: { kind: 'no_binding' } });

    const noRequirement = resolveFeatureModel({
      featureId: 'page-qa',
      bindings,
      requirements: [],
      ...baseInput,
    });
    expect(noRequirement).toMatchObject({ ok: false, failure: { kind: 'no_requirement' } });
  });

  it('skips a primary that lacks a capability and uses a fallback that has it', () => {
    const result = resolveFeatureModel({
      featureId: 'page-qa',
      bindings: [{ featureId: 'page-qa', primaryModel: 'llava-local', fallbackModels: ['gpt-4o'] }],
      requirements,
      ...baseInput,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('fallback');
      expect(result.model.modelId).toBe('gpt-4o');
    }
  });
});
