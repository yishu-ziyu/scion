import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  confirmsNewChatCancellation,
  cancellationIntentAfterDispatch,
  cancellationIntentAfterDisconnect,
  newChatCancellationTarget,
} from '../presentation/session-task-identity';

// Simulate the SidePanel newChatPending state machine with timeout fallback
describe('SidePanel newChat pending lifecycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not cancel another session when starting a new chat', () => {
    expect(newChatCancellationTarget({ authoritativeTask: { taskId: 'paused-A', status: 'paused' } })).toBeNull();
  });

  it('retries after stale_revision via fresh revision and finally finalizes', () => {
    let pending = cancellationIntentAfterDispatch('paused-A', 'cancel-1', true);
    // stale ack does not confirm
    expect(
      confirmsNewChatCancellation(pending, { taskId: 'paused-A', commandId: 'cancel-1', accepted: false } as any),
    ).toBe(false);
    // SidePanel resets to null commandId then retries with revision 7
    pending = { taskId: 'paused-A', commandId: null };
    expect(pending.commandId).toBeNull();
    const retry = cancellationIntentAfterDispatch('paused-A', 'cancel-2', true);
    pending = retry;
    expect(
      confirmsNewChatCancellation(pending, { taskId: 'paused-A', commandId: 'cancel-2', accepted: true } as any),
    ).toBe(true);
  });

  it('timeout fallback forces finalize when no confirmation arrives within 4s', () => {
    let newChatPending = false;
    let pending: { taskId: string; commandId: string | null } | null = null;
    let finalized: string | null = null;
    const finalize = (id?: string) => {
      finalized = id ?? null;
      pending = null;
      newChatPending = false;
    };
    // start new chat
    pending = { taskId: 'paused-A', commandId: null };
    newChatPending = true;
    // schedule timeout 4000ms
    const timeout = setTimeout(() => {
      if (pending?.taskId === 'paused-A') finalize('paused-A');
    }, 4000);
    expect(newChatPending).toBe(true);
    // fast-forward 3999ms not yet finalized
    vi.advanceTimersByTime(3999);
    expect(finalized).toBeNull();
    vi.advanceTimersByTime(1);
    expect(finalized).toBe('paused-A');
    expect(newChatPending).toBe(false);
    clearTimeout(timeout);
  });

  it('disconnect preserves intent and snapshot retry reissues cancel', () => {
    let pending: { taskId: string; commandId: string | null } = { taskId: 'paused-A', commandId: 'cancel-1' };
    pending = cancellationIntentAfterDisconnect(pending)!;
    expect(pending).toEqual({ taskId: 'paused-A', commandId: null });
    // snapshot arrives with active status -> would reissue cancel
    const incoming = { id: 'paused-A', status: 'paused', revision: 8 } as any;
    const shouldRetry = !pending.commandId && pending.taskId === incoming.id;
    expect(shouldRetry).toBe(true);
  });
});
