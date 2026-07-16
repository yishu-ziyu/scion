/**
 * Primary wait-surface control when status=waiting_user.
 * proof_required keeps criterion-confirm; all other wait reasons need continue/retry.
 */

export type WaitUserActionTestId = 'wait-continue' | 'wait-retry';

/**
 * @returns test id for the primary affordance, or null when criterion-confirm owns the surface.
 */
export function waitUserActionTestId(waitReason: string | undefined | null): WaitUserActionTestId | null {
  if (!waitReason || waitReason === 'proof_required') return null;
  // External commit uncertainty: user-owned re-check (not silent auto-retry).
  if (waitReason === 'commit_outcome_uncertain') return 'wait-retry';
  return 'wait-continue';
}
