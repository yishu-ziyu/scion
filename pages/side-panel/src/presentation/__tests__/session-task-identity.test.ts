import { describe, expect, it } from 'vitest';
import { Actors, type Message, type TaskSnapshot } from '@extension/storage';
import { completionChatDelivery } from '../completion-chat-delivery';
import {
  cancellationIntentAfterDisconnect,
  cancellationIntentAfterDispatch,
  canBeginExclusiveTaskLaunch,
  canExposeMessageRecoveryActions,
  canFollowUpInOwnedSession,
  canDispatchTaskCommand,
  confirmsNewChatCancellation,
  historicalProjectionAfterHistoryBack,
  hasPendingLifecycleCommand,
  isCurrentAsyncSessionResult,
  isRejectedTaskLaunchAck,
  mergeAuthoritativeTaskSnapshot,
  modelHistoryForTurn,
  newChatCancellationTarget,
  pendingStartAfterPostFailure,
  displayContentForStoredMessage,
  projectMessagesForDisplay,
  protectedLiveHistorySessionId,
  recoverySessionOwner,
  shouldAcceptHistorySnapshot,
  shouldAcceptTaskSignal,
  shouldRenderMessageForSession,
  shouldRenderCommandRejection,
  shouldDeleteSupersededLaunchSession,
  shouldRetryNewChatCancellationAfterLifecycleAck,
  shouldSuppressExecutionForSessionRecovery,
  shouldSuppressLegacyTaskOk,
  ownsAsyncSessionOperation,
} from '../session-task-identity';

