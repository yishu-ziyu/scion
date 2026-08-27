import { Actors, type Message, type TaskCommand, type TaskSnapshot, type TaskStatus } from '@extension/storage';
import { displayCurrentPageMention } from './composer-mention';

const LIVE_TASK_STATUSES = new Set<TaskStatus>(['running', 'paused', 'waiting_user', 'inputs_required', 'interrupted']);

export interface TaskIdentity {
  taskId: string | null | undefined;
  status?: TaskStatus | string | null;
}

export interface PendingNewChatCancellation {
  taskId: string;
  commandId: string | null;
}

export function pendingStartAfterPostFailure<T extends { taskId: string; commandId: string }>(
  pending: T | null,
  failed: { taskId: string; commandId: string },
): T | null {
  return pending?.taskId === failed.taskId && pending.commandId === failed.commandId ? null : pending;
}

export function confirmsNewChatCancellation(
  pending: PendingNewChatCancellation | null,
  signal: { taskId?: unknown; commandId?: unknown; status?: unknown; accepted?: unknown },
): boolean {
  if (!pending || signal.taskId !== pending.taskId) return false;
  if (signal.status === 'cancelled') return true;
  return Boolean(pending.commandId && signal.accepted === true && signal.commandId === pending.commandId);
}

export function cancellationIntentAfterDisconnect(
  pending: PendingNewChatCancellation | null,
): PendingNewChatCancellation | null {
  return pending ? { taskId: pending.taskId, commandId: null } : null;
}

export function cancellationIntentAfterDispatch(
  taskId: string,
  commandId: string,
  dispatched: boolean,
): PendingNewChatCancellation {
  return { taskId, commandId: dispatched ? commandId : null };
}

export function shouldRetryNewChatCancellationAfterLifecycleAck(input: {
  pending: PendingNewChatCancellation | null;
  taskId: string;
  type?: TaskCommand['type'];
  accepted: boolean;
}): boolean {
  return Boolean(
    input.pending?.taskId === input.taskId &&
      !input.pending.commandId &&
      input.accepted &&
      (input.type === 'pause' || input.type === 'resume' || input.type === 'takeover' || input.type === 'set_follow'),
  );
}

export function isLiveTaskIdentity(task: TaskIdentity | null | undefined): task is TaskIdentity & { taskId: string } {
  return Boolean(task?.taskId && task.status && LIVE_TASK_STATUSES.has(task.status as TaskStatus));
}

/** New Chat is a new session. It does not stop other sessions. */
export function newChatCancellationTarget(input: {
  authoritativeTask?: TaskIdentity | null;
  pendingStartTaskId?: string | null;
  displayedTask?: TaskIdentity | null;
}): string | null {
  void input;
  return null;
}

export function shouldAcceptTaskSignal(input: {
  taskId: string | null | undefined;
  dismissedTaskIds: ReadonlySet<string>;
  authoritativeTaskId?: string | null;
  displayedTaskId?: string | null;
  pendingStartTaskId?: string | null;
  currentSessionId?: string | null;
  allowBootstrap?: boolean;
  allowAuthoritativeRecovery?: boolean;
}): boolean {
  const { taskId } = input;
  if (!taskId || input.dismissedTaskIds.has(taskId)) return false;
  if (input.allowAuthoritativeRecovery) return true;
  const expectedTaskIds = [
    input.authoritativeTaskId,
    input.displayedTaskId,
    input.pendingStartTaskId,
    input.currentSessionId,
  ].filter((value): value is string => Boolean(value));
  if (expectedTaskIds.length === 0) return input.allowBootstrap === true;
  return expectedTaskIds.includes(taskId);
}

