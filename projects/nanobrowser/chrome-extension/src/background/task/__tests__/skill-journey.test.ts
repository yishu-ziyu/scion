import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as Favorites from '@extension/storage/lib/prompt/favorites';
import { TaskManager } from '../manager';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome, ObserveCriteria } from '../contracts';

const state = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  skills: new Map<number, unknown>(),
  nextSkillId: 1,
}));

vi.mock('@extension/storage/lib/task', () => ({
  getTask: async (id: string) => state.sessions.get(id) ?? null,
  getActiveTask: async () => [...state.sessions.values()].at(-1) ?? null,
  saveTask: async (task: { id: string }) => {
    state.sessions.set(task.id, structuredClone(task));
  },
}));

vi.mock('@extension/storage/lib/prompt/favorites', async importOriginal => {
  const actual = await importOriginal<typeof Favorites>();
  return {
    ...actual,
    default: {
      addSkill: vi.fn(async (skill: Favorites.NewSkillDefinition): Promise<Favorites.FavoriteSkill> => {
        const stored = { ...structuredClone(skill), id: state.nextSkillId++ };
        state.skills.set(stored.id, stored);
        return stored;
      }),
      getSkill: vi.fn(
        async (id: number): Promise<Favorites.FavoriteSkill | undefined> =>
          structuredClone(state.skills.get(id) as Favorites.FavoriteSkill | undefined),
      ),
    },
  };
});

function driver(outcome: ExecutorOutcome = { kind: 'candidate_complete', summary: 'done' }): ExecutorDriver {
  return {
    run: vi.fn(async () => outcome),
    addFollowUp: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => undefined),
  };
}

