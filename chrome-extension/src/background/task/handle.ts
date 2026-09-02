/**
 * Chijie 0.2 / EPIC D1 — async TaskHandle + TaskService contract (types only;
 * D3 wires this onto TaskManager. Nothing here imports TaskManager, and no
 * production path changes).
 *
 * The point of the split: `start()` returns as soon as the task is accepted —
 * it hands back a lightweight handle, never a promise that blocks until the
 * whole task completes. Chat lifecycle (send/ack) and browser-task lifecycle
 * (progress/wait/verify) are then decoupled: the sidebar follows the task via
 * `subscribe()` + the D2 ordered TaskEvent stream.
 *
 * Handle rebuildability: a handle carries only its `id`. Any UI (side panel,
 * popup, a post-SW-restart context) can rebuild an equivalent handle with
 * `taskService.get(id)` — it does NOT depend on the long-lived Port object or
 * the JS object that originally called `start()`. The Port is only a delivery
 * pipe; identity is the taskId.
 */
import type { CommandAck, TaskSession } from '@extension/storage/lib/task';
import type { TaskEventListener } from './task-events';

/** Re-exported so consumers of the handle API need not import D2 separately. */
export type { CommandAck } from '@extension/storage/lib/task';

/** Teardown returned by `subscribe()`; call it to stop receiving events. */
export type Unsubscribe = () => void;

/**
 * Authoritative durable snapshot for a task (same shape TaskManager persists).
 * Aliased rather than re-invented so D3 can return the real session unchanged.
 */
export type TaskSnapshot = TaskSession;

/** What `start()` needs; mirrors the existing `start` TaskCommand fields minus
 *  client-generated ids (commandId/taskId are the service's to mint). */
export interface StartTaskInput {
  instruction: string;
  chatSessionId: string;
  instructionMessageId: string;
  tabId: number;
  /** Skip cheap whole-message 停止 detection (same as TaskCommand.start). */
  forceExecute?: boolean;
}

/** Follow-up / direction-change payload for an existing task. */
export interface FollowUpInput {
  instruction: string;
  chatSessionId: string;
  instructionMessageId: string;
  changeType?: 'follow_up' | 'direction_change';
  forceExecute?: boolean;
}

/**
 * Async handle on one running task. Every control call resolves as soon as the
 * command is ACKed (accepted/rejected), not when its effects finish — results
 * stream through `subscribe()` as ordered TaskEvents.
 */
export interface TaskHandle {
  /** Stable task id; the only state a handle needs to be rebuilt from. */
  readonly id: string;
  /** Read the authoritative snapshot at call time (fresh, not cached). */
  snapshot(): Promise<TaskSnapshot>;
  /** Queue a follow-up instruction; ack is immediate, execution is async. */
  followUp(input: FollowUpInput): Promise<CommandAck>;
  pause(): Promise<CommandAck>;
  resume(): Promise<CommandAck>;
  cancel(): Promise<CommandAck>;
  /**
   * Receive ordered TaskEvents for this task until `Unsubscribe` is called.
   * Delivery is at-least-once; consumers dedup via the D2 `applyTaskEvents`
   * eventId watermark, so a dropped/reconnected Port is safe.
   */
  subscribe(listener: TaskEventListener): Unsubscribe;
}

/**
 * Entry point the UI layer talks to. Pure interface — implementations may be
 * local (background) or a Port/RPC proxy; neither leaks a TaskManager instance
 * across this boundary.
 */
export interface TaskService {
  /** Accepts the task and returns its handle immediately (non-blocking). */
  start(input: StartTaskInput): Promise<TaskHandle>;
  /** Rebuild a handle for a known task; null when the task no longer exists. */
  get(taskId: string): Promise<TaskHandle | null>;
}
