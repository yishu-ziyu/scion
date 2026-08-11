import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../manager';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome, ObserveCriteria } from '../contracts';
import { Action } from '../../agent/actions/builder';
import {
  clickElementActionSchema,
  closeTabActionSchema,
  controlMediaActionSchema,
  waitActionSchema,
} from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { sha256 } from '../digest';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  chatSessions: new Map<string, unknown>(),
  evidenceSpaces: new Map<string, { taskId: string; records: Array<{ recordType: string }>; workCycles: number }>(),
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

vi.mock('@extension/storage/lib/chat', () => ({
  chatHistoryStore: {
    getSession: async (id: string) => structuredClone(store.chatSessions.get(id) ?? null),
  },
}));

vi.mock('@extension/storage/lib/task', () => {
  const skillSave = new Map<string, { templates: unknown[]; unsafe: boolean }>();
  return {
    getTask: async (id: string) => store.sessions.get(id) ?? null,
    getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
    saveTask: store.saveTask,
    getEvidenceSpace: async (taskId: string) => structuredClone(store.evidenceSpaces.get(taskId) ?? null),
    evidenceSpaceProgress: (space: { records?: Array<{ recordType: string }> } | null) => ({
      total: space?.records?.length ?? 0,
      userDiscussions: space?.records?.filter(record => record.recordType === 'user_discussion').length ?? 0,
      products: space?.records?.filter(record => record.recordType === 'product').length ?? 0,
      repository: space?.records?.filter(record => record.recordType === 'repository').length ?? 0,
      browserContext: space?.records?.filter(record => record.recordType === 'browser_context').length ?? 0,
      productPrinciples: space?.records?.filter(record => record.recordType === 'product_principle').length ?? 0,
    }),
    researchDecisionReady: (space: { researchDecision?: unknown } | null) => Boolean(space?.researchDecision),
    researchDeliveryReady: (space: { researchDelivery?: unknown } | null) => Boolean(space?.researchDelivery),
    advanceEvidenceWorkCycle: async (taskId: string) => {
      const current = store.evidenceSpaces.get(taskId) ?? { taskId, records: [], workCycles: 0 };
      const next = { ...current, workCycles: current.workCycles + 1 };
      store.evidenceSpaces.set(taskId, next);
      return structuredClone(next);
    },
    putSkillSaveMeta: async (taskId: string, roundId: string, meta: { templates: unknown[]; unsafe: boolean }) => {
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

/** Instant post-commit verify in unit tests (production uses short backoff). */
const noPostCommitBackoff = { postCommitVerifyDelaysMs: [0] as number[] };

async function taskRoundId(manager: TaskManager, taskId: string): Promise<string> {
  const task = await manager.snapshot(taskId);
  if (!task) throw new Error(`Expected task ${taskId}`);
  return task.currentRoundId;
}

describe('TaskManager lifecycle', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.chatSessions.clear();
    store.evidenceSpaces.clear();
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
      ...noPostCommitBackoff,
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

  it('persists a mission plan without raw instruction text', async () => {
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-plan',
      taskId: 'task-plan',
      instruction: '调研竞品；输出表格；写结论',
      chatSessionId: 'chat-plan',
      instructionMessageId: 'message-plan',
      tabId: 7,
    });
    const snap = await manager.snapshot('task-plan');
    expect(snap?.plan?.phases).toHaveLength(3);
    expect(snap?.plan?.phases[0]).toMatchObject({ id: 'phase-1', title: '调研', status: 'active' });
    expect(snap?.plan?.phases[1]?.title).toBe('输出');
    expect(snap?.plan?.phases[2]?.title).toBe('总结');
    expect(snap?.plan?.goal).toBe('User task');
    expect(JSON.stringify(snap)).not.toContain('竞品');
  });

  it('continues an explicit quota research task after max_steps from durable evidence progress', async () => {
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'failed', category: 'max_steps' })
      .mockResolvedValueOnce({ kind: 'failed', category: 'stopped_after_checkpoint' });
    store.evidenceSpaces.set('task-research-cycle', {
      taskId: 'task-research-cycle',
      records: [
        ...Array.from({ length: 12 }, () => ({ recordType: 'user_discussion' })),
        ...Array.from({ length: 4 }, () => ({ recordType: 'product' })),
      ],
      workCycles: 0,
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-research-cycle',
      taskId: 'task-research-cycle',
      instruction: '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。',
      chatSessionId: 'chat-research-cycle',
      instructionMessageId: 'message-research-cycle',
      tabId: 7,
    });

    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('user_discussions=12/80'));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('products=4/30'));
    expect(store.evidenceSpaces.get('task-research-cycle')?.workCycles).toBe(1);
    await vi.waitFor(async () => expect((await manager.snapshot('task-research-cycle'))?.status).toBe('failed'));
  });

  it('rejects premature research completion until durable quotas are met', async () => {
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'candidate_complete', summary: 'Research complete.' })
      .mockResolvedValueOnce({ kind: 'failed', category: 'stopped_after_checkpoint' });
    store.evidenceSpaces.set('task-research-premature', {
      taskId: 'task-research-premature',
      records: [
        ...Array.from({ length: 12 }, () => ({ recordType: 'user_discussion' })),
        ...Array.from({ length: 4 }, () => ({ recordType: 'product' })),
      ],
      workCycles: 0,
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-research-premature',
      taskId: 'task-research-premature',
      instruction: '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。',
      chatSessionId: 'chat-research-premature',
      instructionMessageId: 'message-research-premature',
      tabId: 7,
    });

    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('Candidate completion rejected'));
    expect(store.evidenceSpaces.get('task-research-premature')?.workCycles).toBe(1);
    await vi.waitFor(async () => expect((await manager.snapshot('task-research-premature'))?.status).toBe('failed'));
  });

  it('recovers a quota research task from a single-source action failure', async () => {
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'failed', category: 'action_failed' })
      .mockResolvedValueOnce({ kind: 'failed', category: 'stopped_after_checkpoint' });
    store.evidenceSpaces.set('task-research-source-failure', {
      taskId: 'task-research-source-failure',
      records: [],
      workCycles: 0,
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-research-source-failure',
      taskId: 'task-research-source-failure',
      instruction: '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。',
      chatSessionId: 'chat-research-source-failure',
      instructionMessageId: 'message-research-source-failure',
      tabId: 7,
    });

    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('abandon the failing source'));
  });

  it('preserves mission plan across pause and resume', async () => {
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-plan-resume',
      taskId: 'task-plan-resume',
      instruction: '调研 10 家竞品；输出对比表；写一份结论',
      chatSessionId: 'chat-plan-resume',
      instructionMessageId: 'message-plan-resume',
      tabId: 7,
    });
    const before = await manager.snapshot('task-plan-resume');
    const planBefore = structuredClone(before?.plan);
    expect(planBefore?.phases.map(p => p.title)).toEqual(['调研', '输出', '总结']);

    await manager.dispatch({
      type: 'pause',
      commandId: 'pause-plan',
      taskId: 'task-plan-resume',
      expectedRevision: 1,
    });
    await manager.dispatch({
      type: 'resume',
      commandId: 'resume-plan',
      taskId: 'task-plan-resume',
      expectedRevision: 2,
    });

    const after = await manager.snapshot('task-plan-resume');
    expect(after?.status).toBe('running');
    expect(after?.plan).toEqual(planBefore);
    expect(JSON.stringify(after?.plan)).not.toContain('竞品');
  });

  it('attaches freeze criteria to the active mission phase', async () => {
    let hooks!: ExecutorHooks;
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: false,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-plan-attach',
      taskId: 'task-plan-attach',
      instruction: '调研竞品；输出表格；写结论',
      chatSessionId: 'chat-plan-attach',
      instructionMessageId: 'message-plan-attach',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-plan-attach');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: '对比表', required: true }]);
    const snap = await manager.snapshot('task-plan-attach');
    const criterionId = snap?.rounds[0]?.criteria[0]?.id;
    expect(criterionId).toBeTruthy();
    expect(snap?.plan?.phases[0]).toMatchObject({
      status: 'active',
      criteriaIds: [criterionId],
    });
    expect(snap?.plan?.phases[1]?.criteriaIds).toEqual([]);
  });

  it('does not advance multi-phase plan from successful action counts without criteria evidence', async () => {
    let hooks!: ExecutorHooks;
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-plan-no-heuristic',
      taskId: 'task-plan-no-heuristic',
      instruction: '调研竞品；输出表格；写结论',
      chatSessionId: 'chat-plan-no-heuristic',
      instructionMessageId: 'message-plan-no-heuristic',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-plan-no-heuristic');
    // Browser operations are activity, not outcome evidence. Empty-criteria phases
    // remain stable until criteria or a verified terminal receipt proves progress.
    await hooks.dispatchAction(roundId, new Action(async () => new ActionResult({ success: true }), waitActionSchema), {
      seconds: 1,
      intent: 'wait',
    });
    let snap = await manager.snapshot('task-plan-no-heuristic');
    expect(snap?.plan?.phases.map(p => p.status)).toEqual(['active', 'planned', 'planned']);

    await hooks.dispatchAction(roundId, new Action(async () => new ActionResult({ success: true }), waitActionSchema), {
      seconds: 1,
      intent: 'wait again',
    });
    snap = await manager.snapshot('task-plan-no-heuristic');
    expect(snap?.plan?.phases.map(p => p.status)).toEqual(['active', 'planned', 'planned']);
  });

  it('marks remaining mission phases done on verified complete', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    let pageTextPresent = false;
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 200,
          source: 'page' as const,
          value: item.kind === 'page_text' ? pageTextPresent : false,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-plan-done',
      taskId: 'task-plan-done',
      instruction: '调研竞品；输出表格；写结论',
      chatSessionId: 'chat-plan-done',
      instructionMessageId: 'message-plan-done',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-plan-done');
    // Freeze while baseline is false so post-complete observations can pass.
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'done marker', required: true }]);

    // Intermediate progress already marked phase-1 done.
    const mid = await manager.snapshot('task-plan-done');
    if (mid?.plan) {
      mid.plan.phases[0] = {
        ...mid.plan.phases[0]!,
        status: 'done',
        evidenceIds: [...(mid.plan.phases[0]?.evidenceIds ?? []), 'seed'],
      };
      mid.plan.phases[1] = { ...mid.plan.phases[1]!, status: 'active' };
      if (mid.plan.phases[0]?.status === 'done' && mid.plan.phases[1]?.status === 'active') {
        store.sessions.set('task-plan-done', structuredClone(mid));
      }
    }

    pageTextPresent = true;
    finish({ kind: 'candidate_complete', summary: 'all done' });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-plan-done')).toMatchObject({ status: 'completed' });
    });
    const done = await manager.snapshot('task-plan-done');
    expect(done?.plan?.phases.map(p => p.status)).toEqual(['done', 'done', 'done']);
    // Intermediate evidence preserved on the already-done phase.
    expect(done?.plan?.phases[0]?.evidenceIds).toContain('seed');
  });

  it('rejects a second concurrent task', async () => {
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
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
          evidence: [],
        },
      ],
    });
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.recover();
    await expect(manager.snapshot('task-1')).resolves.toMatchObject({ status: 'interrupted' });
  });

  it('automatically resumes an explicit quota research task after service-worker recovery', async () => {
    const instruction = '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。';
    store.sessions.set('task-recover-research', {
      id: 'task-recover-research',
      goalSummary: 'User task',
      chatSessionId: 'chat-recover-research',
      instructionMessageId: 'message-recover-research',
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
          instructionMessageId: 'message-recover-research',
          instructionSummary: 'User instruction',
          status: 'running',
          commandAcks: {},
          criteria: [],
          attempts: [
            {
              id: 'attempt-read',
              roundId: 'round-1',
              actionName: 'record_evidence',
              effect: 'read',
              argsDigest: 'digest',
              state: 'executing',
              proposedAt: 1,
            },
          ],
          evidence: [],
        },
      ],
    });
    store.chatSessions.set('chat-recover-research', {
      messages: [{ id: 'message-recover-research', content: instruction }],
    });
    const driver = fakeDriver();
    const createExecutor = vi.fn(async () => driver);
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.recover();

    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    await expect(manager.snapshot('task-recover-research')).resolves.toMatchObject({
      status: 'running',
      rounds: [{ status: 'running', attempts: [{ state: 'uncertain', effect: 'read' }] }],
    });
  });

  it('keeps an explicitly paused quota research task paused after extension reload', async () => {
    const instruction = '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。';
    store.sessions.set('task-paused-research', {
      id: 'task-paused-research',
      goalSummary: 'User task',
      chatSessionId: 'chat-paused-research',
      instructionMessageId: 'message-paused-research',
      status: 'paused',
      revision: 4,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionMessageId: 'message-paused-research',
          instructionSummary: 'User instruction',
          status: 'paused',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
    });
    store.chatSessions.set('chat-paused-research', {
      messages: [{ id: 'message-paused-research', content: instruction }],
    });
    const createExecutor = vi.fn(async () => fakeDriver());
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.recover();

    expect(createExecutor).not.toHaveBeenCalled();
    await expect(manager.snapshot('task-paused-research')).resolves.toMatchObject({
      status: 'paused',
      rounds: [{ status: 'paused' }],
    });
  });

  it('automatically resumes an interrupted explicit quota research task after extension reload', async () => {
    const instruction = '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。';
    store.sessions.set('task-recover-interrupted-research', {
      id: 'task-recover-interrupted-research',
      goalSummary: 'User task',
      chatSessionId: 'chat-recover-interrupted-research',
      instructionMessageId: 'message-recover-interrupted-research',
      status: 'interrupted',
      revision: 5,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionMessageId: 'message-recover-interrupted-research',
          instructionSummary: 'User instruction',
          status: 'interrupted',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
    });
    store.chatSessions.set('chat-recover-interrupted-research', {
      messages: [{ id: 'message-recover-interrupted-research', content: instruction }],
    });
    const createExecutor = vi.fn(async () => fakeDriver());
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.recover();

    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    await expect(manager.snapshot('task-recover-interrupted-research')).resolves.toMatchObject({
      status: 'running',
      rounds: [{ status: 'running' }],
    });
  });

  it('reopens a quota research task that failed on a recoverable source-path error', async () => {
    const instruction = '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。';
    store.sessions.set('task-recover-failed-research', {
      id: 'task-recover-failed-research',
      goalSummary: 'User task',
      chatSessionId: 'chat-recover-failed-research',
      instructionMessageId: 'message-recover-failed-research',
      status: 'failed',
      revision: 4,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionMessageId: 'message-recover-failed-research',
          instructionSummary: 'User instruction',
          status: 'failed',
          failureCategory: 'no_action',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
    });
    store.chatSessions.set('chat-recover-failed-research', {
      messages: [{ id: 'message-recover-failed-research', content: instruction }],
    });
    const createExecutor = vi.fn(async () => fakeDriver());
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.recover();

    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    await expect(manager.snapshot('task-recover-failed-research')).resolves.toMatchObject({
      status: 'running',
      rounds: [{ status: 'running' }],
    });
    expect((await manager.snapshot('task-recover-failed-research'))?.rounds[0]?.failureCategory).toBeUndefined();
  });

  it('migrates a legacy waiting_approval task to interrupted on recover', async () => {
    store.sessions.set('task-legacy-approval', {
      id: 'task-legacy-approval',
      goalSummary: 'User task',
      status: 'waiting_approval',
      revision: 2,
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
          attempts: [],
          evidence: [],
        },
      ],
    });
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 200,
      ...noPostCommitBackoff,
    });
    await manager.recover();
    await expect(manager.snapshot('task-legacy-approval')).resolves.toMatchObject({
      status: 'interrupted',
      rounds: [{ status: 'interrupted' }],
    });
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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

  it('persists a direction-change round and resumes from interrupted state', async () => {
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-direction',
      taskId: 'task-direction',
      instruction: 'research the current page',
      chatSessionId: 'chat-direction',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(1));

    const interrupted = structuredClone(store.sessions.get('task-direction')) as {
      status: string;
      revision: number;
      currentRoundId: string;
      rounds: Array<{ id: string; status: string }>;
    };
    interrupted.status = 'interrupted';
    interrupted.rounds.find(round => round.id === interrupted.currentRoundId)!.status = 'interrupted';
    store.sessions.set('task-direction', interrupted);

    const ack = await manager.dispatch({
      type: 'follow_up',
      commandId: 'adjust-direction',
      taskId: 'task-direction',
      expectedRevision: interrupted.revision,
      instruction: 'focus only on official product documentation',
      chatSessionId: 'chat-direction',
      instructionMessageId: 'message-2',
      changeType: 'direction_change',
    });

    expect(ack.accepted).toBe(true);
    expect(driver.addFollowUp).toHaveBeenCalledWith('focus only on official product documentation');
    expect(driver.resume).toHaveBeenCalledOnce();
    await expect(manager.snapshot('task-direction')).resolves.toMatchObject({
      status: 'running',
      rounds: [
        {},
        {
          instructionSummary: 'Direction changed',
          changeType: 'direction_change',
          createdAt: 100,
          status: 'running',
        },
      ],
    });
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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
      ...noPostCommitBackoff,
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

  it('does not verified-complete play+copy goals when only media criteria pass after act', async () => {
    let hooks!: ExecutorHooks;
    const digest = 'b'.repeat(64);
    store.observeMedia.mockResolvedValue({ kind: 'bound', targetDigest: digest, state: 'playing' });
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
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-play-copy',
      taskId: 'task-play-copy',
      instruction: '打开B站 播放第一个视频 并复制第一个评论发给我',
      chatSessionId: 'chat-play-copy',
      instructionMessageId: 'message-play-copy',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-play-copy');
    await hooks.onPlan(roundId, [{ kind: 'media_state', operator: 'equals', expected: 'playing', required: true }]);
    await hooks.dispatchAction(
      roundId,
      new Action(async () => new ActionResult({ success: true }), controlMediaActionSchema),
      { command: 'play', intent: 'play video', target_digest: digest },
    );
    const snap = await manager.snapshot('task-play-copy');
    expect(snap?.status).toBe('running');
    expect(snap?.rounds[0]?.receipt).toBeUndefined();
  });

  it('binds close_tab without tab_id to the task active tab and freezes tab_state closed', async () => {
    let hooks!: ExecutorHooks;
    const executeClose = vi.fn(async () => new ActionResult({ success: true }));
    const probeTabState = vi.fn(async () => 'active' as const);
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      probeTabState,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-close-tab',
      taskId: 'task-close-tab',
      instruction: '关掉这个页',
      chatSessionId: 'chat-close',
      instructionMessageId: 'message-close',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-close-tab');

    await hooks.onPlan(roundId, []);
    const planned = await manager.snapshot('task-close-tab');
    expect(planned?.rounds[0]?.criteria).toEqual([
      expect.objectContaining({ kind: 'tab_state', expected: 'closed', targetRefId: 'tab-7' }),
    ]);

    await hooks.dispatchAction(roundId, new Action(executeClose, closeTabActionSchema), {
      intent: 'close this page',
    });
    expect(executeClose).toHaveBeenCalledWith(expect.objectContaining({ tab_id: 7 }));
    expect(probeTabState).toHaveBeenCalled();
  });

  it('freezes download_state finished for download goals so verbal done cannot false-complete', async () => {
    let hooks!: ExecutorHooks;
    const probeDownloadState = vi.fn(async () => 'none' as const);
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      probeDownloadState,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-download',
      taskId: 'task-download',
      instruction: '下载这个视频',
      chatSessionId: 'chat-download',
      instructionMessageId: 'message-download',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-download');
    await hooks.onPlan(roundId, []);
    const planned = await manager.snapshot('task-download');
    expect(planned?.rounds[0]?.criteria).toEqual([
      expect.objectContaining({
        kind: 'download_state',
        expected: 'finished',
        targetRefId: 'download:session',
        baseline: 'none',
      }),
    ]);
    expect(probeDownloadState).toHaveBeenCalled();
  });

  it('freezes media_state paused for pause goals', async () => {
    let hooks!: ExecutorHooks;
    store.observeMedia.mockResolvedValue({ kind: 'bound', targetDigest: 'a'.repeat(64), state: 'playing' });
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-pause-implicit',
      taskId: 'task-pause-implicit',
      instruction: '暂停这个视频',
      chatSessionId: 'chat-media',
      instructionMessageId: 'message-pause',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-pause-implicit');
    await hooks.onPlan(roundId, []);
    const planned = await manager.snapshot('task-pause-implicit');
    expect(planned?.rounds[0]?.criteria).toEqual([
      expect.objectContaining({ kind: 'media_state', expected: 'paused' }),
    ]);
  });

  it('executes an external commit exactly once without approval and keeps target binding', async () => {
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
      ...noPostCommitBackoff,
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
    const result = await hooks.dispatchAction(
      approvalRoundId,
      new Action(executeExternalCommit, clickElementActionSchema, true),
      {
        intent: 'submit the form with secret form value',
        index: 4,
      },
    );
    expect(result.actionResult.success).toBe(true);
    expect(executeExternalCommit).toHaveBeenCalledTimes(1);
    const snap = await manager.snapshot('task-approval');
    expect(snap?.rounds[0]?.attempts[0]?.state).toBe('observed');
    expect(JSON.stringify(snap)).not.toContain('secret form value');
  });

  it('keeps external commit state internal without a user approval record', async () => {
    let hooks!: ExecutorHooks;
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return fakeDriver();
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-approval-replay',
      taskId: 'task-approval-replay',
      instruction: 'submit form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-approval-replay');
    const result = await hooks.dispatchAction(
      roundId,
      new Action(executeExternalCommit, clickElementActionSchema, true),
      {
        intent: 'submit form',
        index: 4,
      },
    );
    expect(executeExternalCommit).toHaveBeenCalledTimes(1);
    expect(result.attempt.state).toBe('observed');
  });

  it('freezes success text from the instruction when the planner returns empty criteria', async () => {
    const driver = fakeDriver();
    let observeCall = 0;
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
      observeCall += 1;
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: false,
      }));
    });
    let hooks!: ExecutorHooks;
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-implicit',
      taskId: 'task-implicit',
      instruction: 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
      chatSessionId: 'chat-implicit',
      instructionMessageId: 'message-implicit',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    // Pre-freeze from instruction before the planner runs.
    await expect(manager.snapshot('task-implicit')).resolves.toMatchObject({
      rounds: [
        {
          criteria: [
            expect.objectContaining({
              kind: 'page_text',
              targetRefId: 'tab-7',
              baseline: false,
            }),
          ],
        },
      ],
    });
    const roundId = await taskRoundId(manager, 'task-implicit');
    // Empty planner criteria must not wipe the already-frozen set.
    await hooks.onPlan(roundId, []);
    const snap = await manager.snapshot('task-implicit');
    expect(snap?.rounds[0]?.criteria).toHaveLength(1);
    expect(observeCall).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(snap)).not.toContain('Saved successfully');
    expect(JSON.stringify(snap)).not.toContain('FIELD_SENTINEL_8472');
  });

  it.each([
    '点击当前页面的 Submit 按钮；看到 Saved successfully 后完成。',
    '点击当前页面的 Submit 按钮；看到“Saved successfully”后完成。',
    '点击当前页面的 Submit 按钮；看到 Saved successfully 后，完成。',
  ])('excludes a trailing Chinese completion clause from frozen success text: %s', async instruction => {
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: false,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-chinese-success-text',
      taskId: 'task-chinese-success-text',
      instruction,
      chatSessionId: 'chat-chinese-success-text',
      instructionMessageId: 'message-chinese-success-text',
      tabId: 7,
    });

    await vi.waitFor(async () => {
      await expect(manager.snapshot('task-chinese-success-text')).resolves.toMatchObject({
        rounds: [
          {
            criteria: [
              expect.objectContaining({
                kind: 'page_text',
                expectedDigest: await sha256('Saved successfully'),
              }),
            ],
          },
        ],
      });
    });
  });

  it('freezes open-site url criteria from the instruction when the planner omits them', async () => {
    const driver = fakeDriver();
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: item.kind === 'url' ? 'about:blank' : false,
      })),
    );
    let hooks!: ExecutorHooks;
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-open-site',
      taskId: 'task-open-site',
      instruction: '打开 YouTube',
      chatSessionId: 'chat-open-site',
      instructionMessageId: 'message-open-site',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    await expect(manager.snapshot('task-open-site')).resolves.toMatchObject({
      rounds: [
        {
          criteria: [
            expect.objectContaining({
              kind: 'url',
              operator: 'starts_with',
              expected: 'https://www.youtube.com/',
              targetRefId: 'tab-7',
            }),
          ],
        },
      ],
    });
    const roundId = await taskRoundId(manager, 'task-open-site');
    await hooks.onPlan(roundId, []);
    const snap = await manager.snapshot('task-open-site');
    expect(snap?.rounds[0]?.criteria).toHaveLength(1);
    expect(snap?.rounds[0]?.criteria[0]).toMatchObject({
      kind: 'url',
      operator: 'starts_with',
      expected: 'https://www.youtube.com/',
    });
  });

  it('does not complete from optional criteria without required proof', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValue({ kind: 'candidate_complete', summary: 'still done' });
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-optional-proof',
      taskId: 'task-optional-proof',
      instruction: 'organize this page',
      chatSessionId: 'chat-optional-proof',
      instructionMessageId: 'message-optional-proof',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-optional-proof');
    await hooks.onPlan(roundId, [
      { kind: 'page_text', operator: 'present', expected: 'Optional hint', required: false },
    ]);

    finish({ kind: 'candidate_complete', summary: 'done' });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-optional-proof')).toMatchObject({
        status: 'waiting_user',
        rounds: [{ status: 'waiting_user', waitReason: 'proof_required' }],
      });
    });
    expect((await manager.snapshot('task-optional-proof'))?.rounds[0]?.receipt).toBeUndefined();
  });

  it('freezes /watch url criteria when the goal is open YouTube and click the first video', async () => {
    const driver = fakeDriver();
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: item.kind === 'url' ? 'about:blank' : false,
      })),
    );
    let hooks!: ExecutorHooks;
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-open-watch',
      taskId: 'task-open-watch',
      // No space after 打开; mirrors real side-panel phrasing from Die browser.
      instruction: '打开YouTube，并且点击第一行的第一个视频。',
      chatSessionId: 'chat-open-watch',
      instructionMessageId: 'message-open-watch',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    await expect(manager.snapshot('task-open-watch')).resolves.toMatchObject({
      rounds: [
        {
          criteria: [
            expect.objectContaining({
              kind: 'url',
              operator: 'starts_with',
              expected: 'https://www.youtube.com/watch',
              targetRefId: 'tab-7',
            }),
          ],
        },
      ],
    });
  });

  it('settles completed after a reversible video click when /watch criteria pass', async () => {
    let hooks!: ExecutorHooks;
    let now = 100;
    let observeCall = 0;
    const driver = fakeDriver();
    const executeClick = vi.fn(async () => new ActionResult({ success: true }));
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'thumb-1',
        kind: 'element' as const,
        tabId: 7,
        frameId: 0 as const,
        urlOrigin: 'https://www.youtube.com',
        digest: 'thumb-1',
      },
      tag: 'a',
      type: '',
      inForm: false,
    });
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
      observeCall += 1;
      // freeze baseline home; post-click probe is the watch page
      const urlValue = observeCall >= 2 ? 'https://www.youtube.com/watch?v=abc' : 'https://www.youtube.com/';
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: now,
        source: 'page' as const,
        value: item.kind === 'url' ? urlValue : false,
      }));
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => now,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-watch-click',
      taskId: 'task-watch-click',
      instruction: '打开YouTube，并且点击第一个视频',
      chatSessionId: 'chat-watch-click',
      instructionMessageId: 'message-watch-click',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-watch-click');
    await hooks.onPlan(roundId, []);
    now = 160;
    await hooks.dispatchAction(roundId, new Action(executeClick, clickElementActionSchema, true), {
      index: 1,
      intent: 'Open first video',
    });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-watch-click')).toMatchObject({
        status: 'completed',
        rounds: [{ receipt: { taskId: 'task-watch-click' } }],
      });
    });
    expect(executeClick).toHaveBeenCalledTimes(1);
    const snap = await manager.snapshot('task-watch-click');
    expect(snap?.rounds[0]?.attempts[0]?.state).toBe('observed');
  });

  it('recovers open-site criteria after candidate_complete and completes with a receipt', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    // Pre-run freeze baselines about:blank; post-complete probe sees YouTube.
    let observeCall = 0;
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
      observeCall += 1;
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: item.kind === 'url' ? (observeCall >= 2 ? 'https://www.youtube.com/' : 'about:blank') : false,
      }));
    });
    let hooks!: ExecutorHooks;
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-open-complete',
      taskId: 'task-open-complete',
      instruction: 'open youtube',
      chatSessionId: 'chat-open-complete',
      instructionMessageId: 'message-open-complete',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-open-complete');
    // Simulate live MiniMax: no planner criteria at all (already frozen from instruction).
    await hooks.onPlan(roundId, []);
    finish({ kind: 'candidate_complete', summary: 'opened' });
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-open-complete'))?.status).toBe('completed');
    });
    const snap = await manager.snapshot('task-open-complete');
    expect(snap?.rounds[0]?.receipt).toBeTruthy();
    expect(snap?.rounds[0]?.criteria[0]).toMatchObject({
      kind: 'url',
      expected: 'https://www.youtube.com/',
    });
  });

  it('completes open-ended goals with a summary answer instead of hanging on proof_required', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi.fn().mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-open-ended',
      taskId: 'task-open-ended',
      // No freezeable success signal (unlike "打开 YouTube" / "success is …").
      instruction: '识别当前页',
      chatSessionId: 'chat-open-ended',
      instructionMessageId: 'message-open-ended',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-open-ended');
    expect((await manager.snapshot('task-open-ended'))?.rounds[0]?.criteria).toEqual([]);
    await hooks.onPlan(roundId, []);
    finish({ kind: 'candidate_complete', summary: '是。host=bilibili.com' });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-open-ended')).toMatchObject({
        status: 'completed',
        rounds: [
          {
            status: 'completed',
            instructionSummary: '是。host=bilibili.com',
            receipt: expect.objectContaining({ taskId: 'task-open-ended' }),
          },
        ],
      });
    });
    const snap = await manager.snapshot('task-open-ended');
    expect(snap?.rounds[0]?.waitReason).toBeUndefined();
    expect(snap?.rounds[0]?.failureCategory).toBeUndefined();
  });

  it('retries an acknowledgement and completes only with the requested page summary', async () => {
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockResolvedValueOnce({
        kind: 'candidate_complete',
        summary: '好的，我来读取当前 AICSS 页面的内容并用一句话说明。',
      })
      .mockResolvedValueOnce({
        kind: 'candidate_complete',
        summary: '当前 AICSS 页面展示了一个已完成五项任务的 To-do List 组件及其 React 示例代码。',
      });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-aicss-summary',
      taskId: 'task-aicss-summary',
      instruction: '用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。',
      chatSessionId: 'chat-aicss-summary',
      instructionMessageId: 'message-aicss-summary',
      tabId: 7,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-aicss-summary')).toMatchObject({
        status: 'completed',
        rounds: [
          {
            status: 'completed',
            instructionSummary: '当前 AICSS 页面展示了一个已完成五项任务的 To-do List 组件及其 React 示例代码。',
          },
        ],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('substantive text answer'));
    expect((await manager.snapshot('task-aicss-summary'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('fails a summary task after one retry without a deliverable instead of waiting for confirmation', async () => {
    const driver = fakeDriver();
    driver.run = vi.fn().mockResolvedValue({
      kind: 'candidate_complete',
      summary: '好的，我来读取当前页面并用一句话说明。',
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-summary-missing',
      taskId: 'task-summary-missing',
      instruction: '用一句话说明当前页面展示的内容。',
      chatSessionId: 'chat-summary-missing',
      instructionMessageId: 'message-summary-missing',
      tabId: 7,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-summary-missing')).toMatchObject({
        status: 'failed',
        rounds: [{ status: 'failed', failureCategory: 'no_action' }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect((await manager.snapshot('task-summary-missing'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('completes a read-only page summary with a substantive answer instead of proof_required', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi.fn().mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(criterion => ({
          criterionId: criterion.id,
          roundId: criterion.roundId,
          targetRefId: criterion.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: false,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-summary-with-criterion',
      taskId: 'task-summary-with-criterion',
      instruction: '用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。',
      chatSessionId: 'chat-summary-with-criterion',
      instructionMessageId: 'message-summary-with-criterion',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-summary-with-criterion');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'To-dos 5/5', required: true }]);
    finish({
      kind: 'candidate_complete',
      summary: 'The AICSS page presents a completed five-item To-do List component alongside its React example code.',
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-summary-with-criterion')).toMatchObject({
        status: 'completed',
        rounds: [
          {
            status: 'completed',
            instructionSummary:
              'The AICSS page presents a completed five-item To-do List component alongside its React example code.',
            criteria: [],
            receipt: { criterionIds: [] },
          },
        ],
      });
    });
    expect((await manager.snapshot('task-summary-with-criterion'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('fails a criterion-bearing read-only summary without text instead of proof_required', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({
        kind: 'candidate_complete',
        summary: '好的，我来读取当前页面并用一句话说明。',
      });
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(criterion => ({
          criterionId: criterion.id,
          roundId: criterion.roundId,
          targetRefId: criterion.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: false,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-summary-proof-regression',
      taskId: 'task-summary-proof-regression',
      instruction: '用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。',
      chatSessionId: 'chat-summary-proof-regression',
      instructionMessageId: 'message-summary-proof-regression',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-summary-proof-regression');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'To-dos 5/5', required: true }]);
    finish({
      kind: 'candidate_complete',
      summary: '好的，我来读取当前页面并用一句话说明。',
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-summary-proof-regression')).toMatchObject({
        status: 'failed',
        rounds: [{ status: 'failed', failureCategory: 'no_action' }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect((await manager.snapshot('task-summary-proof-regression'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('fails open-ended goals with empty criteria and empty summary', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({ kind: 'candidate_complete', summary: '   ' });
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-open-ended-empty',
      taskId: 'task-open-ended-empty',
      instruction: '识别当前页',
      chatSessionId: 'chat-open-ended-empty',
      instructionMessageId: 'message-open-ended-empty',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-open-ended-empty');
    await hooks.onPlan(roundId, []);
    finish({ kind: 'candidate_complete', summary: '   ' });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-open-ended-empty')).toMatchObject({
        status: 'failed',
        rounds: [{ status: 'failed', failureCategory: 'no_completion_criteria' }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
  });

  it('settles completed with a receipt right after external_commit when automatic criteria pass', async () => {
    let hooks!: ExecutorHooks;
    let now = 100;
    let observeCall = 0;
    const driver = fakeDriver();
    const executeExternalCommit = vi.fn(async () => new ActionResult({ success: true }));
    const switchTab = vi.fn();
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
      observeCall += 1;
      // 1 = freeze baseline (absent); 2 = first post-commit probe still absent; 3 = present
      const value = observeCall >= 3;
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: now,
        source: 'page' as const,
        value,
      }));
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab,
      observeCriteria,
      now: () => now,
      ...noPostCommitBackoff,
      // Exercise one backoff step without slowing the whole suite.
      postCommitVerifyDelaysMs: [0, 20],
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-post-commit',
      taskId: 'task-post-commit',
      instruction: 'submit the form',
      chatSessionId: 'chat-post-commit',
      instructionMessageId: 'message-post-commit',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-post-commit');
    await hooks.onPlan(roundId, [
      { kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true },
    ]);
    now = 160;
    const pending = hooks.dispatchAction(roundId, new Action(executeExternalCommit, clickElementActionSchema, true), {
      intent: 'submit the form',
      index: 1,
    });
    await pending;
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-post-commit')).toMatchObject({
        status: 'completed',
        rounds: [{ receipt: { taskId: 'task-post-commit' }, attempts: [{ state: 'observed' }] }],
      });
    });
    // freeze + post-commit verify; no candidate_complete path
    expect(observeCall).toBeGreaterThanOrEqual(2);
    expect(driver.run).toHaveBeenCalled();
    expect(switchTab).toHaveBeenCalledWith(7);
  });

  it('stops automatic execution when an external commit outcome is uncertain', async () => {
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
      ...noPostCommitBackoff,
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
    // Soft-return path: execute throw becomes ActionResult.error (no rethrow into loop).
    await expect(pending).resolves.toMatchObject({
      actionResult: { error: 'click outcome unknown' },
      attempt: { state: 'uncertain' },
    });
    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-uncertain-live')).toMatchObject({
        status: 'waiting_user',
        rounds: [{ waitReason: 'commit_outcome_uncertain', attempts: [{ state: 'uncertain' }] }],
      });
    });
    expect(driver.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps a disconnect-time commit uncertainty non-resumable and non-continuable', async () => {
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
      ...noPostCommitBackoff,
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
    await vi.waitFor(() => expect(executeExternalCommit).toHaveBeenCalledTimes(1));

    await manager.interruptActive();
    // Soft-return: commit throw resolves with error + uncertain (not promise reject).
    const settled = expect(pending).resolves.toMatchObject({
      actionResult: { error: 'commit outcome unknown after disconnect' },
      attempt: { state: 'uncertain' },
    });
    failCommit(new Error('commit outcome unknown after disconnect'));

    await settled;
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

    await expect(
      manager.dispatch({
        type: 'follow_up',
        commandId: 'continue-uncertain',
        taskId: uncertain.id,
        expectedRevision: uncertain.revision,
        instruction: 'continue and submit once',
        chatSessionId: 'chat-1',
        instructionMessageId: 'message-continue',
      }),
    ).resolves.toMatchObject({ accepted: false, error: 'invalid_transition' });
    const afterContinue = await manager.snapshot(uncertain.id);
    expect(afterContinue?.currentRoundId).toBe(uncertain.currentRoundId);
    expect(afterContinue?.rounds).toHaveLength(1);
    expect(afterContinue?.rounds[0]?.receipt).toBeUndefined();
    expect(driver.addFollowUp).not.toHaveBeenCalled();
    expect(executeExternalCommit).toHaveBeenCalledTimes(1);

    // Symmetric pause edge: uncertain waiting_user rejects pause (runtime already gates pause to running only).
    await expect(
      manager.dispatch({
        type: 'pause',
        commandId: 'pause-uncertain',
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
      ...noPostCommitBackoff,
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

  it('applies revisioned pause, resume, follow-up, and cancel exactly once', async () => {
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
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

  it('persists failureCategory on the round when the driver fails (UI surface)', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-fail-cat',
      taskId: 'task-fail-cat',
      instruction: 'open youtube',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(1));
    finish({ kind: 'failed', category: 'observe_failed' });
    await vi.waitFor(async () => {
      const snap = await manager.snapshot('task-fail-cat');
      expect(snap?.status).toBe('failed');
      expect(snap?.rounds[0]?.failureCategory).toBe('observe_failed');
    });
  });

  it('persists executor_start_failed when createExecutor throws', async () => {
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => {
        throw new Error('boom');
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-exec-fail',
      taskId: 'task-exec-fail',
      instruction: 'open youtube',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(async () => {
      const snap = await manager.snapshot('task-exec-fail');
      expect(snap?.status).toBe('failed');
      expect(snap?.rounds[0]?.failureCategory).toBe('executor_start_failed');
    });
  });
});