describe('local semantic Skill', () => {
  beforeEach(() => {
    state.sessions.clear();
    state.skills.clear();
    state.nextSkillId = 1;
  });

  it('derives inputs from placeholders and renders values only in memory', () => {
    const template = 'Fill {{name}} into the form at {{url}} for {{name}}';

    expect(Favorites.parseSkillInputs(template).map(input => input.name)).toEqual(['name', 'url']);
    expect(Favorites.compileSkillTemplate(template, { name: 'Ada', url: 'https://example.test' })).toBe(
      'Fill Ada into the form at https://example.test for Ada',
    );
  });

  it('never places resolved values in the stored Skill definition', () => {
    const skill = Favorites.createSkillDefinition({
      title: 'Fill form',
      instructionTemplate: 'Fill {{name}} into the form at {{url}}',
      criteria: [{ kind: 'page_text', operator: 'present', expectedTemplate: 'Saved successfully', required: true }],
      sourceTaskId: 'task-1',
    });
    const rendered = Favorites.compileSkillTemplate(skill.instructionTemplate, {
      name: 'Ada',
      url: 'https://example.test',
    });

    expect(rendered).toContain('Ada');
    expect(JSON.stringify(skill)).not.toContain('Ada');
  });

  it('rejects unsafe templates and any non-exact runtime input set', () => {
    const safeInput = [{ name: 'name', label: 'name', required: true as const }];

    expect(() => Favorites.assertExactSkillInputs(safeInput, {})).toThrow('invalid_skill_input');
    expect(() => Favorites.assertExactSkillInputs(safeInput, { name: 'Ada', extra: 'value' })).toThrow(
      'invalid_skill_input',
    );
    expect(() => Favorites.assertExactSkillInputs(safeInput, { name: 'x'.repeat(2_001) })).toThrow(
      'invalid_skill_input',
    );
    for (const instructionTemplate of ['Fill {{Name}}', 'Use password {{name}}', 'Click [12] with {{name}}']) {
      expect(() =>
        Favorites.createSkillDefinition({
          title: 'Unsafe Skill',
          instructionTemplate,
          criteria: [{ kind: 'user_confirmed', operator: 'equals', expected: true, required: true }],
          sourceTaskId: 'task-1',
        }),
      ).toThrow();
    }
    expect(() =>
      Favorites.createSkillDefinition({
        title: 'Unsafe criterion',
        instructionTemplate: 'Fill {{name}}',
        criteria: [{ kind: 'page_text', operator: 'present', expectedTemplate: '{{name}}', required: true }],
        sourceTaskId: 'task-1',
      }),
    ).toThrow('invalid_skill_criterion');
  });

  it('rejects Skill persistence without a verified current-round receipt', async () => {
    state.sessions.set('unverified-task', {
      id: 'unverified-task',
      goalSummary: 'User task',
      status: 'completed',
      revision: 1,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'User instruction',
          status: 'completed',
          commandAcks: {},
          criteria: [],
          attempts: [],
          approvals: [],
          evidence: [],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver()),
      switchTab: vi.fn(async () => undefined),
      observeCriteria: vi.fn(async () => []),
      now: () => 300,
    });
    await expect(
      manager.dispatch({
        type: 'save_skill',
        commandId: 'save-unverified',
        taskId: 'unverified-task',
        expectedRevision: 1,
        roundId: 'round-1',
        title: 'Unsafe save',
        instructionTemplate: 'Fill {{name}}',
      }),
    ).resolves.toMatchObject({ accepted: false, error: 'invalid_transition' });
    expect(state.skills.size).toBe(0);
  });

  it('requires fresh inputs after recovering an interrupted Skill run', async () => {
    state.sessions.set('recover-skill', {
      id: 'recover-skill',
      goalSummary: 'Run Skill: Fill form',
      sourceSkillId: 4,
      status: 'running',
      revision: 2,
      activeTabId: 7,
      currentRoundId: 'round-skill',
      targetRefs: [],
      rounds: [
        {
          id: 'round-skill',
          instructionSummary: 'Run Skill: Fill form',
          status: 'running',
          commandAcks: {},
          criteria: [],
          attempts: [],
          approvals: [],
          evidence: [],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver()),
      switchTab: vi.fn(async () => undefined),
      observeCriteria: vi.fn(async () => []),
      now: () => 300,
    });

    await manager.recover();

    await expect(manager.snapshot('recover-skill')).resolves.toMatchObject({
      status: 'inputs_required',
      rounds: [{ status: 'inputs_required', waitReason: 'skill_inputs_required' }],
    });
  });

  it('saves only a verified task and replans changed DOM order without retaining values', async () => {
    const pages = [new Map([['Name', 2]]), new Map([['Name', 9]])];
    const usedIndexes: number[] = [];
    let skillPage = 0;
    const observationPhase = new Map<string, number>();
    const createExecutor = vi.fn(async (input: ExecutorInput, hooks: ExecutorHooks): Promise<ExecutorDriver> => {
      if (input.taskId === 'source-task') {
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true },
        ]);
      } else {
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: 'Planner replacement', required: true },
        ]);
        const page = pages[skillPage++];
        usedIndexes.push(page.get('Name')!);
        expect(input.instruction).toContain(skillPage === 1 ? 'Ada' : 'Grace');
      }
      return driver();
    });
    const observeCriteria: ObserveCriteria = vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
      criteria.map(criterion => {
        const phase = observationPhase.get(criterion.roundId) ?? 0;
        observationPhase.set(criterion.roundId, phase + 1);
        return {
          criterionId: criterion.id,
          roundId: criterion.roundId,
          targetRefId: criterion.targetRefId,
          observedAt: 300,
          source: 'page' as const,
          value: phase > 0,
        };
      }),
    );
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(async () => undefined),
      observeCriteria,
      now: () => 300,
    });
    const emittedEvents: unknown[] = [];
    manager.subscribe(event => emittedEvents.push(event));

    await manager.dispatch({
      type: 'start',
      commandId: 'start-source',
      taskId: 'source-task',
      instruction: 'Fill a form with a runtime-only value',
      chatSessionId: 'chat-source',
      instructionMessageId: 'message-source',
      tabId: 7,
    });
    await vi.waitFor(async () => expect((await manager.snapshot('source-task'))?.status).toBe('completed'));
    const completed = await manager.snapshot('source-task');
    if (!completed) throw new Error('Expected completed source task');

    const saved = await manager.dispatch({
      type: 'save_skill',
      commandId: 'save-source',
      taskId: completed.id,
      expectedRevision: completed.revision,
      roundId: completed.currentRoundId,
      title: 'Fill form',
      instructionTemplate: 'Fill {{name}} at {{url}}',
    });
    expect(saved.accepted).toBe(true);
    const skill = structuredClone(state.skills.get(1) as Favorites.FavoriteSkill);
    expect(skill.criteria).toEqual([
      { kind: 'page_text', operator: 'present', expectedTemplate: 'Saved successfully', required: true },
    ]);

    for (const [taskId, name] of [
      ['skill-run-1', 'Ada'],
      ['skill-run-2', 'Grace'],
    ] as const) {
      const ack = await manager.dispatch({
        type: 'run_skill',
        commandId: `command-${taskId}`,
        taskId,
        skillId: skill.id,
        values: { name, url: 'https://example.test' },
        tabId: 7,
      });
      expect(ack.accepted).toBe(true);
      await vi.waitFor(async () => expect((await manager.snapshot(taskId))?.status).toBe('completed'));
      const snapshot = await manager.snapshot(taskId);
      expect(snapshot).toMatchObject({ sourceSkillId: skill.id });
      expect(snapshot?.rounds[0]?.criteria).toEqual([
        expect.objectContaining({
          kind: 'page_text',
          expectedDigest: '75de35db68a4bca7acd4039f13855f1c447fc5c62caac4d981ed0d32e5c42729',
        }),
      ]);
      expect(JSON.stringify(snapshot)).not.toContain(name);
    }

    expect(usedIndexes).toEqual([2, 9]);
    expect(JSON.stringify(skill)).not.toMatch(/Ada|Grace/);
    expect(JSON.stringify(emittedEvents)).not.toMatch(/Ada|Grace/);
  });
});
