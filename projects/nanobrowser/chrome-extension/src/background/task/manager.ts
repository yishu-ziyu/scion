import { getActiveTask, getTask, saveTask } from '@extension/storage/lib/task';
import type {
  CommandAck,
  TaskCommand,
  TaskEvent,
  TaskRound,
  TaskSession,
  TaskSnapshot,
  TaskStatus,
} from '@extension/storage/lib/task';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome, ObserveCriteria } from './contracts';

interface TaskManagerDeps {
  createExecutor: (input: ExecutorInput, hooks: ExecutorHooks) => Promise<ExecutorDriver>;
  switchTab: (tabId: number) => Promise<void>;
  observeCriteria: ObserveCriteria;
  now: () => number;
}

const TERMINAL_STATUSES: TaskStatus[] = ['completed', 'failed', 'cancelled'];

export class TaskManager {
  private readonly drivers = new Map<string, ExecutorDriver>();
  private readonly instructions = new Map<string, string>();
  private readonly listeners = new Set<(event: TaskEvent) => void>();
  private transition: Promise<void> = Promise.resolve();

  constructor(private readonly deps: TaskManagerDeps) {}

  dispatch(command: TaskCommand): Promise<CommandAck> {
    const result = this.transition.then(() => this.dispatchNow(command));
    this.transition = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async snapshot(taskId: string): Promise<TaskSnapshot | null> {
    return getTask(taskId);
  }

  async activeSnapshot(): Promise<TaskSnapshot | null> {
    return getActiveTask();
  }

  subscribe(listener: (event: TaskEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async interruptActive(): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getActiveTask();
      if (!task || !['running', 'paused', 'waiting_approval'].includes(task.status)) return;
      this.drivers.get(task.id)?.stop();
      this.drivers.delete(task.id);
      task.status = 'interrupted';
      this.currentRound(task).status = 'interrupted';
      task.revision += 1;
      await this.persist(task);
    });
  }

  async recover(): Promise<void> {
    await this.queueTransition(async () => {
      const task = await getActiveTask();
      if (!task || !['running', 'paused', 'waiting_approval'].includes(task.status)) return;
      const round = this.currentRound(task);
      if (task.sourceSkillId !== undefined) {
        task.status = 'inputs_required';
        round.status = 'inputs_required';
        round.waitReason = 'skill_inputs_required';
      } else {
        task.status = 'interrupted';
        round.status = 'interrupted';
      }
      task.revision += 1;
      await this.persist(task);
    });
  }

  private async dispatchNow(command: TaskCommand): Promise<CommandAck> {
    const existing = await getTask(command.taskId);
    const duplicate = existing ? this.findAck(existing, command.commandId) : undefined;
    if (duplicate) return duplicate;

    if (command.type === 'start') {
      if (existing) return this.reject(existing, command.commandId, 'invalid_transition');
      const active = await getActiveTask();
      if (active && !TERMINAL_STATUSES.includes(active.status)) {
        return {
          accepted: false,
          commandId: command.commandId,
          taskId: command.taskId,
          revision: 0,
          error: 'invalid_transition',
        };
      }
      return this.start(command);
    }

    if (!existing) {
      return {
        accepted: false,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 0,
        error: 'not_found',
      };
    }

    if (command.type === 'run_skill') return this.reject(existing, command.commandId, 'invalid_transition');
    if (command.expectedRevision !== existing.revision) {
      return this.reject(existing, command.commandId, 'stale_revision');
    }

    switch (command.type) {
      case 'pause':
        return this.pause(existing, command.commandId);
      case 'resume':
        return this.resume(existing, command.commandId);
      case 'follow_up':
        return this.followUp(existing, command);
      case 'cancel':
        return this.cancel(existing, command.commandId);
      default:
        return this.reject(existing, command.commandId, 'invalid_transition');
    }
  }

