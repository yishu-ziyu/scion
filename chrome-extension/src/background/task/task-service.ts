/**
 * Chijie 0.2 / EPIC D3 — TaskService implementation bridging the D1 async
 * handle API onto the existing TaskManager.
 *
 * `start()` awaits only the manager's CommandAck. The manager already treats
 * start as accepted the moment the session is persisted (it fire-and-forgets
 * runCurrentRound), so no manager change is needed: the ack resolves while the
 * executor is still running, and the handle returned here never blocks on
 * `executor.run()`.
 *
 * Event source: TaskManager broadcasts a durable snapshot on every persist
 * (its existing listener channel). This service projects that stream into the
 * D2 ordered TaskEvent protocol per subscriber — one initial event reflecting
 * the state at subscribe time, then state transitions (accepted /
 * state_changed / waiting_for_user / verified / failed / cancelled).
 * ponytail: step-level `task.progressed` payloads are not derived from
 * snapshot diffs here; wiring the richer event source is D4.
 */
import type {
  CommandAck,
  TaskCommand,
  TaskEvent as ManagerSnapshotEvent,
  TaskRound,
  TaskSession,
  TaskSnapshot,
  TaskStatus,
  WaitReason,
} from '@extension/storage/lib/task';
import type { StartTaskInput, TaskHandle, TaskService, Unsubscribe } from './handle';
import { TaskHandleImpl, type TaskHandleBackend } from './task-handle';
import type { TaskEvent, TaskEventEnvelope, TaskEventListener } from './task-events';

/** The public TaskManager surface this service needs; nothing more. */
export interface TaskCommandChannel {
  dispatch(command: TaskCommand): Promise<CommandAck>;
  snapshot(taskId: string): Promise<TaskSnapshot | null>;
  subscribe(listener: (event: ManagerSnapshotEvent) => void): () => void;
}

/**
 * D1 start input plus optional caller-minted ids. Passing the same
 * `commandId` + `taskId` again (a UI retry) reuses the manager's existing
 * findAck instead of creating a second task; omit them and the service mints
 * fresh ones.
 */
export type StartTaskRequest = StartTaskInput & {
  commandId?: string;
  taskId?: string;
};

export interface TaskServiceDeps {
  manager: TaskCommandChannel;
  now?: () => number;
}

/** Per-subscriber projection state: each subscription gets its own ordered stream. */
interface SubscriberStream {
  sequence: number;
  lastStatus: TaskStatus | null;
  uid: string;
}

function projectStatus(
  status: TaskStatus,
  previous: TaskStatus | null,
  snapshot: TaskSnapshot,
  round: TaskRound | undefined,
  envelope: TaskEventEnvelope,
): TaskEvent | null {
  if (status === 'failed') {
    return { ...envelope, type: 'task.failed', payload: { category: round?.failureCategory ?? 'unknown' } };
  }
  if (status === 'cancelled') {
    return { ...envelope, type: 'task.cancelled', payload: {} };
  }
  if (status === 'completed') {
    return {
      ...envelope,
      type: 'task.verified',
      payload: { receiptId: round?.receipt?.id ?? '', criterionIds: round?.receipt?.criterionIds ?? [] },
    };
  }
  if (status === 'waiting_user') {
    const reason: WaitReason = round?.waitReason ?? 'target_missing';
    return {
      ...envelope,
      type: 'task.waiting_for_user',
      payload: { reason, ...(round?.waitAsk ? { ask: round.waitAsk } : {}) },
    };
  }
  if (previous === null) {
    return {
      ...envelope,
      type: 'task.accepted',
      payload: {
        instructionSummary: round?.instructionSummary ?? snapshot.goalSummary,
        activeTabId: snapshot.activeTabId,
      },
    };
  }
  if (previous !== status) {
    return { ...envelope, type: 'task.state_changed', payload: { from: previous, to: status } };
  }
  return null;
}

export class TaskServiceImpl implements TaskService, TaskHandleBackend {
  private readonly manager: TaskCommandChannel;
  private readonly now: () => number;

  constructor(deps: TaskServiceDeps) {
    this.manager = deps.manager;
    this.now = deps.now ?? Date.now;
  }

  /** Resolves as soon as the manager ACKs; never waits for executor.run(). */
  async start(input: StartTaskRequest): Promise<TaskHandle> {
    const ack = await this.manager.dispatch({
      type: 'start',
      commandId: input.commandId ?? crypto.randomUUID(),
      taskId: input.taskId ?? crypto.randomUUID(),
      instruction: input.instruction,
      chatSessionId: input.chatSessionId,
      instructionMessageId: input.instructionMessageId,
      tabId: input.tabId,
      forceExecute: input.forceExecute,
    });
    return new TaskHandleImpl(ack.taskId, this, ack);
  }

  async get(taskId: string): Promise<TaskHandle | null> {
    const task = await this.manager.snapshot(taskId);
    return task ? new TaskHandleImpl(taskId, this) : null;
  }

  /** Handle bridge: read the authoritative snapshot fresh, never cached. */
  snapshot(taskId: string): Promise<TaskSnapshot | null> {
    return this.manager.snapshot(taskId);
  }

  /** Handle bridge: control commands go straight to the manager command channel. */
  dispatch(command: TaskCommand): Promise<CommandAck> {
    return this.manager.dispatch(command);
  }

  /**
   * Bridge TaskManager's snapshot broadcast to this subscriber's D2 event
   * stream. The first event (replayed current state, or the next live
   * broadcast, whichever lands first) is always delivered; identical
   * consecutive statuses are not re-emitted.
   */
  subscribeTask(taskId: string, listener: TaskEventListener): Unsubscribe {
    const stream: SubscriberStream = { sequence: 0, lastStatus: null, uid: crypto.randomUUID() };
    let replayed = false;
    const off = this.manager.subscribe(event => {
      if (event.taskId !== taskId) return;
      replayed = true;
      this.emit(stream, taskId, event.snapshot, event.roundId, event.revision, listener);
    });
    void this.manager.snapshot(taskId).then(snapshot => {
      if (replayed || !snapshot) return;
      this.emit(stream, taskId, snapshot, snapshot.currentRoundId, snapshot.revision, listener);
    });
    return off;
  }

  private emit(
    stream: SubscriberStream,
    taskId: string,
    snapshot: TaskSession,
    roundId: string,
    revision: number,
    listener: TaskEventListener,
  ): void {
    stream.sequence += 1;
    const event = projectStatus(
      snapshot.status,
      stream.lastStatus,
      snapshot,
      snapshot.rounds.find(round => round.id === roundId),
      {
        eventId: `${taskId}:${stream.uid}:${stream.sequence}`,
        taskId,
        roundId,
        sequence: stream.sequence,
        revision,
        occurredAt: this.now(),
      },
    );
    if (!event) {
      stream.sequence -= 1;
      return;
    }
    stream.lastStatus = snapshot.status;
    listener(event);
  }
}
