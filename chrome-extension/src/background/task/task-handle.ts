/**
 * Chijie 0.2 / EPIC D3 — TaskHandle implementation bridging the D1 handle API
 * onto the existing TaskManager command channel. Every control call resolves
 * as soon as the manager ACKs (the manager already runs rounds in the
 * background); progress reaches `subscribe()` through the D2 TaskEvent stream
 * fed by TaskServiceImpl from TaskManager's existing snapshot broadcast.
 */
import type { CommandAck, TaskCommand, TaskSnapshot } from '@extension/storage/lib/task';
import type { FollowUpInput, TaskHandle, Unsubscribe } from './handle';
import type { TaskEventListener } from './task-events';

/** The slice of the service a handle needs; keeps TaskHandleImpl import-light. */
export interface TaskHandleBackend {
  dispatch(command: TaskCommand): Promise<CommandAck>;
  snapshot(taskId: string): Promise<TaskSnapshot | null>;
  subscribeTask(taskId: string, listener: TaskEventListener): Unsubscribe;
}

/** Existing-task commands minus the ids/revision the handle fills in itself. */
type ExistingCommandBody =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'cancel' }
  | {
      type: 'follow_up';
      instruction: string;
      chatSessionId: string;
      instructionMessageId: string;
      changeType?: 'follow_up' | 'direction_change';
      forceExecute?: boolean;
    };

export class TaskHandleImpl implements TaskHandle {
  /**
   * D3 extension beyond the D1 interface: the ack `start()` resolved with, so
   * callers can distinguish a rejected start (accepted:false + error) from a
   * later runtime failure (which arrives as a `task.failed` event). Absent on
   * handles rebuilt through `get()`.
   */
  constructor(
    readonly id: string,
    private readonly backend: TaskHandleBackend,
    readonly ack?: CommandAck,
  ) {}

  async snapshot(): Promise<TaskSnapshot> {
    const task = await this.backend.snapshot(this.id);
    if (!task) throw new Error(`Task ${this.id} is missing`);
    return task;
  }

  followUp(input: FollowUpInput): Promise<CommandAck> {
    return this.send({
      type: 'follow_up',
      instruction: input.instruction,
      chatSessionId: input.chatSessionId,
      instructionMessageId: input.instructionMessageId,
      changeType: input.changeType,
      forceExecute: input.forceExecute,
    });
  }

  pause(): Promise<CommandAck> {
    return this.send({ type: 'pause' });
  }

  resume(): Promise<CommandAck> {
    return this.send({ type: 'resume' });
  }

  cancel(): Promise<CommandAck> {
    return this.send({ type: 'cancel' });
  }

  subscribe(listener: TaskEventListener): Unsubscribe {
    return this.backend.subscribeTask(this.id, listener);
  }

  private async send(command: ExistingCommandBody): Promise<CommandAck> {
    const task = await this.backend.snapshot(this.id);
    return this.backend.dispatch({
      ...command,
      commandId: crypto.randomUUID(),
      taskId: this.id,
      expectedRevision: task?.revision ?? 0,
    } as TaskCommand);
  }
}
