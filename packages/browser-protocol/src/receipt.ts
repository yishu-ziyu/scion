/**
 * ActionReceipt (B4).
 *
 * The receipt records what the browser did, not whether the task is done.
 * There is deliberately no `isDone` field: completion is a policy verdict
 * made above this protocol.
 *
 * Status semantics:
 * - applied            the action changed page state and that was observed.
 * - no_effect          the action ran but nothing observable changed.
 * - blocked            policy/user refused before execution (deterministic).
 * - unknown            outcome indeterminate (e.g. debugger detached
 *                      mid-action); distinct from `blocked`.
 */
import { z } from 'zod';
import { BrowserErrorSchema } from './errors';

export const EvidenceRefSchema = z.object({
  kind: z.enum(['screenshot', 'dom_diff', 'text', 'url', 'media_state']),
  /** Reference into an evidence store; never the payload itself. */
  ref: z.string().min(1),
  capturedAt: z.number().int().nonnegative(),
});
export type EvidenceRef = z.infer<typeof EvidenceRefSchema>;

export const ActionReceiptStatusSchema = z.enum(['applied', 'no_effect', 'blocked', 'unknown']);
export type ActionReceiptStatus = z.infer<typeof ActionReceiptStatusSchema>;

export const ActionReceiptSchema = z.object({
  actionId: z.string().min(1),
  status: ActionReceiptStatusSchema,
  /** Protocol revision the target had before the action. */
  beforeRevision: z.string().min(1),
  /** Absent when the action never reached a state where a revision was read. */
  afterRevision: z.string().min(1).optional(),
  evidence: z.array(EvidenceRefSchema),
  error: BrowserErrorSchema.optional(),
});
export type ActionReceipt = z.infer<typeof ActionReceiptSchema>;

/** A blocked or unknown receipt must carry an error explaining itself. */
export function validateReceipt(receipt: ActionReceipt): ActionReceipt {
  if ((receipt.status === 'blocked' || receipt.status === 'unknown') && !receipt.error) {
    throw new Error(`ActionReceipt status '${receipt.status}' requires an error`);
  }
  return receipt;
}
