import { z } from 'zod';
import { CapabilitySchema } from './capabilities';

/**
 * A product feature (summarize page, fill form, ...) bound to an ordered
 * chain of model ids. `primaryModel` is tried first; each entry in
 * `fallbackModels` is tried in order when every earlier candidate is
 * unusable.
 */
export const FeatureBindingSchema = z.object({
  featureId: z.string().min(1),
  primaryModel: z.string().min(1),
  fallbackModels: z.array(z.string().min(1)).default([]),
});

export type FeatureBinding = z.infer<typeof FeatureBindingSchema>;

/**
 * What a feature needs from its model. Kept separate from FeatureBinding so
 * the binding can be re-pointed at new models without re-stating needs.
 */
export const FeatureRequirementSchema = z.object({
  featureId: z.string().min(1),
  requiredCapabilities: z.array(CapabilitySchema).min(1),
});

export type FeatureRequirement = z.infer<typeof FeatureRequirementSchema>;