  private async start(command: Extract<TaskCommand, { type: 'start' }>): Promise<CommandAck> {
    if (!command.instruction.trim() || command.tabId < 0) {
      return {
        accepted: false,
        commandId: command.commandId,
        taskId: command.taskId,
        revision: 0,
        error: 'invalid_input',
      };
    }

    const now = this.deps.now();
    const roundId = crypto.randomUUID();
    const ack: CommandAck = {
      accepted: true,
      commandId: command.commandId,
      taskId: command.taskId,
      revision: 1,
    };
    const round: TaskRound = {
      id: roundId,
      instructionMessageId: command.instructionMessageId,
      instructionSummary: 'User instruction',
      status: 'running',
      commandAcks: { [command.commandId]: ack },
      criteria: [],
      attempts: [],
      approvals: [],
      evidence: [],
    };
    const task: TaskSession = {
      id: command.taskId,
      goalSummary: 'User task',
      chatSessionId: command.chatSessionId,
      instructionMessageId: command.instructionMessageId,
      status: 'running',
      revision: 1,
      activeTabId: command.tabId,
      currentRoundId: roundId,
      targetRefs: [],
      rounds: [round],
      createdAt: now,
      updatedAt: now,
    };
    this.instructions.set(task.id, command.instruction);
    await this.persist(task);
    void this.runCurrentRound(task.id);
    return ack;
  }

  private async pause(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (task.status !== 'running') return this.reject(task, commandId, 'invalid_transition');
    task.status = 'paused';
    this.currentRound(task).status = 'paused';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    this.drivers.get(task.id)?.pause();
    return ack;
  }

  private async resume(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (!['paused', 'interrupted'].includes(task.status)) {
      return this.reject(task, commandId, 'invalid_transition');
    }
    task.status = 'running';
    this.currentRound(task).status = 'running';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    const driver = this.drivers.get(task.id);
    if (driver) driver.resume();
    else void this.runCurrentRound(task.id);
    return ack;
  }

  private async followUp(task: TaskSession, command: Extract<TaskCommand, { type: 'follow_up' }>): Promise<CommandAck> {
    if (!['running', 'paused', 'waiting_user', 'completed'].includes(task.status) || !command.instruction.trim()) {
      return this.reject(task, command.commandId, 'invalid_transition');
    }
    const previousStatus = task.status;
    const roundId = crypto.randomUUID();
    task.status = 'running';
    task.currentRoundId = roundId;
    task.chatSessionId = command.chatSessionId;
    task.instructionMessageId = command.instructionMessageId;
    task.rounds.push({
      id: roundId,
      instructionMessageId: command.instructionMessageId,
      instructionSummary: 'User instruction',
      status: 'running',
      commandAcks: {},
      criteria: [],
      attempts: [],
      approvals: [],
      evidence: [],
    });
    const ack = this.accept(task, command.commandId);
    this.instructions.set(task.id, command.instruction);
    await this.persist(task);
    const driver = this.drivers.get(task.id);
    if (!driver) {
      void this.runCurrentRound(task.id);
    } else {
      driver.addFollowUp(command.instruction);
      if (previousStatus === 'paused') driver.resume();
      if (previousStatus === 'waiting_user' || previousStatus === 'completed') {
        void this.runDriver(task.id, roundId, driver);
      }
    }
    return ack;
  }

  private async cancel(task: TaskSession, commandId: string): Promise<CommandAck> {
    if (TERMINAL_STATUSES.includes(task.status)) return this.reject(task, commandId, 'invalid_transition');
    task.status = 'cancelled';
    this.currentRound(task).status = 'cancelled';
    const ack = this.accept(task, commandId);
    await this.persist(task);
    this.drivers.get(task.id)?.stop();
    return ack;
  }

  private accept(task: TaskSession, commandId: string): CommandAck {
    task.revision += 1;
    const ack: CommandAck = {
      accepted: true,
      commandId,
      taskId: task.id,
      revision: task.revision,
    };
    this.currentRound(task).commandAcks[commandId] = ack;
    return ack;
  }

