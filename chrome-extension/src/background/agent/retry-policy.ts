/**
 * Error -> retry decision mapping.
 * Default is retry. Only fail-fast on deterministic invalid/authorization errors,
 * and escalate when the loop budget is already exhausted.
 *
 * page.ts wraps click/input throws as `Failed to click element: … Error: …`.
 * Do not put a prefix match on that wrap ahead of no_retry, or permission/invalid
 * input inside the wrap would be retried.
 * Do not use a bare `not found`: `Element: … not found` is a stale locate and must retry.
 */

export type RetryDecision = 'retry' | 'no_retry' | 'escalate';

const ESCALATE_PATTERN = /max failures|max_failures|max steps|max_steps/i;

const NO_RETRY_PATTERN =
  /invalid input|invalid_input|unknown action|permission|forbidden|unauthorized|model_not_found|session not found/i;

export function classifyRetry(error: unknown): RetryDecision {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (ESCALATE_PATTERN.test(message)) return 'escalate';
  if (NO_RETRY_PATTERN.test(message)) return 'no_retry';
  return 'retry';
}
