import { describe, expect, it } from 'vitest';
import { isFollowingForeground, setFollowCommand, takeoverCommand } from '../run-presence';

describe('run presence', () => {
  it('defaults to not following the agent tab', () => {
    expect(isFollowingForeground(undefined)).toBe(false);
    expect(isFollowingForeground({})).toBe(false);
    expect(isFollowingForeground({ followForeground: false })).toBe(false);
    expect(isFollowingForeground({ followForeground: true })).toBe(true);
  });

  it('builds follow and takeover commands against the current revision', () => {
    expect(setFollowCommand({ id: 't1', revision: 4 }, true, 'c1')).toEqual({
      type: 'set_follow',
      commandId: 'c1',
      taskId: 't1',
      expectedRevision: 4,
      follow: true,
    });
    expect(takeoverCommand({ id: 't1', revision: 4 }, 'c2')).toEqual({
      type: 'takeover',
      commandId: 'c2',
      taskId: 't1',
      expectedRevision: 4,
    });
  });
});
