import { z } from 'zod';
import { CapabilitySchema } from './capabilities';

export const AdapterTypeSchema = z.enum([
  'native_openai',
  'native_anthropic',
  'native_google',
  'openai_compatible',
  'gateway',
]);

export type AdapterType = z.infer<typeof AdapterTypeSchema>;

/**
 * One configured endpoint. `apiKeyRef` names a secret held elsewhere; the key
 * material itself never enters this contract.
 *
 * `declaredCapabilities` is the only source of truth for what this endpoint
 * can do. `adapterType` selects the wire protocol and nothing else: an
 * `openai_compatible` endpoint is NOT assumed to support vision, tool
 * calling, or anything else until the user declares it here.
 */
export const ProviderProfileSchema = z.object({
  id: z.string().min(1),
  adapterType: AdapterTypeSchema,
  baseUrl: z.string().url().optional(),
  apiKeyRef: z.string().min(1),
  customHeaders: z.record(z.string()).optional(),
  enabled: z.boolean(),
  declaredCapabilities: z.array(CapabilitySchema),
});

export type ProviderProfile = z.infer<typeof ProviderProfileSchema>;