/** Async storage reads may commit only while the exact task/session generation still owns the UI. */
export function isCurrentAsyncSessionResult(input: {
  disposed: boolean;
  generation: number;
  currentGeneration: number;
  requestToken: number;
  currentRequestToken: number;
  taskId: string;
  currentTaskId?: string | null;
  taskRevision?: number;
  currentTaskRevision?: number;
  sessionId: string;
  currentSessionId?: string | null;
  previousSessionId?: string | null;
}): boolean {
  if (input.disposed || input.generation !== input.currentGeneration) return false;
  if (input.requestToken !== input.currentRequestToken || input.taskId !== input.currentTaskId) return false;
  if (input.taskRevision !== undefined && input.taskRevision !== input.currentTaskRevision) return false;
  return input.currentSessionId === input.sessionId || input.currentSessionId === (input.previousSessionId ?? null);
}

/** A get_task response belongs only to the latest explicit history selection. */
export function shouldAcceptHistorySnapshot(input: {
  requestedTaskId: string | null | undefined;
  snapshotTaskId: string | null | undefined;
  pendingHistoryTaskId: string | null | undefined;
  currentSessionId: string | null | undefined;
  isHistoricalSession: boolean;
}): boolean {
  return Boolean(
    input.isHistoricalSession &&
      input.requestedTaskId &&
      input.requestedTaskId === input.snapshotTaskId &&
      input.requestedTaskId === input.pendingHistoryTaskId &&
      input.requestedTaskId === input.currentSessionId,
  );
}

/** Explicit persistence into an old chat must not mutate the currently visible timeline. */
export function shouldRenderMessageForSession(
  explicitSessionId: string | null | undefined,
  currentSessionId: string | null,
): boolean {
  return explicitSessionId === undefined || explicitSessionId === currentSessionId;
}

/** Historical chat is a read-only projection; live command errors never write into it. */
export function shouldRenderCommandRejection(input: {
  taskId: string;
  isHistoricalSession: boolean;
  displayedTaskId?: string | null;
  currentSessionId?: string | null;
}): boolean {
  const visibleOwner = input.displayedTaskId ?? input.currentSessionId;
  return Boolean(!input.isHistoricalSession && input.taskId === visibleOwner);
}

/** Closing the history list must not turn a selected historical projection into a writable live chat. */
export function historicalProjectionAfterHistoryBack(isHistoricalSession: boolean, reset: boolean): boolean {
  return reset ? false : isHistoricalSession;
}

/** Same-task stale signals may never downgrade the authoritative live revision. */
export function mergeAuthoritativeTaskSnapshot(current: TaskSnapshot | null, incoming: TaskSnapshot): TaskSnapshot {
  if (current?.id === incoming.id && current.revision >= incoming.revision) return current;
  return incoming;
}

/** Executor TASK_OK precedes verification; only authoritative task_event may deliver completion. */
export function shouldSuppressLegacyTaskOk(_actor: string, state: string): boolean {
  return state === 'task.ok';
}

export function modelHistoryForTurn(
  messages: Message[],
  startingFreshSession: boolean,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  if (startingFreshSession) return [];
  return messages
    .filter(message => typeof message.content === 'string' && message.content.trim())
    .slice(-12)
    .map(message => ({
      role: message.actor === Actors.USER ? 'user' : 'assistant',
      content: message.content,
    }));
}

export function canDispatchTaskCommand(
  pending: Iterable<{ taskId: string; type: string }>,
  command: { taskId: string; type: string },
): boolean {
  const lifecycleTypes = new Set(['pause', 'resume', 'cancel', 'takeover', 'set_follow']);
  return ![...pending].some(
    item =>
      item.taskId === command.taskId &&
      (item.type === command.type || (lifecycleTypes.has(item.type) && lifecycleTypes.has(command.type))),
  );
}

export function hasPendingLifecycleCommand(pending: ReadonlySet<TaskCommand['type']>): boolean {
  return (
    pending.has('pause') ||
    pending.has('resume') ||
    pending.has('cancel') ||
    pending.has('takeover') ||
    pending.has('set_follow')
  );
}

export function canExposeMessageRecoveryActions(input: {
  isHistoricalSession: boolean;
  taskSnapshotLoaded: boolean;
  inputEnabled: boolean;
}): boolean {
  return !input.isHistoricalSession && input.taskSnapshotLoaded && input.inputEnabled;
}

