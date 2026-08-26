import { z } from 'zod';

/**
 * Everything a model can be asked to do. This enum is the only vocabulary the
 * resolution layer reasons about; adapter wire formats never extend it.
 */
export const CapabilitySchema = z.enum([
  'chat',
  'reasoning',
  'vision',
  'tool_calling',
  'structured_output',
  'embedding',
  'rerank',
  'web_search',
  'image_generate',
  'image_edit',
  'video_generate',
  'speech_to_text',
  'text_to_speech',
  'ocr',
]);

export type Capability = z.infer<typeof CapabilitySchema>;

export const CAPABILITIES = CapabilitySchema.options;
