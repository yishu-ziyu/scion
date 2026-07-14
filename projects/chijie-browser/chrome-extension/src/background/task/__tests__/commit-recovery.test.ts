import { describe, expect, it, vi } from 'vitest';
import { recoverAttempt } from '../action-dispatcher';

describe('external commit recovery', () => {
  it.each([
    ['proposed', 'proposed'],
    ['approved', 'approved'],
    ['executing', 'uncertain'],
    ['observed', 'observed'],
  ] as const)('recovers %s without executing as %s', (before, after) => {
    const executeExternalCommit = vi.fn();
    const recovered = recoverAttempt({
      id: 'attempt-1',
      roundId: 'round-1',
      actionName: 'click_element',
      effect: 'external_commit',
      argsDigest: 'args-digest',
      state: before,
      proposedAt: 100,
    });

    expect(recovered.state).toBe(after);
    expect(executeExternalCommit).not.toHaveBeenCalled();
  });
});