export interface AsyncSessionOwner {
  generation: number;
  requestToken: number;
  sessionId?: string | null;
}

export interface RecoverySessionOwner {
  taskId: string;
  sessionId: string;
}

/** Async UI work may commit only while its token, generation, and optional session still own the console. */
export function ownsAsyncSessionOperation(input: {
  owner: AsyncSessionOwner;
  currentGeneration: number;
  currentRequestToken: number;
  currentSessionId?: string | null;
}): boolean {
  if (input.owner.generation !== input.currentGeneration || input.owner.requestToken !== input.currentRequestToken) {
    return false;
  }
  return input.owner.sessionId === undefined || input.owner.sessionId === input.currentSessionId;
}

export function canBeginExclusiveTaskLaunch(input: {
  pendingAsyncLaunch: boolean;
  pendingStartTaskId?: string | null;
}): boolean {
  return !input.pendingAsyncLaunch && !input.pendingStartTaskId;
}

export function recoverySessionOwner(
  task: Pick<TaskSnapshot, 'id' | 'chatSessionId'>,
  currentSessionId: string | null,
): RecoverySessionOwner | null {
  const sessionId = task.chatSessionId ?? task.id;
  return sessionId === currentSessionId ? null : { taskId: task.id, sessionId };
}

/** Legacy execution text has no safe destination until the recovered task's chat owns the UI. */
export function shouldSuppressExecutionForSessionRecovery(
  owner: RecoverySessionOwner | null,
  currentSessionId: string | null,
  recoveringAuthoritativeTask = false,
): boolean {
  return recoveringAuthoritativeTask || Boolean(owner && owner.sessionId !== currentSessionId);
}

export function userTextByRoundId(
  rounds: Array<{ id: string; instructionMessageId?: string }>,
  messages: Array<{ actor: string; content?: string; id?: string }>,
): Record<string, string> {
  const users = messages.filter(
    message => message.actor === Actors.USER && typeof message.content === 'string' && message.content.trim(),
  );
  const claimed = new Set<number>();
  const out: Record<string, string> = {};
  for (const round of rounds) {
    const byId = users.findIndex(
      (message, index) => !claimed.has(index) && message.id !== undefined && message.id === round.instructionMessageId,
    );
    const index = byId >= 0 ? byId : users.findIndex((_message, i) => !claimed.has(i));
    if (index < 0) continue;
    claimed.add(index);
    out[round.id] = users[index]!.content!.replace(/\s+/g, ' ').trim();
  }
  return out;
}

