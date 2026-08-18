/**
 * Error -> retry decision mapping (book ch5: classify before retrying).
 * The loop keeps retrying recoverable infrastructure noise and fails fast on
 * deterministic input/authorization errors.
 */

export type RetryDecision = 'retry' | 'no_retry' | 'escalate';

const RETRY_PATTERNS: Array<{ pattern: RegExp; decision: RetryDecision }> = [
  {
    pattern: /timeout|timed out|network|fetch|connection|429|50[0-9]|llm_failed|json_parse_failed|no_action/i,
    decision: 'retry',
  },
  {
    pattern: /invalid input|invalid_input|unknown action|permission|forbidden|unauthorized|not found|not_found/i,
    decision: 'no_retry',
  },
  { pattern: /max failures|max_failures|max steps|max_steps/i, decision: 'escalate' },
];

export function classifyRetry(error: unknown): RetryDecision {
  const message = error instanceof Error ? error.message : String(error ?? '');
  for (const rule of RETRY_PATTERNS) {
    if (rule.pattern.test(message)) return rule.decision;
  }
  return 'retry';
}
