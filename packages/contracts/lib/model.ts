import { z } from 'zod';
import { CapabilitySchema } from './capabilities';

/**
 * One concrete model behind a provider. `capabilities` is a user-maintained
 * declaration of what this model can do; it is never derived from the
 * provider's wire format.
 */
export const ModelDescriptorSchema = z.object({
  providerId: z.string().min(1),
  modelId: z.string().min(1),
  capabilities: z.array(CapabilitySchema),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  supportsStreaming: z.boolean(),
});

export type ModelDescriptor = z.infer<typeof ModelDescriptorSchema>;
