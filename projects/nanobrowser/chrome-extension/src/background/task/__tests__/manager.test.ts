import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../manager';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome, ObserveCriteria } from '../contracts';
import { Action } from '../../agent/actions/builder';
import { clickElementActionSchema, controlMediaActionSchema, waitActionSchema } from '../../agent/actions/schemas';
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
  observeMedia: vi.fn(),
}));

vi.mock('@extension/storage/lib/task', () => {
  const skillSave = new Map<string, { templates: unknown[]; unsafe: boolean }>();
  return {
    getTask: async (id: string) => store.sessions.get(id) ?? null,
    getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
    saveTask: store.saveTask,
    putSkillSaveMeta: async (
      taskId: string,
      roundId: string,
      meta: { templates: unknown[]; unsafe: boolean },
    ) => {
      skillSave.set(`${taskId}:${roundId}`, structuredClone(meta));
    },
    getSkillSaveMeta: async (taskId: string, roundId: string) =>
      structuredClone(skillSave.get(`${taskId}:${roundId}`) ?? null),
    clearSkillSaveMetaForTask: async (taskId: string) => {
      for (const key of [...skillSave.keys()]) {
        if (key.startsWith(`${taskId}:`)) skillSave.delete(key);
      }
    },
  };
});

vi.mock('../../agent/factory', () => ({
  browserContext: {
    getCurrentPage: async () => ({
      observeActionTarget: store.observeActionTarget,
      observeMedia: store.observeMedia,
      tabId: 7,
      url: () => 'https://example.test/watch',
    }),
  },
}));

const fakeDriver = (): ExecutorDriver => ({
  run: vi.fn(() => new Promise<ExecutorOutcome>(() => {})),
  addFollowUp: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
});

async function taskRoundId(manager: TaskManager, taskId: string): Promise<string> {
  const task = await manager.snapshot(taskId);
  if (!task) throw new Error(`Expected task ${taskId}`);
  return task.currentRoundId;
}