  private async reject(
    task: TaskSession,
    commandId: string,
    error: 'stale_revision' | 'invalid_transition' | 'invalid_input',
  ): Promise<CommandAck> {
    const ack: CommandAck = {
      accepted: false,
      commandId,
      taskId: task.id,
      revision: task.revision,
      error,
    };
    this.currentRound(task).commandAcks[commandId] = ack;
    await this.persist(task);
    return ack;
  }

  private findAck(task: TaskSession, commandId: string): CommandAck | undefined {
    for (const round of task.rounds) {
      const ack = round.commandAcks[commandId];
      if (ack) return ack;
    }
    return undefined;
  }

  private currentRound(task: TaskSession): TaskRound {
    const round = task.rounds.find(item => item.id === task.currentRoundId);
    if (!round) throw new Error('Task current round is missing');
    return round;
  }

  private executorHooks(): ExecutorHooks {
    return {
      onPlan: async () => {},
      dispatchAction: async (action, rawArgs) => ({
        actionResult: await action.call(rawArgs),
        attempt: {
          id: crypto.randomUUID(),
          roundId: 'compatibility',
          actionName: action.name(),
          effect: 'read',
          argsDigest: 'not-persisted-in-story-2',
          state: 'observed',
          proposedAt: this.deps.now(),
        },
        evidence: [],
      }),
    };
  }

  private async runCurrentRound(taskId: string): Promise<void> {
    try {
      let task = await getTask(taskId);
      if (!task || task.status !== 'running') return;
      const round = this.currentRound(task);
      let instruction = this.instructions.get(taskId);
      if (!instruction && task.chatSessionId && round.instructionMessageId) {
        const { chatHistoryStore } = await import('@extension/storage/lib/chat');
        const session = await chatHistoryStore.getSession(task.chatSessionId);
        instruction = session?.messages.find(message => message.id === round.instructionMessageId)?.content;
      }
      if (!instruction) {
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'proof_required';
        task.revision += 1;
        await this.persist(task);
        return;
      }

      await this.deps.switchTab(task.activeTabId);
      const driver = await this.deps.createExecutor(
        { taskId, roundId: round.id, instruction, tabId: task.activeTabId },
        this.executorHooks(),
      );
      this.drivers.set(taskId, driver);
      await this.runDriver(taskId, round.id, driver);
    } catch {
      await this.queueTransition(async () => {
        const task = await getTask(taskId);
        if (!task || TERMINAL_STATUSES.includes(task.status)) return;
        task.status = 'failed';
        this.currentRound(task).status = 'failed';
        task.revision += 1;
        await this.persist(task);
      });
    }
  }

  private async runDriver(taskId: string, roundId: string, driver: ExecutorDriver): Promise<void> {
    const outcome = await driver.run();
    await this.queueTransition(async () => {
      const task = await getTask(taskId);
      if (
        !task ||
        task.currentRoundId !== roundId ||
        task.status === 'interrupted' ||
        TERMINAL_STATUSES.includes(task.status)
      )
        return;
      this.applyOutcome(task, outcome);
      task.revision += 1;
      await this.persist(task);
    });
  }

  private applyOutcome(task: TaskSession, outcome: ExecutorOutcome): void {
    const round = this.currentRound(task);
    switch (outcome.kind) {
      case 'candidate_complete':
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = 'proof_required';
        break;
      case 'waiting_user':
        task.status = 'waiting_user';
        round.status = 'waiting_user';
        round.waitReason = outcome.reason;
        break;
      case 'paused':
        task.status = 'paused';
        round.status = 'paused';
        break;
      case 'cancelled':
        task.status = 'cancelled';
        round.status = 'cancelled';
        break;
      case 'failed':
        task.status = 'failed';
        round.status = 'failed';
        break;
    }
  }

  private async persist(task: TaskSession): Promise<void> {
    task.updatedAt = this.deps.now();
    await saveTask(task);
    const snapshot = structuredClone(task);
    for (const listener of this.listeners) listener({ type: 'snapshot', taskId: task.id, snapshot });
  }

  private queueTransition(work: () => Promise<void>): Promise<void> {
    const result = this.transition.then(work);
    this.transition = result.catch(() => undefined);
    return result;
  }
}