describe('side-panel session/task identity contract', () => {
  it('cancels running A, accepts B, and rejects A after it is dismissed', () => {
    expect(newChatCancellationTarget({ authoritativeTask: { taskId: 'A', status: 'running' } })).toBe('A');

    const dismissedTaskIds = new Set(['A']);
    const current = {
      dismissedTaskIds,
      authoritativeTaskId: 'B',
      displayedTaskId: 'B',
      currentSessionId: 'B',
    };
    expect(shouldAcceptTaskSignal({ ...current, taskId: 'B' })).toBe(true);
    expect(shouldAcceptTaskSignal({ ...current, taskId: 'A' })).toBe(false);
  });

  it('preserves the pending-start identity when New Chat happens before the first snapshot', () => {
    expect(
      newChatCancellationTarget({
        authoritativeTask: null,
        pendingStartTaskId: 'B',
        displayedTask: null,
      }),
    ).toBe('B');
    expect(
      shouldAcceptTaskSignal({
        taskId: 'B',
        dismissedTaskIds: new Set(),
        pendingStartTaskId: 'B',
      }),
    ).toBe(true);
  });

  it('clears only the matching pending start when posting the command throws', () => {
    const pending = { taskId: 'A', commandId: 'start-A' };
    expect(pendingStartAfterPostFailure(pending, pending)).toBeNull();
    expect(pendingStartAfterPostFailure(pending, { taskId: 'B', commandId: 'start-B' })).toBe(pending);
  });

  it('keeps the backend live task authoritative while a historical task is displayed', () => {
    expect(
      newChatCancellationTarget({
        authoritativeTask: { taskId: 'live', status: 'waiting_user' },
        displayedTask: { taskId: 'history', status: 'completed' },
      }),
    ).toBe('live');
  });

  it.each(['task_event', 'task_snapshot'] as const)(
    'keeps live B authoritative through a late history A %s and New Chat still cancels B',
    () => {
      const liveB = { id: 'B', status: 'running', revision: 4 } as TaskSnapshot;
      const lateA = { id: 'A', status: 'completed', revision: 9 } as TaskSnapshot;
      const signalContext = {
        dismissedTaskIds: new Set<string>(),
        authoritativeTaskId: liveB.id,
        displayedTaskId: null,
        pendingStartTaskId: null,
        currentSessionId: null,
      };

      expect(shouldAcceptTaskSignal({ ...signalContext, taskId: lateA.id })).toBe(false);
      expect(shouldAcceptTaskSignal({ ...signalContext, taskId: liveB.id })).toBe(true);
      expect(newChatCancellationTarget({ authoritativeTask: { taskId: liveB.id, status: liveB.status } })).toBe('B');
    },
  );

  it('keeps a selected history projection read-only after closing the history list', () => {
    const remainsHistorical = historicalProjectionAfterHistoryBack(true, false);
    expect(remainsHistorical).toBe(true);
    expect(
      newChatCancellationTarget({
        authoritativeTask: { taskId: 'B', status: 'running' },
        displayedTask: { taskId: 'A', status: 'completed' },
      }),
    ).toBe('B');
    expect(historicalProjectionAfterHistoryBack(true, true)).toBe(false);
  });

  it('never renders live command rejection in history or into a mismatched visible task', () => {
    expect(
      shouldRenderCommandRejection({
        taskId: 'B',
        isHistoricalSession: true,
        displayedTaskId: 'A',
        currentSessionId: 'A',
      }),
    ).toBe(false);
    expect(
      shouldRenderCommandRejection({
        taskId: 'A',
        isHistoricalSession: false,
        displayedTaskId: 'B',
        currentSessionId: 'A',
      }),
    ).toBe(false);
    expect(
      shouldRenderCommandRejection({
        taskId: 'B',
        isHistoricalSession: false,
        displayedTaskId: 'B',
        currentSessionId: 'B',
      }),
    ).toBe(true);
  });

  it('does not downgrade the authoritative task when an older same-task signal arrives', () => {
    const current = { id: 'B', status: 'running', revision: 7 } as TaskSnapshot;
    const stale = { id: 'B', status: 'running', revision: 6 } as TaskSnapshot;
    expect(mergeAuthoritativeTaskSnapshot(current, stale)).toBe(current);
  });

  it('rejects an auto-restore result after generation, revision, or request ownership changes', () => {
    const current = {
      disposed: false,
      generation: 2,
      currentGeneration: 2,
      requestToken: 4,
      currentRequestToken: 4,
      taskId: 'A',
      currentTaskId: 'A',
      taskRevision: 3,
      currentTaskRevision: 3,
      sessionId: 'A-chat',
      currentSessionId: null,
      previousSessionId: null,
    };
    expect(isCurrentAsyncSessionResult(current)).toBe(true);
    expect(isCurrentAsyncSessionResult({ ...current, currentGeneration: 3 })).toBe(false);
    expect(isCurrentAsyncSessionResult({ ...current, currentTaskRevision: 4 })).toBe(false);
    expect(isCurrentAsyncSessionResult({ ...current, currentRequestToken: 5 })).toBe(false);
    expect(isCurrentAsyncSessionResult({ ...current, disposed: true })).toBe(false);
  });

  it('lets only the latest A/B history selection own an out-of-order get_task response', () => {
    const current = {
      pendingHistoryTaskId: 'B',
      currentSessionId: 'B',
      isHistoricalSession: true,
    };
    expect(shouldAcceptHistorySnapshot({ ...current, requestedTaskId: 'A', snapshotTaskId: 'A' })).toBe(false);
    expect(shouldAcceptHistorySnapshot({ ...current, requestedTaskId: 'B', snapshotTaskId: 'B' })).toBe(true);
    expect(shouldAcceptHistorySnapshot({ ...current, requestedTaskId: 'B', snapshotTaskId: 'A' })).toBe(false);
  });

  it('persists an explicit old-session message without rendering it in the current chat', () => {
    expect(shouldRenderMessageForSession('old', 'current')).toBe(false);
    expect(shouldRenderMessageForSession('current', 'current')).toBe(true);
    expect(shouldRenderMessageForSession(undefined, 'current')).toBe(true);
  });

  it('drops pre-verifier SYSTEM TASK_OK while retaining guarded fail/cancel signals', () => {
    expect(shouldSuppressLegacyTaskOk(Actors.SYSTEM, 'task.ok')).toBe(true);
    expect(shouldSuppressLegacyTaskOk(Actors.SYSTEM, 'task.fail')).toBe(false);
    expect(shouldSuppressLegacyTaskOk(Actors.NAVIGATOR, 'task.ok')).toBe(true);
  });

  it('keeps completion copy empty when TASK_OK is followed by authoritative verifier failure', () => {
    const visibleMessages: Message[] = [];
    if (!shouldSuppressLegacyTaskOk(Actors.SYSTEM, 'task.ok')) {
      visibleMessages.push({ actor: Actors.SYSTEM, content: '已完成', timestamp: 1 });
    }
    const verifierFailed = {
      id: 'A',
      status: 'failed',
      chatSessionId: 'A-chat',
      rounds: [],
    } as unknown as TaskSnapshot;
    expect(
      completionChatDelivery({ snapshot: verifierFailed, currentSessionId: 'A-chat', messages: visibleMessages }),
    ).toBeNull();
    expect(visibleMessages).toEqual([]);
  });

  it('starts a terminal-to-new-task turn with no old model or visible-message history', () => {
    const prior: Message[] = [
      { actor: Actors.USER, content: 'old goal', timestamp: 1 },
      { actor: Actors.SYSTEM, content: 'old result', timestamp: 2 },
    ];
    expect(modelHistoryForTurn(prior, true)).toEqual([]);
    expect(modelHistoryForTurn(prior, false)).toEqual([
      { role: 'user', content: 'old goal' },
      { role: 'assistant', content: 'old result' },
    ]);
  });

  it.each([
    ['paused', true],
    ['interrupted', true],
    ['failed', false],
    ['completed', false],
    ['cancelled', false],
  ] as const)('starts a clean task after %s without letting the old session retake the UI', (status, mustCancel) => {
    const oldTask = { taskId: 'A', status };
    expect(newChatCancellationTarget({ authoritativeTask: oldTask })).toBe(mustCancel ? 'A' : null);

    const dismissedTaskIds = new Set(['A']);
    expect(
      shouldAcceptTaskSignal({
        taskId: 'A',
        dismissedTaskIds,
        authoritativeTaskId: null,
        displayedTaskId: null,
        pendingStartTaskId: 'B',
        currentSessionId: 'B',
      }),
    ).toBe(false);
    expect(
      shouldAcceptTaskSignal({
        taskId: 'B',
        dismissedTaskIds,
        authoritativeTaskId: null,
        displayedTaskId: null,
        pendingStartTaskId: 'B',
        currentSessionId: 'B',
      }),
    ).toBe(true);
    expect(modelHistoryForTurn([{ actor: Actors.USER, content: 'old goal', timestamp: 1 }], true)).toEqual([]);
  });

  it('makes a command type single-shot until its acknowledgement settles', () => {
    const pending = [{ taskId: 'A', type: 'pause' }];
    expect(canDispatchTaskCommand(pending, { taskId: 'A', type: 'pause' })).toBe(false);
    expect(canDispatchTaskCommand(pending, { taskId: 'A', type: 'cancel' })).toBe(false);
    expect(canDispatchTaskCommand(pending, { taskId: 'B', type: 'pause' })).toBe(true);
  });

  it('serializes pause, resume, and cancel for one revision while leaving other tasks independent', () => {
    const pending = [{ taskId: 'A', type: 'pause' }];
    expect(canDispatchTaskCommand(pending, { taskId: 'A', type: 'cancel' })).toBe(false);
    expect(canDispatchTaskCommand(pending, { taskId: 'A', type: 'resume' })).toBe(false);
    expect(canDispatchTaskCommand(pending, { taskId: 'B', type: 'cancel' })).toBe(true);
    expect(hasPendingLifecycleCommand(new Set(['resume']))).toBe(true);
    expect(hasPendingLifecycleCommand(new Set(['follow_up']))).toBe(false);
    expect(canDispatchTaskCommand(pending, { taskId: 'A', type: 'takeover' })).toBe(false);
    expect(canDispatchTaskCommand(pending, { taskId: 'A', type: 'set_follow' })).toBe(false);
    expect(hasPendingLifecycleCommand(new Set(['takeover']))).toBe(true);
  });

  it('exposes failure recovery only for a loaded writable composer', () => {
    expect(
      canExposeMessageRecoveryActions({
        isHistoricalSession: false,
        taskSnapshotLoaded: true,
        inputEnabled: true,
      }),
    ).toBe(true);
    expect(
      canExposeMessageRecoveryActions({
        isHistoricalSession: true,
        taskSnapshotLoaded: true,
        inputEnabled: true,
      }),
    ).toBe(false);
    expect(
      canExposeMessageRecoveryActions({
        isHistoricalSession: false,
        taskSnapshotLoaded: false,
        inputEnabled: true,
      }),
    ).toBe(false);
    expect(
      canExposeMessageRecoveryActions({
        isHistoricalSession: false,
        taskSnapshotLoaded: true,
        inputEnabled: false,
      }),
    ).toBe(false);
  });

  it('protects only a live task history session from deletion', () => {
    expect(protectedLiveHistorySessionId({ id: 'B', chatSessionId: 'B-chat', status: 'running' } as TaskSnapshot)).toBe(
      'B-chat',
    );
    expect(protectedLiveHistorySessionId({ id: 'B', status: 'waiting_user' } as TaskSnapshot)).toBe('B');
    expect(protectedLiveHistorySessionId({ id: 'A', status: 'completed' } as TaskSnapshot)).toBeNull();
  });

  it('keeps raw attachment payload for the model but projects only text and file names to UI/history', () => {
    const raw =
      '请总结附件\n\n<nano_attached_files>\n<nano_file_content type="file" name="notes.md">\nPRIVATE BODY\n</nano_file_content>\n</nano_attached_files>';
    const projected = displayContentForStoredMessage(raw);
    expect(projected).toBe('请总结附件\n\n附件：notes.md');
    expect(projected).not.toContain('PRIVATE BODY');
    expect(projected).not.toContain('nano_');
    expect(projectMessagesForDisplay([{ actor: Actors.USER, content: raw, timestamp: 1 }])[0]?.content).toBe(projected);
    expect(raw).toContain('PRIVATE BODY');
  });

  it('keeps expanded current-page context out of recorded task titles', () => {
    const raw = '打开 https://www.iana.org 并读取 @当前页（iana.org · Example Domain https://www.iana.org/） 的标题';
    expect(displayContentForStoredMessage(raw)).toBe('打开 https://www.iana.org 并读取 @当前页 的标题');
  });

  it('makes Skill/message launch single-flight and invalidates every await after New Chat or A→B', () => {
    expect(canBeginExclusiveTaskLaunch({ pendingAsyncLaunch: false, pendingStartTaskId: null })).toBe(true);
    expect(canBeginExclusiveTaskLaunch({ pendingAsyncLaunch: true, pendingStartTaskId: null })).toBe(false);
    expect(canBeginExclusiveTaskLaunch({ pendingAsyncLaunch: false, pendingStartTaskId: 'A' })).toBe(false);

    const owner = { generation: 3, requestToken: 9, sessionId: 'skill-C' };
    expect(
      ownsAsyncSessionOperation({
        owner,
        currentGeneration: 3,
        currentRequestToken: 9,
        currentSessionId: 'skill-C',
      }),
    ).toBe(true);
    expect(
      ownsAsyncSessionOperation({
        owner,
        currentGeneration: 4,
        currentRequestToken: 9,
        currentSessionId: 'skill-C',
      }),
    ).toBe(false);
    expect(
      ownsAsyncSessionOperation({
        owner,
        currentGeneration: 3,
        currentRequestToken: 10,
        currentSessionId: 'skill-C',
      }),
    ).toBe(false);
    expect(
      ownsAsyncSessionOperation({ owner, currentGeneration: 3, currentRequestToken: 9, currentSessionId: 'B' }),
    ).toBe(false);
  });

  it.each([
    { pendingAsyncLaunch: false, pendingStartTaskId: null, allowed: true },
    { pendingAsyncLaunch: true, pendingStartTaskId: null, allowed: false },
    { pendingAsyncLaunch: false, pendingStartTaskId: 'skill-A', allowed: false },
    { pendingAsyncLaunch: true, pendingStartTaskId: 'skill-A', allowed: false },
  ])('keeps every Skill CTA honest during launch ownership: %o', input => {
    expect(canBeginExclusiveTaskLaunch(input)).toBe(input.allowed);
  });

  it('separates active-session follow-up from fresh active-only start binding', () => {
    const live = { id: 'A', chatSessionId: 'A', status: 'running' } as TaskSnapshot;
    expect(canFollowUpInOwnedSession(live, 'A')).toBe(true);
    expect(canFollowUpInOwnedSession(live, 'B')).toBe(false);
    expect(canFollowUpInOwnedSession({ ...live, status: 'failed' }, 'A')).toBe(false);
    expect(canFollowUpInOwnedSession({ ...live, status: 'completed' }, 'A')).toBe(true);
  });

  it('recognizes rejected start/run_skill by exact tracked ownership so UI can recover', () => {
    expect(isRejectedTaskLaunchAck({ taskId: 'A', type: 'start' }, { taskId: 'A', accepted: false })).toBe(true);
    expect(isRejectedTaskLaunchAck({ taskId: 'C', type: 'run_skill' }, { taskId: 'C', accepted: false })).toBe(true);
    expect(isRejectedTaskLaunchAck({ taskId: 'A', type: 'pause' }, { taskId: 'A', accepted: false })).toBe(false);
    expect(isRejectedTaskLaunchAck({ taskId: 'A', type: 'start' }, { taskId: 'B', accepted: false })).toBe(false);
    expect(isRejectedTaskLaunchAck({ taskId: 'A', type: 'start' }, { taskId: 'A', accepted: true })).toBe(false);
  });

  it('deletes only an unresolved fresh session after another generation supersedes it', () => {
    expect(
      shouldDeleteSupersededLaunchSession({
        startingFreshSession: true,
        launchResolved: false,
        stillOwnsLaunch: false,
        sessionId: 'orphan-A',
      }),
    ).toBe(true);
    expect(
      shouldDeleteSupersededLaunchSession({
        startingFreshSession: true,
        launchResolved: true,
        stillOwnsLaunch: false,
        sessionId: 'completed-A',
      }),
    ).toBe(false);
    expect(
      shouldDeleteSupersededLaunchSession({
        startingFreshSession: false,
        launchResolved: false,
        stillOwnsLaunch: false,
        sessionId: 'follow-up-A',
      }),
    ).toBe(false);
  });

  it('lets an explicit get_active recovery bypass only expected-session filtering, never dismissal', () => {
    const base = {
      taskId: 'B',
      dismissedTaskIds: new Set<string>(),
      displayedTaskId: 'rejected-C',
      currentSessionId: 'rejected-C',
    };
    expect(shouldAcceptTaskSignal(base)).toBe(false);
    expect(shouldAcceptTaskSignal({ ...base, allowAuthoritativeRecovery: true })).toBe(true);
    expect(
      shouldAcceptTaskSignal({ ...base, dismissedTaskIds: new Set(['B']), allowAuthoritativeRecovery: true }),
    ).toBe(false);
  });

  it('suppresses B execution writes until recovered B-chat replaces rejected C-chat', () => {
    const owner = recoverySessionOwner({ id: 'B', chatSessionId: 'B-chat' } as TaskSnapshot, 'C-chat');
    expect(owner).toEqual({ taskId: 'B', sessionId: 'B-chat' });
    expect(shouldSuppressExecutionForSessionRecovery(null, 'C-chat', true)).toBe(true);
    expect(shouldSuppressExecutionForSessionRecovery(owner, 'C-chat')).toBe(true);
    expect(shouldSuppressExecutionForSessionRecovery(owner, 'B-chat')).toBe(false);
    expect(recoverySessionOwner({ id: 'B', chatSessionId: 'B-chat' } as TaskSnapshot, 'B-chat')).toBeNull();
  });

  it.each(['event-first', 'ack-first'] as const)(
    'keeps reset terminal and late A ignored when cancellation resolves %s',
    ordering => {
      const pending = { taskId: 'A', commandId: 'cancel-A' };
      const firstSignal =
        ordering === 'event-first'
          ? { taskId: 'A', status: 'cancelled' }
          : { taskId: 'A', commandId: 'cancel-A', accepted: true };
      expect(confirmsNewChatCancellation(pending, firstSignal)).toBe(true);

      const dismissedTaskIds = new Set(['A']);
      expect(
        shouldAcceptTaskSignal({
          taskId: 'A',
          dismissedTaskIds,
          authoritativeTaskId: 'B',
          displayedTaskId: 'B',
          currentSessionId: 'B',
        }),
      ).toBe(false);
    },
  );

  it.each([
    { type: 'pause', blockedAttempts: 2 },
    { type: 'resume', blockedAttempts: 1 },
    { type: 'takeover', blockedAttempts: 1 },
    { type: 'set_follow', blockedAttempts: 1 },
  ] as const)(
    'retries New Chat cancellation when blocking lifecycle command $type settles',
    ({ type, blockedAttempts }) => {
      const taskId = 'A';
      let pending: ReturnType<typeof cancellationIntentAfterDispatch> = { taskId, commandId: null };
      for (let index = 0; index < blockedAttempts; index += 1) {
        pending = cancellationIntentAfterDispatch(taskId, `blocked-cancel-${index}`, false);
        expect(pending).toEqual({ taskId, commandId: null });
      }

      expect(
        shouldRetryNewChatCancellationAfterLifecycleAck({
          pending,
          taskId,
          type,
          accepted: true,
        }),
      ).toBe(true);
      pending = cancellationIntentAfterDispatch(taskId, 'real-cancel', true);
      expect(pending).toEqual({ taskId, commandId: 'real-cancel' });
      expect(confirmsNewChatCancellation(pending, { taskId, commandId: 'real-cancel', accepted: true })).toBe(true);
    },
  );

  it('keeps New Chat cancellation intent across disconnect and reissues on a live snapshot', () => {
    const afterDisconnect = cancellationIntentAfterDisconnect({ taskId: 'A', commandId: 'cancel-A' });
    expect(afterDisconnect).toEqual({ taskId: 'A', commandId: null });
    expect(confirmsNewChatCancellation(afterDisconnect, { taskId: 'A', status: 'cancelled' })).toBe(true);
    expect(newChatCancellationTarget({ authoritativeTask: { taskId: 'A', status: 'interrupted' } })).toBe('A');
  });
});
