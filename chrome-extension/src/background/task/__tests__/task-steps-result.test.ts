import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../manager';
import { createTableArtifact } from '../artifact';
import { extractContentActionSchema } from '../../agent/actions/schemas';
import { Action } from '../../agent/actions/builder';
import { ActionResult } from '../../agent/types';
import type { ExecutorDriver, ExecutorHooks, ExecutorOutcome } from '../contracts';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
}));

vi.mock('@extension/storage/lib/task', () => {
  const skillSave = new Map<string, { templates: unknown[]; unsafe: boolean }>();
  return {
    getTask: async (id: string) => store.sessions.get(id) ?? null,
    getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
    saveTask: async (task: { id: string }) => {
      store.sessions.set(task.id, structuredClone(task));
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
      tabId: 7,
      url: () => 'https://fixture.local/products',
      observeActionTarget: async () => ({
        target: {
          id: 'page-1',
          kind: 'page',
          tabId: 7,
          frameId: 0,
          urlOrigin: 'https://fixture.local',
          digest: 'page-digest',
        },
        evidence: [],
      }),
      observeMedia: async () => ({ kind: 'missing' }),
      evaluate: async () => '',
    }),
  },
}));

function driver(outcome: ExecutorOutcome): ExecutorDriver {
  return {
    run: vi.fn().mockResolvedValue(outcome),
    addFollowUp: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
}

async function start(manager: TaskManager, taskId: string, instruction: string): Promise<void> {
  await manager.dispatch({
    type: 'start',
    commandId: `start-${taskId}`,
    taskId,
    instruction,
    chatSessionId: `chat-${taskId}`,
    instructionMessageId: `message-${taskId}`,
    tabId: 7,
  });
}

describe('task / steps / result chain', () => {
  beforeEach(() => store.sessions.clear());

  it('does not complete a generic task when candidate_complete has no matching result', async () => {
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'done' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-generic-empty', '告诉我这一页在讲什么');
    await vi.waitFor(async () => {
      const snap = await manager.snapshot('task-generic-empty');
      expect(snap?.status).toBe('failed');
    });
    const snap = await manager.snapshot('task-generic-empty');
    expect(snap?.rounds[0]?.result).toBeUndefined();
    expect(snap?.rounds[0]?.receipt).toBeUndefined();
  });

  it('completes a generic task only when a matching summary exists', async () => {
    const summary = '这一页在讲记忆系统如何组织长程推理。';
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-generic-summary', '告诉我这一页在讲什么');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-generic-summary'))?.status).toBe('completed');
    });
    const round = (await manager.snapshot('task-generic-summary'))?.rounds[0];
    expect(round?.result).toEqual({ kind: 'summary', body: summary });
  });

  it('stores a produced table as the result the user can take', async () => {
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Alpha', price: '$49.99', rating: '4.5' },
        { name: 'Beta', price: '$9', rating: '4' },
      ],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const manager = new TaskManager({
      createExecutor: async () =>
        driver({
          kind: 'candidate_complete',
          summary: 'Extracted 2 records. Task is not complete.',
          artifacts: [artifact],
        }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-table', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-table'))?.status).toBe('completed');
    });
    const round = (await manager.snapshot('task-table'))?.rounds[0];
    expect(round?.result?.kind).toBe('table');
    expect(round?.result?.body).toContain('name,price,rating');
    expect(round?.result?.body).toContain('Alpha,$49.99,4.5');
  });

  it('completes from extract_content once a matching table exists, without a separate mark-complete', async () => {
    let hooks!: ExecutorHooks;
    const pending = driver({ kind: 'candidate_complete', summary: 'still going' });
    pending.run = vi.fn(() => new Promise<ExecutorOutcome>(() => {}));
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        return pending;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-extract-act', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = (await manager.snapshot('task-extract-act'))?.currentRoundId;
    if (!roundId) throw new Error('missing round');
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '$1', rating: '5' }],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const dispatched = await hooks.dispatchAction(
      roundId,
      new Action(async () => new ActionResult({ success: true, artifact }), extractContentActionSchema),
      { goal: 'name,price,rating', intent: 'extract' },
    );
    expect(dispatched.actionResult.isDone).toBe(true);
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-extract-act'))?.status).toBe('completed');
    });
    expect((await manager.snapshot('task-extract-act'))?.rounds[0]?.result?.body).toContain('Alpha,$1,5');
  });
});