describe('TaskManager lifecycle', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.saveTask.mockClear();
    store.observeActionTarget.mockReset();
    store.observeActionTarget.mockResolvedValue(store.targetObservation);
    store.observeMedia.mockReset();
    store.observeMedia.mockResolvedValue({ kind: 'missing' });
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
    driver.stop = vi.fn(async () => finish({ kind: 'cancelled' }));
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

  it('does not apply an old running driver outcome to a follow-up round', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    let oldRoundId = '';
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const createExecutor = vi.fn(async (input: ExecutorInput, nextHooks: ExecutorHooks) => {
      oldRoundId = input.roundId;
      hooks = nextHooks;
      return driver;
    });
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
    await expect(
      hooks.onPlan(oldRoundId, [{ kind: 'page_text', operator: 'present', expected: 'Old result', required: true }]),
    ).rejects.toThrow('Task round is no longer current');
    expect(driver.run).toHaveBeenCalledTimes(1);
    expect(driver.stop).not.toHaveBeenCalled();
    finish({ kind: 'candidate_complete', summary: 'done' });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    await expect(manager.snapshot('task-1')).resolves.toMatchObject({
      status: 'running',
      currentRoundId: expect.any(String),
      rounds: [{}, { status: 'running', criteria: [], evidence: [] }],
    });
    const currentRoundId = await taskRoundId(manager, 'task-1');
    expect(driver.run).toHaveBeenNthCalledWith(1, oldRoundId);
    expect(driver.run).toHaveBeenNthCalledWith(2, currentRoundId);
    expect(createExecutor).toHaveBeenCalledOnce();
  });

  it('waits for an in-flight action boundary before running a follow-up round', async () => {
    let finishRun!: (outcome: ExecutorOutcome) => void;
    let finishAction!: (result: ActionResult) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finishRun = resolve)));
    const createExecutor = vi.fn(async (_input: ExecutorInput, nextHooks: ExecutorHooks) => {
      hooks = nextHooks;
      return driver;
    });
    const executeAction = vi.fn(() => new Promise<ActionResult>(resolve => (finishAction = resolve)));
    store.observeActionTarget.mockResolvedValue({
      ...store.targetObservation,
      target: { ...store.targetObservation.target, id: 'target-8', tabId: 8 },
    });
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-safe-boundary',
      taskId: 'task-safe-boundary',
      instruction: 'wait, then continue',
      chatSessionId: 'chat-safe-boundary',
      instructionMessageId: 'message-safe-boundary',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    const oldRoundId = await taskRoundId(manager, 'task-safe-boundary');
    const pendingAction = hooks.dispatchAction(oldRoundId, new Action(executeAction, waitActionSchema), {
      intent: 'wait before continuing',
      seconds: 1,
    });
    await vi.waitFor(() => expect(executeAction).toHaveBeenCalledOnce());
    const executing = await manager.snapshot('task-safe-boundary');
    if (!executing) throw new Error('Expected executing task');

    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-safe-boundary',
      taskId: executing.id,
      expectedRevision: executing.revision,
      instruction: 'continue after the wait',
      chatSessionId: 'chat-safe-boundary',
      instructionMessageId: 'message-safe-boundary-2',
    });
    expect(driver.addFollowUp).toHaveBeenCalledWith('continue after the wait');
    expect(driver.run).toHaveBeenCalledOnce();
    expect(driver.stop).not.toHaveBeenCalled();
    expect(createExecutor).toHaveBeenCalledOnce();

    finishAction(new ActionResult({ success: true }));
    await expect(pendingAction).resolves.toMatchObject({ actionResult: { success: true } });
    expect(driver.run).toHaveBeenCalledOnce();
    await expect(manager.snapshot('task-safe-boundary')).resolves.toMatchObject({ activeTabId: 8 });

    finishRun({ kind: 'candidate_complete', summary: 'old round finished' });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    const newRoundId = await taskRoundId(manager, 'task-safe-boundary');
    expect(driver.run).toHaveBeenNthCalledWith(2, newRoundId);
    await expect(manager.snapshot('task-safe-boundary')).resolves.toMatchObject({
      status: 'running',
      rounds: [{ attempts: [{ state: 'observed' }] }, { status: 'running' }],
    });
  });

  it('waits for target rebinding instead of pausing an unknown media element', async () => {
    let hooks!: ExecutorHooks;
    const executeMedia = vi.fn(async () => new ActionResult({ success: true }));
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-missing-media',
      taskId: 'task-missing-media',
      instruction: 'pause the video',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-media',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-missing-media');

    const result = await hooks.dispatchAction(roundId, new Action(executeMedia, controlMediaActionSchema), {
      command: 'pause',
      intent: 'pause the same media',
    });

    expect(executeMedia).not.toHaveBeenCalled();
    expect(result).toMatchObject({ attempt: { state: 'blocked' }, actionResult: { error: 'media_target_missing' } });
    await expect(manager.snapshot('task-missing-media')).resolves.toMatchObject({
      status: 'waiting_user',
      rounds: [{ waitReason: 'target_missing', attempts: [{ state: 'blocked' }] }],
    });
  });

  it('maps an ambiguous media result to explicit user rebinding', async () => {
    let hooks!: ExecutorHooks;
    store.observeMedia.mockResolvedValue({ kind: 'ambiguous', candidateCount: 2 });
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-ambiguous-media',
      taskId: 'task-ambiguous-media',
      instruction: 'play a video',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-media',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-ambiguous-media');

    const result = await hooks.dispatchAction(
      roundId,
      new Action(async () => new ActionResult({ error: 'media_target_ambiguous' }), controlMediaActionSchema),
      { command: 'play', intent: 'play a video' },
    );

    expect(result.actionResult.error).toBe('media_target_ambiguous');
    await expect(manager.snapshot('task-ambiguous-media')).resolves.toMatchObject({
      status: 'waiting_user',
      rounds: [{ waitReason: 'target_ambiguous' }],
    });
  });

  it('binds an initial play to one live media digest before execution', async () => {
    let hooks!: ExecutorHooks;
    store.observeMedia
      .mockResolvedValueOnce({ kind: 'bound', targetDigest: 'media-1', state: 'paused' })
      .mockResolvedValueOnce({ kind: 'bound', targetDigest: 'media-1', state: 'paused' })
      .mockResolvedValueOnce({ kind: 'bound', targetDigest: 'media-1', state: 'playing' });
    const executeMedia = vi.fn(async () => new ActionResult({ success: true }));
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-bound-media',
      taskId: 'task-bound-media',
      instruction: 'play the video',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-media',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-bound-media');

    const result = await hooks.dispatchAction(roundId, new Action(executeMedia, controlMediaActionSchema), {
      command: 'play',
      intent: 'play the selected media',
    });

    expect(executeMedia).toHaveBeenCalledWith(expect.objectContaining({ command: 'play', target_digest: 'media-1' }));
    expect(result).toMatchObject({ targetRef: { id: 'media:media-1', kind: 'media', digest: 'media-1' } });
    await expect(manager.snapshot('task-bound-media')).resolves.toMatchObject({
      activeTabId: 7,
      targetRefs: [{ id: 'media:media-1', kind: 'media', digest: 'media-1' }],
    });
  });

  it('rebinds an omitted media digest to the most recently controlled target', async () => {
    let hooks!: ExecutorHooks;
    const firstDigest = 'a'.repeat(64);
    const secondDigest = 'b'.repeat(64);
    store.observeMedia.mockImplementation(async (targetDigest?: string) => ({
      kind: 'bound' as const,
      targetDigest: targetDigest ?? firstDigest,
      state: 'paused' as const,
    }));
    const executeMedia = vi.fn(async () => new ActionResult({ success: true }));
    const action = new Action(executeMedia, controlMediaActionSchema);
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-media-recency',
      taskId: 'task-media-recency',
      instruction: 'control several media elements',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-media',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-media-recency');

    for (const targetDigest of [firstDigest, secondDigest, firstDigest]) {
      await hooks.dispatchAction(roundId, action, {
        command: 'pause',
        intent: 'pause the selected media',
        target_digest: targetDigest,
      });
    }

    await expect(manager.snapshot('task-media-recency')).resolves.toMatchObject({
      targetRefs: [{ digest: secondDigest }, { digest: firstDigest }],
    });

    await hooks.dispatchAction(roundId, action, {
      command: 'pause',
      intent: 'pause the most recently controlled media',
    });
    expect(executeMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: 'pause', target_digest: firstDigest }),
    );
  });

  it('freezes follow-up media completion against the latest bound digest', async () => {
    let hooks!: ExecutorHooks;
    const digest = 'a'.repeat(64);
    const driver = fakeDriver();
    store.observeMedia.mockImplementation(async (targetDigest?: string) => ({
      kind: 'bound' as const,
      targetDigest: targetDigest ?? digest,
      state: 'playing' as const,
    }));
    const observeCriteria: ObserveCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
      criteria.map(criterion => ({
        criterionId: criterion.id,
        roundId: criterion.roundId,
        targetRefId: criterion.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: 'playing',
      })),
    );
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-media-criterion',
      taskId: 'task-media-criterion',
      instruction: 'play the video',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-media-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const firstRoundId = await taskRoundId(manager, 'task-media-criterion');
    await hooks.dispatchAction(
      firstRoundId,
      new Action(async () => new ActionResult({ success: true }), controlMediaActionSchema),
      { command: 'play', intent: 'play the selected media', target_digest: digest },
    );
    const afterPlay = await manager.snapshot('task-media-criterion');
    if (!afterPlay) throw new Error('Expected media task snapshot');

    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-media-criterion',
      taskId: afterPlay.id,
      expectedRevision: afterPlay.revision,
      instruction: 'now pause it',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-media-2',
    });
    const followUpRoundId = await taskRoundId(manager, 'task-media-criterion');
    await hooks.onPlan(followUpRoundId, [
      { kind: 'media_state', operator: 'equals', expected: 'paused', required: true },
    ]);

    const planned = await manager.snapshot('task-media-criterion');
    const followUpRound = planned?.rounds.find(round => round.id === followUpRoundId);
    expect(followUpRound?.criteria).toEqual([
      expect.objectContaining({
        kind: 'media_state',
        operator: 'equals',
        expected: 'paused',
        targetRefId: `media:${digest}`,
        baseline: 'playing',
      }),
    ]);
  });

  it('consumes one persisted approval before invoking an external commit', async () => {
    let hooks!: ExecutorHooks;
    let now = 100;
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
      now: () => now,
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
    const approvalRoundId = await taskRoundId(manager, 'task-approval');
    await hooks.onPlan(approvalRoundId, [
      { kind: 'page_text', operator: 'present', expected: 'Saved', required: true },
    ]);
    now = 150;
    const pending = hooks.dispatchAction(
      approvalRoundId,
      new Action(executeExternalCommit, clickElementActionSchema, true),
      {
        intent: 'submit the form with secret form value',
        index: 4,
      },
    );
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
            criteria: [{ notBefore: 150 }],
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
    const pauseRaceRoundId = await taskRoundId(manager, 'task-pause-race');
    const pending = hooks.dispatchAction(
      pauseRaceRoundId,
      new Action(executeExternalCommit, clickElementActionSchema, true),
      {
        intent: 'submit form',
        index: 4,
      },
    );
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
    const uncertainRoundId = await taskRoundId(manager, 'task-uncertain-live');
    const pending = hooks.dispatchAction(
      uncertainRoundId,
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
    const disconnectRoundId = await taskRoundId(manager, 'task-disconnect-uncertain');
    const pending = hooks.dispatchAction(
      disconnectRoundId,
      new Action(executeExternalCommit, clickElementActionSchema, true),
      {
        intent: 'submit form',
        index: 4,
      },
    );
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
