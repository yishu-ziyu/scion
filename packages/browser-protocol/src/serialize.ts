/**
 * JSON serialization for protocol messages.
 *
 * Every message type here is plain JSON (no Dates, Maps, or class
 * instances), so serialization is stringify/parse plus schema validation
 * on the way back in. Deserialization is lossless for valid messages and
 * throws with a readable issue list for invalid ones.
 */
import type { z } from 'zod';
import { BrowserActionSchema, type BrowserAction } from './action';
import { ActionReceiptSchema, type ActionReceipt } from './receipt';
import { BrowserObservationSchema, type BrowserObservation } from './observation';
import { BrowserTargetSchema, type BrowserTarget } from './targets';

function stringify(value: object): string {
  return JSON.stringify(value);
}

function fromJson<T>(schema: z.ZodType<T>, json: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('protocol message is not valid JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`protocol message failed validation: ${issues}`);
  }
  return parsed.data;
}

export function serializeObservation(observation: BrowserObservation): string {
  return stringify(observation);
}
export function deserializeObservation(json: string): BrowserObservation {
  return fromJson(BrowserObservationSchema, json);
}

export function serializeTarget(target: BrowserTarget): string {
  return stringify(target);
}
export function deserializeTarget(json: string): BrowserTarget {
  return fromJson(BrowserTargetSchema, json);
}

export function serializeAction(action: BrowserAction): string {
  return stringify(action);
}
export function deserializeAction(json: string): BrowserAction {
  return fromJson(BrowserActionSchema, json);
}

export function serializeReceipt(receipt: ActionReceipt): string {
  return stringify(receipt);
}
export function deserializeReceipt(json: string): ActionReceipt {
  return fromJson(ActionReceiptSchema, json);
}
