import type { CommandAck, TaskCommand, TaskSnapshot, TaskStatus } from '@extension/storage';
import type { DelegateResult, OrchestratorHost, WorkBrief } from './types';

const FOLLOWABLE: ReadonlySet<TaskStatus> = new Set([
  'running',
  'paused',
  'waiting_user',
  'inputs_required',
  'interrupted',
  'completed',
]);

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['completed', 'failed', 'cancelled']);

export function shouldFollowExistingTask(
  task: Pick<TaskSnapshot, 'id' | 'chatSessionId' | 'status'> | null | undefined,
  sessionId: string,
): boolean {
  if (!task) return false;
  if (task.chatSessionId !== sessionId && task.id !== sessionId) return false;
  return FOLLOWABLE.has(task.status);
}

export function composeTaskInstruction(brief: WorkBrief): string {
  const text = [brief.goal, brief.instructions, brief.success_criteria]
    .map(part => part.trim())
    .filter(Boolean)
    .join('\n');
  return text || 'Complete the delegated work.';
}

function currentRound(task: TaskSnapshot) {
  return task.rounds.find(round => round.id === task.currentRoundId);
}

function summaryFromTask(task: TaskSnapshot): DelegateResult {
  const round = currentRound(task);
  const page_url = task.targetRefs.find(ref => ref.normalizedUrl)?.normalizedUrl;
  let summary = 'The browser work was cancelled.';
  if (task.status === 'completed') {
    summary = round?.result?.body?.trim() || 'The browser work completed.';
  } else if (task.status === 'failed') {
    summary = round?.failureCategory
      ? `The browser work failed (${round.failureCategory}).`
      : 'The browser work failed.';
  }
  return { summary, did_operate_browser: true, ...(page_url ? { page_url } : {}) };
}

const TASK_END_POLL_MS = 250;

function isTerminalTask(snapshot: TaskSnapshot | null | undefined): snapshot is TaskSnapshot {
  return Boolean(snapshot && TERMINAL.has(snapshot.status));
}

async function waitForTaskEnd(
  taskId: string,
  host: OrchestratorHost,
  abortSignal?: AbortSignal,
): Promise<TaskSnapshot | null> {
  const latest = await host.getTask?.(taskId);
  if (isTerminalTask(latest)) return latest;
  if (!host.getTask) return latest ?? null;

  return new Promise((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let unsub = () => {};

    const settle = (next: () => void) => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener('abort', onAbort);
      unsub();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      next();
    };
    const finish = (snapshot: TaskSnapshot | null) => settle(() => resolve(snapshot));
    const onAbort = () => settle(() => reject(new DOMException('Aborted', 'AbortError')));

    const poll = async () => {
      while (!settled) {
        try {
          const snapshot = await host.getTask!(taskId);
          if (isTerminalTask(snapshot)) {
            finish(snapshot);
            return;
          }
        } catch {
          // Keep polling; a transient read must not strand the worker.
        }
        if (settled) return;
        await new Promise<void>(wake => {
          pollTimer = setTimeout(wake, TASK_END_POLL_MS);
        });
      }
    };

    if (host.subscribeTask) {
      unsub = host.subscribeTask(event => {
        if (event.snapshot.id !== taskId || !isTerminalTask(event.snapshot)) return;
        finish(event.snapshot);
      });
    }
    if (abortSignal?.aborted) {
      onAbort();
      return;
    }
    abortSignal?.addEventListener('abort', onAbort, { once: true });
    void poll();
  });
}

function rejected(ack: CommandAck): DelegateResult {
  return {
    summary: ack.userVisibleText?.trim() || 'Could not operate the browser.',
    did_operate_browser: false,
  };
}

/** Start or follow_up the existing TaskManager loop; wait until it ends. */
export async function runBrowserWork(
  brief: WorkBrief,
  sessionId: string,
  host: OrchestratorHost,
  abortSignal?: AbortSignal,
): Promise<DelegateResult> {
  if (!host.dispatchTask) {
    return { summary: 'Browser operation is not available.', did_operate_browser: false };
  }
  const instruction = composeTaskInstruction(brief);
  const active = await host.getActiveTask?.();
  const follow = shouldFollowExistingTask(active, sessionId);
  const tabId = (await host.getActiveTabId?.()) ?? -1;
  const command: TaskCommand =
    follow && active
      ? {
          type: 'follow_up',
          commandId: crypto.randomUUID(),
          taskId: active.id,
          expectedRevision: active.revision,
          instruction,
          chatSessionId: sessionId,
          instructionMessageId: '',
        }
      : {
          type: 'start',
          commandId: crypto.randomUUID(),
          taskId: sessionId,
          instruction,
          chatSessionId: sessionId,
          instructionMessageId: '',
          tabId,
        };
  const ack = await host.dispatchTask(command);
  if (!ack.accepted) return rejected(ack);
  const ended = await waitForTaskEnd(ack.taskId, host, abortSignal);
  if (!ended) return { summary: 'The browser work did not report a result.', did_operate_browser: true };
  return summaryFromTask(ended);
}
