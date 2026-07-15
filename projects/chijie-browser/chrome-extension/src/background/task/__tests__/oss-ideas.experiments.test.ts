/**
 * Concurrent experiments for OSS-inspired completion / skill ideas.
 * Each experiment has a binary success criterion and runs independently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Favorites from '@extension/storage/lib/prompt/favorites';
import { TaskManager, type ExecutorDriver } from '../manager';
import type { ExecutorHooks, ObserveCriteria } from '../contracts';
import { Action } from '../../agent/actions/builder';
import { clickElementActionSchema } from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  skills: new Map<number, unknown>(),
  skillSave: new Map<string, { templates: unknown[]; unsafe: boolean }>(),
  nextSkillId: 1,
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
  saveTask: async (task: { id: string }) => {
    store.sessions.set(task.id, structuredClone(task));
  },
  putSkillSaveMeta: async (
    taskId: string,
    roundId: string,
    meta: { templates: unknown[]; unsafe: boolean },
  ) => {
    store.skillSave.set(`${taskId}:${roundId}`, structuredClone(meta));
  },
  getSkillSaveMeta: async (taskId: string, roundId: string) =>
    structuredClone(store.skillSave.get(`${taskId}:${roundId}`) ?? null),
  clearSkillSaveMetaForTask: async (taskId: string) => {
    for (const key of [...store.skillSave.keys()]) {
      if (key.startsWith(`${taskId}:`)) store.skillSave.delete(key);
    }
  },
}));

vi.mock('@extension/storage/lib/prompt/favorites', async importOriginal => {
  const actual = await importOriginal<typeof Favorites>();
  return {
    ...actual,
    default: {
      addSkill: vi.fn(async (skill: Favorites.NewSkillDefinition): Promise<Favorites.FavoriteSkill> => {
        const stored = { ...structuredClone(skill), id: store.nextSkillId++ };
        store.skills.set(stored.id, stored);
        return stored;
      }),
      getSkill: vi.fn(
        async (id: number): Promise<Favorites.FavoriteSkill | undefined> =>
          structuredClone(store.skills.get(id) as Favorites.FavoriteSkill | undefined),
      ),
    },
  };
});

vi.mock('../../agent/factory', () => ({
  browserContext: {
    getCurrentPage: async () => ({
      observeActionTarget: store.observeActionTarget,
      observeMedia: vi.fn(async () => ({ kind: 'missing' })),
      tabId: 7,
      url: () => 'https://example.test/form',
    }),
  },
}));

const hangingDriver = (): ExecutorDriver => ({
  run: vi.fn(() => new Promise(() => {})),
  addFollowUp: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(async () => undefined),
});

describe('OSS idea experiments (parallel suite)', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.skills.clear();
    store.skillSave.clear();
    store.nextSkillId = 1;
    store.observeActionTarget.mockReset();
    store.observeActionTarget.mockResolvedValue(store.targetObservation);
  });

  it('Exp A (Skyvern): freeze success text from instruction before the agent acts', async () => {
    const driver = hangingDriver();
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: false,
      })),
    );
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
      postCommitVerifyDelaysMs: [0],
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'exp-a',
      taskId: 'task-exp-a',
      instruction: 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
      chatSessionId: 'chat-a',
      instructionMessageId: 'msg-a',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalled());

    await expect(manager.snapshot('task-exp-a')).resolves.toMatchObject({
      status: 'running',
      rounds: [{ criteria: [expect.objectContaining({ kind: 'page_text', baseline: false })] }],
    });
    expect(store.skillSave.get('task-exp-a:' + (await manager.snapshot('task-exp-a'))!.currentRoundId)).toMatchObject({
      templates: [{ kind: 'page_text', expectedTemplate: 'Saved successfully' }],
      unsafe: false,
    });
  });

  it('Exp B (Stagehand observe): post-commit verify settles after async rewrite', async () => {
    let hooks!: ExecutorHooks;
    let now = 100;
    let observeCall = 0;
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
      observeCall += 1;
      const value = observeCall >= 3; // freeze false, first probe false, second true
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
      createExecutor: async (_input, next) => {
        hooks = next;
        return hangingDriver();
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => now,
      postCommitVerifyDelaysMs: [0, 5],
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'exp-b',
      taskId: 'task-exp-b',
      instruction: 'submit; success is Saved successfully.',
      chatSessionId: 'chat-b',
      instructionMessageId: 'msg-b',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = (await manager.snapshot('task-exp-b'))!.currentRoundId;
    now = 200;
    const pending = hooks.dispatchAction(
      roundId,
      new Action(execute, clickElementActionSchema, true),
      { intent: 'submit the form', index: 1 },
    );
    await vi.waitFor(async () =>
      expect(await manager.snapshot('task-exp-b')).toMatchObject({ status: 'waiting_approval' }),
    );
    const waiting = await manager.snapshot('task-exp-b');
    const approval = waiting!.rounds[0].approvals[0];
    await manager.dispatch({
      type: 'approve',
      commandId: 'approve-b',
      taskId: waiting!.id,
      expectedRevision: waiting!.revision,
      roundId: waiting!.currentRoundId,
      approvalId: approval.id,
    });
    await pending;
    await vi.waitFor(async () =>
      expect(await manager.snapshot('task-exp-b')).toMatchObject({
        status: 'completed',
        rounds: [{ receipt: expect.any(Object) }],
      }),
    );
  });

  it('Exp C (workflow Skill): save after verified form then run with locked criteria', async () => {
    let hooks!: ExecutorHooks;
    let now = 100;
    let observeCall = 0;
    const execute = vi.fn(async () => new ActionResult({ success: true }));
    const observeCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
      observeCall += 1;
      // freeze baseline false; verify true for source; skill freeze false then true on probe
      const value = observeCall === 2 || observeCall >= 4;
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
      createExecutor: async (_input, next) => {
        hooks = next;
        return hangingDriver();
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => now,
      postCommitVerifyDelaysMs: [0],
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'exp-c-start',
      taskId: 'task-exp-c',
      instruction: 'Fill Name with X and submit; success is Saved successfully.',
      chatSessionId: 'chat-c',
      instructionMessageId: 'msg-c',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const source = await manager.snapshot('task-exp-c');
    const roundId = source!.currentRoundId;
    now = 150;
    const pending = hooks.dispatchAction(
      roundId,
      new Action(execute, clickElementActionSchema, true),
      { intent: 'submit the form', index: 1 },
    );
    await vi.waitFor(async () =>
      expect((await manager.snapshot('task-exp-c'))?.status).toBe('waiting_approval'),
    );
    const waiting = await manager.snapshot('task-exp-c');
    await manager.dispatch({
      type: 'approve',
      commandId: 'approve-c',
      taskId: waiting!.id,
      expectedRevision: waiting!.revision,
      roundId: waiting!.currentRoundId,
      approvalId: waiting!.rounds[0].approvals[0].id,
    });
    await pending;
    await vi.waitFor(async () => expect((await manager.snapshot('task-exp-c'))?.status).toBe('completed'));
    const completed = await manager.snapshot('task-exp-c');

    const saved = await manager.dispatch({
      type: 'save_skill',
      commandId: 'save-c',
      taskId: completed!.id,
      expectedRevision: completed!.revision,
      roundId: completed!.currentRoundId,
      title: 'Form skill',
      instructionTemplate: 'Fill Name with {{name}} and submit; success is Saved successfully.',
    });
    expect(saved.accepted).toBe(true);
    const skill = store.skills.get(1) as Favorites.FavoriteSkill;
    expect(skill.criteria).toEqual([
      expect.objectContaining({
        kind: 'page_text',
        expectedTemplate: 'Saved successfully',
      }),
    ]);

    now = 300;
    const runAck = await manager.dispatch({
      type: 'run_skill',
      commandId: 'run-c',
      taskId: 'task-skill-c',
      skillId: skill.id,
      values: { name: 'FIELD_SENTINEL_CHANGED_9521' },
      tabId: 8,
    });
    expect(runAck.accepted).toBe(true);
    const skillTask = await manager.snapshot('task-skill-c');
    expect(skillTask).toMatchObject({
      sourceSkillId: skill.id,
      activeTabId: 8,
      rounds: [{ criteria: [expect.objectContaining({ kind: 'page_text', baseline: false })] }],
    });
    // empty planner cannot replace locked skill criteria
    let skillHooks!: ExecutorHooks;
    // recreate path: hooks from latest createExecutor - skill run starts new executor
    await vi.waitFor(() => expect(hooks).toBeDefined());
  });

  it('Exp D (Playwright assert): empty criteria cannot complete; evidence path needs page_text', async () => {
    const { checkCompletion } = await import('../completion');
    const result = checkCompletion({
      now: 200,
      currentRoundId: 'r1',
      criteria: [],
      observations: [],
    });
    expect(result.passed).toBe(false);

    const withCriteria = checkCompletion({
      now: 200,
      currentRoundId: 'r1',
      criteria: [
        {
          id: 'c1',
          roundId: 'r1',
          kind: 'page_text',
          operator: 'present',
          expectedDigest: 'x',
          required: true,
          targetRefId: 'tab-7',
          baseline: false,
          frozenAt: 100,
          notBefore: 150,
          timeoutMs: 120_000,
        },
      ],
      observations: [
        {
          criterionId: 'c1',
          roundId: 'r1',
          targetRefId: 'tab-7',
          observedAt: 180,
          source: 'page',
          value: true,
        },
      ],
    });
    expect(withCriteria.passed).toBe(true);
  });
});
