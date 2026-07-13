import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../manager';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome } from '../contracts';
import { Action } from '../../agent/actions/builder';
import { clickElementActionSchema } from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  saveTask: vi.fn(async (task: { id: string }) => {
    store.sessions.set(task.id, structuredClone(task));
  }),
  targetObservation: {
    target: {
      id: 'target-1',
      kind: 'element' as const,
      tabId: 7,
      frameId: 0 as const,
      urlOrigin: 'https://example.test',
      digest: 'button-1',
    },
    tag: 'button',
    type: 'submit',
    inForm: true,
  },
  observeActionTarget: vi.fn(),
}));

vi.mock('@extension/storage/lib/task', () => ({
  getTask: async (id: string) => store.sessions.get(id) ?? null,
  getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
  saveTask: store.saveTask,
}));

vi.mock('../../agent/factory', () => ({
  browserContext: {
    getCurrentPage: async () => ({ observeActionTarget: store.observeActionTarget }),
  },
}));

const fakeDriver = (): ExecutorDriver => ({
  run: vi.fn(() => new Promise<ExecutorOutcome>(() => {})),
  addFollowUp: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
});

describe('TaskManager lifecycle', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.saveTask.mockClear();
    store.observeActionTarget.mockReset();
    store.observeActionTarget.mockResolvedValue(store.targetObservation);
  });

  it('persists one start and returns the original ack for a duplicate command', async () => {
    const createExecutor = vi.fn(async () => fakeDriver());
    const switchTab = vi.fn();
    const manager = new TaskManager({
      createExecutor,
      switchTab,
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    const command = {
      type: 'start' as const,
      commandId: 'cmd-1',
      taskId: 'task-1',
      instruction: 'open the form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    };
    const first = await manager.dispatch(command);
    const duplicate = await manager.dispatch(command);
    expect(duplicate).toEqual(first);
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    expect(switchTab).toHaveBeenCalledWith(7);
    expect(switchTab.mock.invocationCallOrder[0]).toBeLessThan(createExecutor.mock.invocationCallOrder[0]);
    expect(store.sessions.get('task-1')).toMatchObject({
      rounds: [{ commandAcks: { 'cmd-1': first } }],
    });
    expect(JSON.stringify(store.sessions.get('task-1'))).not.toContain('open the form');
  });

  it('rejects a second concurrent task', async () => {
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-1',
      instruction: 'first task',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await expect(
      manager.dispatch({
        type: 'start',
        commandId: 'start-2',
        taskId: 'task-2',
        instruction: 'second task',
        chatSessionId: 'chat-2',
        instructionMessageId: 'message-2',
        tabId: 8,
      }),
    ).resolves.toMatchObject({ accepted: false, error: 'invalid_transition' });
  });

  it('recovers stored running work as interrupted', async () => {
    store.sessions.set('task-1', {
      id: 'task-1',
      goalSummary: 'open form',
      status: 'running',
      revision: 1,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'open form',
          status: 'running',
          commandAcks: {},
          criteria: [],
          attempts: [],
          approvals: [],
          evidence: [],
        },
      ],
    });
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.recover();
    await expect(manager.snapshot('task-1')).resolves.toMatchObject({ status: 'interrupted' });
  });

  it('keeps disconnect interruption authoritative over the stopped driver outcome', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    driver.stop = vi.fn(() => finish({ kind: 'cancelled' }));
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-1',
      instruction: 'open form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(1));
    await manager.interruptActive();
    await vi.waitFor(async () => expect(await manager.snapshot('task-1')).toMatchObject({ status: 'interrupted' }));
  });

  it('does not run an executor cancelled while it is being created', async () => {
    let finishCreate!: (driver: ExecutorDriver) => void;
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: vi.fn(() => new Promise<ExecutorDriver>(resolve => (finishCreate = resolve))),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-1',
      instruction: 'open form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(finishCreate).toBeTypeOf('function'));
    await manager.dispatch({ type: 'cancel', commandId: 'cancel-1', taskId: 'task-1', expectedRevision: 1 });
    finishCreate(driver);

    await vi.waitFor(() => expect(driver.stop).toHaveBeenCalledTimes(1));
    expect(driver.run).not.toHaveBeenCalled();
    await expect(manager.snapshot('task-1')).resolves.toMatchObject({ status: 'cancelled' });
  });

  it('does not run an executor while its task remains paused during creation', async () => {
    let finishCreate!: (driver: ExecutorDriver) => void;
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: vi.fn(() => new Promise<ExecutorDriver>(resolve => (finishCreate = resolve))),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-1',
      instruction: 'open form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(finishCreate).toBeTypeOf('function'));
    await manager.dispatch({ type: 'pause', commandId: 'pause-1', taskId: 'task-1', expectedRevision: 1 });
    finishCreate(driver);

    await vi.waitFor(() => expect(driver.stop).toHaveBeenCalledTimes(1));
    expect(driver.run).not.toHaveBeenCalled();
    await expect(manager.snapshot('task-1')).resolves.toMatchObject({ status: 'paused' });
  });

  it('replaces an executor when a follow-up changes the round during creation', async () => {
    const pendingCreates: Array<(driver: ExecutorDriver) => void> = [];
    const createdInputs: ExecutorInput[] = [];
    const createExecutor = vi.fn((input: ExecutorInput) => {
      createdInputs.push(input);
      return new Promise<ExecutorDriver>(resolve => pendingCreates.push(resolve));
    });
    const firstDriver = fakeDriver();
    const secondDriver = fakeDriver();
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-1',
      instruction: 'open form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(pendingCreates).toHaveLength(1));
    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-1',
      taskId: 'task-1',
      expectedRevision: 1,
      instruction: 'then pause it',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-2',
    });
    pendingCreates.shift()?.(firstDriver);

    await vi.waitFor(() => expect(pendingCreates).toHaveLength(1));
    expect(firstDriver.stop).toHaveBeenCalledTimes(1);
    expect(firstDriver.run).not.toHaveBeenCalled();
    expect(createExecutor).toHaveBeenCalledTimes(2);
    expect(createdInputs[1]).toMatchObject({ instruction: 'then pause it' });

    pendingCreates.shift()?.(secondDriver);
    await vi.waitFor(() => expect(secondDriver.run).toHaveBeenCalledTimes(1));
  });

  it('applies a running driver outcome to the latest follow-up round', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-1',
      instruction: 'open form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(1));
    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-1',
      taskId: 'task-1',
      expectedRevision: 1,
      instruction: 'then pause it',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-2',
    });
    finish({ kind: 'candidate_complete', summary: 'done' });
    await vi.waitFor(async () =>
      expect(await manager.snapshot('task-1')).toMatchObject({
        status: 'waiting_user',
        currentRoundId: expect.any(String),
        rounds: [{}, { status: 'waiting_user', waitReason: 'proof_required' }],
      }),
    );
  });

  it('consumes one persisted approval before invoking an external commit', async () => {
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (input, nextHooks) => {
        expect(input.taskId).toBe('task-approval');
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-approval',
      taskId: 'task-approval',
      instruction: 'submit the form with secret form value',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const pending = hooks.dispatchAction(new Action(executeExternalCommit, clickElementActionSchema, true), {
      intent: 'submit the form with secret form value',
      index: 4,
    });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-approval')).toMatchObject({ status: 'waiting_approval' });
    });
    const waiting = await manager.snapshot('task-approval');
    if (!waiting) throw new Error('Expected waiting approval snapshot');
    const round = waiting.rounds.find(item => item.id === waiting.currentRoundId);
    const approval = round?.approvals[0];
    if (!approval) throw new Error('Expected pending approval');
    expect(executeExternalCommit).not.toHaveBeenCalled();

    const approveCommand = {
      type: 'approve' as const,
      commandId: 'approve-1',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      approvalId: approval.id,
    };
    const ack = await manager.dispatch(approveCommand);
    const result = await pending;
    expect(result.actionResult.success).toBe(true);
    expect(executeExternalCommit).toHaveBeenCalledTimes(1);
    expect(await manager.dispatch(approveCommand)).toEqual(ack);
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-approval')).toMatchObject({
        status: 'running',
        rounds: [
          {
            attempts: [{ state: 'observed' }],
            approvals: [{ status: 'consumed' }],
          },
        ],
      });
    });
    expect(JSON.stringify(await manager.snapshot('task-approval'))).not.toContain('secret form value');
  });

  it('does not execute an approved commit after the task is paused', async () => {
    let hooks!: ExecutorHooks;
    let finishRecheck!: (value: typeof store.targetObservation) => void;
    store.observeActionTarget
      .mockResolvedValueOnce(store.targetObservation)
      .mockImplementationOnce(() => new Promise(resolve => (finishRecheck = resolve)));
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (input, nextHooks) => {
        expect(input.taskId).toBe('task-pause-race');
        hooks = nextHooks;
        return fakeDriver();
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-pause-race',
      taskId: 'task-pause-race',
      instruction: 'submit form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const pending = hooks.dispatchAction(new Action(executeExternalCommit, clickElementActionSchema, true), {
      intent: 'submit form',
      index: 4,
    });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-pause-race')).toMatchObject({ status: 'waiting_approval' });
    });
    const waiting = await manager.snapshot('task-pause-race');
    if (!waiting) throw new Error('Expected waiting approval snapshot');
    const round = waiting.rounds[0];
    const approval = round?.approvals[0];
    if (!round || !approval) throw new Error('Expected pending approval');
    await manager.dispatch({
      type: 'approve',
      commandId: 'approve-pause-race',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      approvalId: approval.id,
    });
    await vi.waitFor(() => expect(finishRecheck).toBeTypeOf('function'));
    const running = await manager.snapshot('task-pause-race');
    if (!running) throw new Error('Expected running snapshot');
    await manager.dispatch({
      type: 'pause',
      commandId: 'pause-before-commit',
      taskId: running.id,
      expectedRevision: running.revision,
    });
    finishRecheck(store.targetObservation);

    await expect(pending).rejects.toThrow('Task is not running');
    expect(executeExternalCommit).not.toHaveBeenCalled();
    await expect(manager.snapshot('task-pause-race')).resolves.toMatchObject({ status: 'paused' });
  });

  it('stops automatic execution when an approved commit outcome is uncertain', async () => {
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: vi.fn(async (input, nextHooks) => {
        expect(input.taskId).toBe('task-uncertain-live');
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-uncertain-live',
      taskId: 'task-uncertain-live',
      instruction: 'submit form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const pending = hooks.dispatchAction(
      new Action(
        vi.fn(async () => {
          throw new Error('click outcome unknown');
        }),
        clickElementActionSchema,
        true,
      ),
      { intent: 'submit form', index: 4 },
    );
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-uncertain-live')).toMatchObject({ status: 'waiting_approval' });
    });
    const waiting = await manager.snapshot('task-uncertain-live');
    if (!waiting) throw new Error('Expected waiting approval snapshot');
    const round = waiting.rounds[0];
    const approval = round?.approvals[0];
    if (!round || !approval) throw new Error('Expected pending approval');
    await manager.dispatch({
      type: 'approve',
      commandId: 'approve-uncertain-live',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      approvalId: approval.id,
    });

    await expect(pending).rejects.toThrow('click outcome unknown');
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-uncertain-live')).toMatchObject({
        status: 'waiting_user',
        rounds: [{ waitReason: 'commit_outcome_uncertain', attempts: [{ state: 'uncertain' }] }],
      });
    });
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps a disconnect-time commit uncertainty non-resumable', async () => {
    let hooks!: ExecutorHooks;
    let failCommit!: (error: Error) => void;
    const driver = fakeDriver();
    const executeExternalCommit = vi.fn(() => new Promise<ActionResult>((_resolve, reject) => (failCommit = reject)));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (input, nextHooks) => {
        expect(input.taskId).toBe('task-disconnect-uncertain');
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-disconnect-uncertain',
      taskId: 'task-disconnect-uncertain',
      instruction: 'submit form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const pending = hooks.dispatchAction(new Action(executeExternalCommit, clickElementActionSchema, true), {
      intent: 'submit form',
      index: 4,
    });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-disconnect-uncertain')).toMatchObject({ status: 'waiting_approval' });
    });
    const waiting = await manager.snapshot('task-disconnect-uncertain');
    if (!waiting) throw new Error('Expected waiting approval snapshot');
    const round = waiting.rounds[0];
    const approval = round?.approvals[0];
    if (!round || !approval) throw new Error('Expected pending approval');
    await manager.dispatch({
      type: 'approve',
      commandId: 'approve-disconnect-uncertain',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      approvalId: approval.id,
    });
    await vi.waitFor(() => expect(executeExternalCommit).toHaveBeenCalledTimes(1));

    await manager.interruptActive();
    const rejected = expect(pending).rejects.toThrow('commit outcome unknown after disconnect');
    failCommit(new Error('commit outcome unknown after disconnect'));

    await rejected;
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-disconnect-uncertain')).toMatchObject({
        status: 'waiting_user',
        rounds: [{ waitReason: 'commit_outcome_uncertain', attempts: [{ state: 'uncertain' }] }],
      });
    });
    const uncertain = await manager.snapshot('task-disconnect-uncertain');
    if (!uncertain) throw new Error('Expected uncertain snapshot');
    await expect(
      manager.dispatch({
        type: 'resume',
        commandId: 'resume-uncertain',
        taskId: uncertain.id,
        expectedRevision: uncertain.revision,
      }),
    ).resolves.toMatchObject({ accepted: false, error: 'invalid_transition' });
    expect(executeExternalCommit).toHaveBeenCalledTimes(1);
  });

  it('recovers an executing external commit as uncertain without invoking it', async () => {
    store.sessions.set('task-uncertain', {
      id: 'task-uncertain',
      goalSummary: 'User task',
      status: 'running',
      revision: 4,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'User instruction',
          status: 'running',
          commandAcks: {},
          criteria: [],
          attempts: [
            {
              id: 'attempt-1',
              roundId: 'round-1',
              actionName: 'click_element',
              effect: 'external_commit',
              argsDigest: 'digest',
              state: 'executing',
              proposedAt: 1,
            },
          ],
          approvals: [],
          evidence: [],
        },
      ],
    });
    const executeExternalCommit = vi.fn();
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => fakeDriver()),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });

    await manager.recover();

    expect(executeExternalCommit).not.toHaveBeenCalled();
    await expect(manager.snapshot('task-uncertain')).resolves.toMatchObject({
      status: 'waiting_user',
      rounds: [
        {
          status: 'waiting_user',
          waitReason: 'commit_outcome_uncertain',
          attempts: [{ state: 'uncertain' }],
        },
      ],
    });
  });

  it('rejects a stale pending approval during cold recovery', async () => {
    store.sessions.set('task-pending', {
      id: 'task-pending',
      goalSummary: 'User task',
      status: 'waiting_approval',
      revision: 3,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'User instruction',
          status: 'waiting_approval',
          commandAcks: {},
          criteria: [],
          attempts: [
            {
              id: 'attempt-1',
              roundId: 'round-1',
              actionName: 'click_element',
              effect: 'external_commit',
              argsDigest: 'digest',
              state: 'proposed',
              proposedAt: 1,
            },
          ],
          approvals: [
            {
              id: 'approval-1',
              attemptId: 'attempt-1',
              roundId: 'round-1',
              summary: 'Submit the current form',
              status: 'pending',
            },
          ],
          evidence: [],
        },
      ],
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => fakeDriver()),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });

    await manager.recover();

    await expect(manager.snapshot('task-pending')).resolves.toMatchObject({
      status: 'interrupted',
      rounds: [
        {
          attempts: [{ state: 'blocked' }],
          approvals: [{ status: 'rejected', decidedAt: 100 }],
        },
      ],
    });
  });

  it('applies revisioned pause, resume, follow-up, and cancel exactly once', async () => {
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-1',
      taskId: 'task-2',
      instruction: 'open form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    const stale = await manager.dispatch({
      type: 'pause',
      commandId: 'pause-stale',
      taskId: 'task-2',
      expectedRevision: 0,
    });
    expect(stale).toMatchObject({ accepted: false, error: 'stale_revision', revision: 1 });

    const pause = { type: 'pause' as const, commandId: 'pause-1', taskId: 'task-2', expectedRevision: 1 };
    const pauseAck = await manager.dispatch(pause);
    expect(await manager.dispatch(pause)).toEqual(pauseAck);
    expect(driver.pause).toHaveBeenCalledTimes(1);

    await manager.dispatch({ type: 'resume', commandId: 'resume-1', taskId: 'task-2', expectedRevision: 2 });
    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-1',
      taskId: 'task-2',
      expectedRevision: 3,
      instruction: 'then pause it',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-2',
    });
    await manager.dispatch({ type: 'cancel', commandId: 'cancel-1', taskId: 'task-2', expectedRevision: 4 });
    expect(
      await manager.dispatch({
        type: 'pause',
        commandId: 'pause-stale',
        taskId: 'task-2',
        expectedRevision: 0,
      }),
    ).toEqual(stale);
    await expect(manager.snapshot('task-2')).resolves.toMatchObject({
      status: 'cancelled',
      revision: 5,
      currentRoundId: expect.any(String),
      rounds: [{ id: expect.any(String) }, { instructionMessageId: 'message-2' }],
    });
    expect(driver.resume).toHaveBeenCalledTimes(1);
    expect(driver.addFollowUp).toHaveBeenCalledWith('then pause it');
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });
});
