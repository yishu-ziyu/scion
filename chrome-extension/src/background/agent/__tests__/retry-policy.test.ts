import { describe, expect, it } from 'vitest';
import { classifyRetry } from '../retry-policy';

describe('classifyRetry', () => {
  it('retries infrastructure noise', () => {
    expect(classifyRetry('request timed out')).toBe('retry');
    expect(classifyRetry('network error')).toBe('retry');
    expect(classifyRetry('llm_failed')).toBe('retry');
  });

  it('does not retry deterministic invalid calls', () => {
    expect(classifyRetry('Invalid input: index is NaN')).toBe('no_retry');
    expect(classifyRetry('unknown action')).toBe('no_retry');
    expect(classifyRetry('permission denied')).toBe('no_retry');
  });

  it('escalates budget exhaustion', () => {
    expect(classifyRetry('max failures reached')).toBe('escalate');
    expect(classifyRetry('max steps')).toBe('escalate');
  });
});