/** Keep local user turns the stored snapshot has not caught up to yet. */
export function mergeRestoredSessionMessages<T extends { actor: string; content?: string; id?: string }>(
  stored: T[],
  current: readonly { actor: string; content?: string; id?: string }[],
): T[] {
  if (current.length === 0) return stored;
  if (stored.length === 0) return current as T[];
  const storedIds = new Set(stored.map(message => message.id).filter((id): id is string => Boolean(id)));
  const storedUserTexts = new Set(
    stored
      .filter(message => message.actor === Actors.USER)
      .map(message => (message.content ?? '').replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
  const extras = current.filter(message => {
    if (message.id && storedIds.has(message.id)) return false;
    if (message.actor !== Actors.USER) return false;
    const text = (message.content ?? '').replace(/\s+/g, ' ').trim();
    return Boolean(text) && !storedUserTexts.has(text);
  });
  return extras.length === 0 ? stored : [...stored, ...(extras as T[])];
}

export function pendingFollowUpTexts(
  messages: Array<{ actor: string; content?: string }>,
  roundUtterances: Readonly<Record<string, string>>,
  originalInstruction: string,
): string[] {
  const assigned = new Set(
    [...Object.values(roundUtterances), originalInstruction]
      .map(value => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean),
  );
  const pending: string[] = [];
  for (const message of messages) {
    if (message.actor !== Actors.USER) continue;
    const text = (message.content ?? '').replace(/\s+/g, ' ').trim();
    if (!text || assigned.has(text) || pending.includes(text)) continue;
    pending.push(text);
  }
  return pending;
}

export function canFollowUpInOwnedSession(task: TaskSnapshot | null | undefined, sessionId: string | null): boolean {
  if (!task) return false;
  const live = isLiveTaskIdentity({ taskId: task.id, status: task.status }) || task.status === 'completed';
  if (!live) return false;
  if (!sessionId) return Boolean(task.chatSessionId || task.id);
  return task.chatSessionId === sessionId || task.id === sessionId;
}

/** A live follow-up must not wait for the original start command to clear. */
export function composerSendBlockedByExclusiveLaunch(input: {
  followingUp: boolean;
  pendingAsyncLaunch: boolean;
  pendingStartTaskId: string | null;
}): boolean {
  if (input.followingUp) return false;
  return !canBeginExclusiveTaskLaunch({
    pendingAsyncLaunch: input.pendingAsyncLaunch,
    pendingStartTaskId: input.pendingStartTaskId,
  });
}

export function planComposerSend(input: {
  liveTask: TaskSnapshot | null | undefined;
  sessionId: string | null;
  pendingAsyncLaunch: boolean;
  pendingStartTaskId: string | null;
}): {
  followingUp: boolean;
  sessionId: string | null;
  startingFreshSession: boolean;
  blockFeedback?: string;
} {
  const followingUp = canFollowUpInOwnedSession(input.liveTask, input.sessionId);
  const sessionId = followingUp
    ? (input.sessionId ?? input.liveTask?.chatSessionId ?? input.liveTask?.id ?? null)
    : input.sessionId;
  const startingFreshSession = !followingUp || !sessionId;
  if (
    composerSendBlockedByExclusiveLaunch({
      followingUp,
      pendingAsyncLaunch: input.pendingAsyncLaunch,
      pendingStartTaskId: input.pendingStartTaskId,
    })
  ) {
    return {
      followingUp,
      sessionId,
      startingFreshSession,
      blockFeedback: '上一个任务还在启动。输入已保留，请稍后再试。',
    };
  }
  return { followingUp, sessionId, startingFreshSession };
}

export function isRejectedTaskLaunchAck(
  pending: { taskId: string; type: string } | null | undefined,
  ack: { taskId: string; accepted: boolean },
): boolean {
  return Boolean(
    !ack.accepted && pending?.taskId === ack.taskId && (pending.type === 'start' || pending.type === 'run_skill'),
  );
}

export function shouldDeleteSupersededLaunchSession(input: {
  startingFreshSession: boolean;
  launchResolved: boolean;
  stillOwnsLaunch: boolean;
  sessionId?: string | null;
}): boolean {
  return Boolean(input.startingFreshSession && input.sessionId && !input.launchResolved && !input.stillOwnsLaunch);
}

export function protectedLiveHistorySessionId(task: TaskSnapshot | null | undefined): string | null {
  if (!task || !isLiveTaskIdentity({ taskId: task.id, status: task.status })) return null;
  return task.chatSessionId ?? task.id;
}

/** Keep model-only attachment payloads in storage while projecting safe chat/history copy. */
export function displayContentForStoredMessage(content: string): string {
  if (!content.includes('<nano_attached_files>')) return displayCurrentPageMention(content);
  const visibleText = displayCurrentPageMention(content.split('<nano_attached_files>', 1)[0]?.trim() ?? '');
  const attachmentNames = [...content.matchAll(/<nano_file_content\b[^>]*\bname="([^"]*)"[^>]*>/g)].map(
    match => match[1]?.trim() || '未命名附件',
  );
  const fileList = attachmentNames.map(name => `附件：${name}`).join('\n');
  return [visibleText, fileList].filter(Boolean).join('\n\n') || '附件';
}

export function projectMessagesForDisplay<T extends Message>(messages: T[]): T[] {
  return messages.map(message => ({ ...message, content: displayContentForStoredMessage(message.content) }));
}
