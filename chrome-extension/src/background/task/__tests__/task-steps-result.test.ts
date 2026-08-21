import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSkillSaveMetaForTask, getSkillSaveMeta, putSkillSaveMeta } from '@extension/storage/lib/task';
import { TaskManager } from '../manager';
import { createTableArtifact } from '../artifact';
import { extractContentActionSchema } from '../../agent/actions/schemas';
import { Action } from '../../agent/actions/builder';
import { ActionResult } from '../../agent/types';
import type { ExecutorDriver, ExecutorHooks, ExecutorOutcome, ObserveCriteria } from '../contracts';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  chatSessions: new Map<string, { messages: Array<{ id: string; content: string }> }>(),
  saveCount: 0,
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
    saveTask: async (task: { id: string }) => {
      store.saveCount += 1;
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
  beforeEach(() => {
    store.sessions.clear();
    store.chatSessions.clear();
    store.saveCount = 0;
  });

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

  it('does not complete a content task from leftover hi / yes / 好的', async () => {
    for (const [taskId, leftover] of [
      ['task-leftover-hi', 'hi'],
      ['task-leftover-yes', 'yes'],
      ['task-leftover-ok', '好的'],
    ] as const) {
      const manager = new TaskManager({
        createExecutor: async () => driver({ kind: 'candidate_complete', summary: leftover }),
        switchTab: vi.fn(),
        observeCriteria: vi.fn(async () => []),
        now: () => 100,
      });
      await start(manager, taskId, '告诉我这一页在讲什么');
      await vi.waitFor(async () => {
        expect((await manager.snapshot(taskId))?.status).toBe('failed');
      });
      expect((await manager.snapshot(taskId))?.rounds[0]?.result).toBeUndefined();
    }
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

  it('completes a table with a link column without visiting each cell URL', async () => {
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'url'],
      rows: [
        { name: 'Alpha', price: '$49.99', url: 'https://shop.example/p/alpha' },
        { name: 'Beta', price: '$9.00', url: 'https://shop.example/p/beta' },
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
    await start(manager, 'task-table-links', 'Extract products to a CSV table with name, price, url');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-table-links'))?.status).toBe('completed');
    });
    const body = (await manager.snapshot('task-table-links'))?.rounds[0]?.result?.body ?? '';
    expect(body).toContain('name,price,url');
    expect(body).toContain('https://shop.example/p/alpha');
    expect(body).toContain('https://shop.example/p/beta');
  });

  it('persists a table longer than 2000 characters in full', async () => {
    const rows = Array.from({ length: 80 }, (_, index) => ({
      name: `Product ${String(index + 1).padStart(3, '0')} Extra Long Name For Persistence`,
      price: `$${(index + 1).toFixed(2)}`,
      rating: '4.5',
    }));
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows,
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const lastName = rows.at(-1)!.name;
    const manager = new TaskManager({
      createExecutor: async () =>
        driver({
          kind: 'candidate_complete',
          summary: 'Extracted 80 records. Task is not complete.',
          artifacts: [artifact],
        }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-table-full', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-table-full'))?.status).toBe('completed');
    });
    const body = (await manager.snapshot('task-table-full'))?.rounds[0]?.result?.body ?? '';
    expect(body.length).toBeGreaterThan(2000);
    expect(body).toContain('name,price,rating');
    expect(body).toContain(lastName);
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

  it('does not complete a page-about task from an opened host', async () => {
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'done' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: item.kind === 'url' ? 'https://example.com/page' : true,
        })),
      ),
      now: () => 100,
    });
    await start(manager, 'task-page-about-open', '告诉我这一页在讲什么');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-page-about-open'))?.status).toBe('failed');
    });
    const round = (await manager.snapshot('task-page-about-open'))?.rounds[0];
    expect(round?.result).toBeUndefined();
    expect(round?.instructionSummary === '已打开 example.com').toBe(false);
  });

  it('does not complete a download from leftover summary or opened-host chrome', async () => {
    const manager = new TaskManager({
      createExecutor: async () =>
        driver({
          kind: 'candidate_complete',
          summary: '页面上有一个下载按钮。',
        }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: item.kind === 'url' ? 'https://example.com/file.pdf' : true,
        })),
      ),
      now: () => 100,
    });
    await start(manager, 'task-download-leftover', 'download this file');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-download-leftover'))?.status).toBe('failed');
    });
    const round = (await manager.snapshot('task-download-leftover'))?.rounds[0];
    expect(round?.result).toBeUndefined();
    expect(round?.receipt).toBeUndefined();
  });

  it('does not complete a download when the file has only started', async () => {
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: '下载已开始' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-download-started', 'download this file');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-download-started'))?.status).toBe('failed');
    });
    expect((await manager.snapshot('task-download-started'))?.rounds[0]?.result).toBeUndefined();
  });

  it('does not keep a result when the receipt is not committed', async () => {
    const summary = '这一页在讲记忆系统如何组织长程推理。';
    let release!: (outcome: ExecutorOutcome) => void;
    const pending = new Promise<ExecutorOutcome>(resolve => {
      release = resolve;
    });
    const manager = new TaskManager({
      createExecutor: async () => {
        const next = driver({ kind: 'candidate_complete', summary });
        next.run = vi.fn(() => pending);
        return next;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-receipt-rollback', '告诉我这一页在讲什么');
    await vi.waitFor(() => {
      expect(store.sessions.get('task-receipt-rollback')).toBeTruthy();
    });
    const session = store.sessions.get('task-receipt-rollback') as {
      plan?: {
        id: string;
        goal: string;
        phases: Array<{
          id: string;
          title: string;
          status: string;
          criteriaIds: string[];
          evidenceIds: string[];
        }>;
        createdAt: number;
        updatedAt: number;
      };
    };
    session.plan = {
      id: 'mission-1',
      goal: '完成任务',
      phases: [
        {
          id: 'phase-1',
          title: '阅读',
          status: 'active',
          criteriaIds: ['url-1'],
          evidenceIds: [],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    release({ kind: 'candidate_complete', summary });
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-receipt-rollback'))?.status).toBe('failed');
    });
    const round = (await manager.snapshot('task-receipt-rollback'))?.rounds[0];
    expect(round?.result).toBeUndefined();
    expect(round?.receipt).toBeUndefined();
    expect(round?.instructionSummary).not.toBe(summary);
  });

  it('restores acceptTask after resume so a table task cannot complete on a two-character summary', async () => {
    const instruction = 'Extract products to a CSV table with name, price, rating';
    store.sessions.set('task-rehydrate-table', {
      id: 'task-rehydrate-table',
      goalSummary: 'User task',
      chatSessionId: 'chat-rehydrate-table',
      instructionMessageId: 'message-rehydrate-table',
      status: 'paused',
      revision: 4,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      rounds: [
        {
          id: 'round-1',
          instructionMessageId: 'message-rehydrate-table',
          instructionSummary: 'User instruction',
          status: 'paused',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
      createdAt: 1,
      updatedAt: 4,
    });
    store.chatSessions.set('chat-rehydrate-table', {
      messages: [{ id: 'message-rehydrate-table', content: instruction }],
    });
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'hi' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await manager.recover();
    const paused = await manager.snapshot('task-rehydrate-table');
    expect(paused?.status).toBe('paused');
    await manager.dispatch({
      type: 'resume',
      commandId: 'resume-rehydrate-table',
      taskId: 'task-rehydrate-table',
      expectedRevision: paused!.revision,
    });
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-rehydrate-table'))?.status).toBe('failed');
    });
    expect((await manager.snapshot('task-rehydrate-table'))?.rounds[0]?.result).toBeUndefined();
  });

  it('does not mark extract_content done when the task is no longer running', async () => {
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
    await start(manager, 'task-extract-gone', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const snap = await manager.snapshot('task-extract-gone');
    const roundId = snap?.currentRoundId;
    if (!snap || !roundId) throw new Error('missing round');
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '$1', rating: '5' }],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const dispatched = await hooks.dispatchAction(
      roundId,
      new Action(async () => {
        const current = await manager.snapshot('task-extract-gone');
        await manager.dispatch({
          type: 'cancel',
          commandId: 'cancel-extract-gone',
          taskId: 'task-extract-gone',
          expectedRevision: current!.revision,
        });
        return new ActionResult({ success: true, artifact });
      }, extractContentActionSchema),
      { goal: 'name,price,rating', intent: 'extract' },
    );
    expect(dispatched.actionResult.isDone).toBe(false);
    expect((await manager.snapshot('task-extract-gone'))?.status).toBe('cancelled');
  });

  it('confirms a table from the matching produceResult after a worker restart', async () => {
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '$1', rating: '5' }],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const instruction = 'Extract products to a CSV table with name, price, rating';
    store.chatSessions.set('chat-task-confirm-restart', {
      messages: [{ id: 'message-task-confirm-restart', content: instruction }],
    });
    const first = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan(_input.roundId, [
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
        ]);
        return driver({
          kind: 'candidate_complete',
          summary: 'Extracted 1 record. Task is not complete.',
          artifacts: [artifact],
        });
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(first, 'task-confirm-restart', instruction);
    await vi.waitFor(async () => {
      expect((await first.snapshot('task-confirm-restart'))?.status).toBe('waiting_user');
    });
    const waiting = await first.snapshot('task-confirm-restart');
    const round = waiting?.rounds[0];
    const criterion = round?.criteria.find(item => item.kind === 'user_confirmed');
    if (!waiting || !round || !criterion) throw new Error('Expected proof_required table wait');
    expect(round.result).toBeUndefined();
    expect(round.produced?.kind).toBe('table');
    expect(round.produced?.body).toContain('Alpha,$1,5');

    const restarted = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'ignored' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    const confirmed = await restarted.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-restart',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      criterionId: criterion.id,
    });
    expect(confirmed.accepted).toBe(true);
    const completed = await restarted.snapshot('task-confirm-restart');
    expect(completed?.status).toBe('completed');
    expect(completed?.rounds[0]?.result?.kind).toBe('table');
    expect(completed?.rounds[0]?.result?.body).toContain('Alpha,$1,5');
    expect(completed?.rounds[0]?.result?.body).not.toBe('已确认完成');
    expect(completed?.rounds[0]?.produced).toBeUndefined();
  });

  it('does not record confirm evidence when persistMatchingResult has no matching produceResult', async () => {
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan(_input.roundId, [
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
        ]);
        return driver({
          kind: 'candidate_complete',
          summary: 'Extracted 0 records. Task is not complete.',
        });
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-confirm-no-result', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-confirm-no-result'))?.status).toBe('waiting_user');
    });
    const waiting = await manager.snapshot('task-confirm-no-result');
    const round = waiting?.rounds[0];
    const criterion = round?.criteria[0];
    if (!waiting || !round || !criterion) throw new Error('Expected proof_required wait');
    expect(round.produced).toBeUndefined();

    const rejected = await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-no-result',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      criterionId: criterion.id,
    });
    expect(rejected.accepted).toBe(false);
    const stillWaiting = await manager.snapshot('task-confirm-no-result');
    expect(stillWaiting?.status).toBe('waiting_user');
    expect(stillWaiting?.rounds[0]?.evidence.some(item => item.source === 'user')).toBe(false);
    expect(stillWaiting?.rounds[0]?.result).toBeUndefined();
  });

  it('does not persist a half-closed plan or completed observe when confirm persistMatchingResult fails', async () => {
    const instruction = 'perform an outcome that needs my confirmation';
    const plan = {
      id: 'mission-confirm-fail',
      goal: 'User task',
      phases: [
        {
          id: 'phase-1',
          title: '阶段 1',
          status: 'active' as const,
          criteriaIds: ['url-1'],
          evidenceIds: [] as string[],
          notes: [] as string[],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    const observeAttempt = {
      id: 'observe-1',
      roundId: 'round-confirm-fail',
      actionName: 'observe',
      effect: 'read' as const,
      argsDigest: 'loop-phase:observe:0',
      displaySummary: '获取页面快照',
      state: 'executing' as const,
      proposedAt: 100,
      executingAt: 100,
    };
    store.chatSessions.set('chat-task-confirm-fail-plan', {
      messages: [{ id: 'message-task-confirm-fail-plan', content: instruction }],
    });
    store.sessions.set('task-confirm-fail-plan', {
      id: 'task-confirm-fail-plan',
      goalSummary: 'User task',
      chatSessionId: 'chat-task-confirm-fail-plan',
      instructionMessageId: 'message-task-confirm-fail-plan',
      status: 'waiting_user',
      revision: 2,
      activeTabId: 7,
      currentRoundId: 'round-confirm-fail',
      targetRefs: [],
      plan,
      rounds: [
        {
          id: 'round-confirm-fail',
          instructionMessageId: 'message-task-confirm-fail-plan',
          instructionSummary: 'User instruction',
          status: 'waiting_user',
          waitReason: 'proof_required',
          commandAcks: {},
          criteria: [
            {
              id: 'confirm-1',
              roundId: 'round-confirm-fail',
              targetRefId: 'tab-7',
              kind: 'user_confirmed',
              operator: 'equals',
              expected: true,
              required: true,
              frozenAt: 1,
              notBefore: 0,
              timeoutMs: 60_000,
              baseline: false,
            },
          ],
          attempts: [observeAttempt],
          evidence: [],
          produced: { kind: 'summary', body: 'needs confirmation now' },
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'ignored' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 200,
    });
    const savesBefore = store.saveCount;
    const rejected = await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-fail-plan',
      taskId: 'task-confirm-fail-plan',
      expectedRevision: 2,
      roundId: 'round-confirm-fail',
      criterionId: 'confirm-1',
    });
    expect(rejected.accepted).toBe(false);
    expect(store.saveCount).toBe(savesBefore);
    const stillWaiting = await manager.snapshot('task-confirm-fail-plan');
    expect(stillWaiting?.status).toBe('waiting_user');
    expect(stillWaiting?.revision).toBe(2);
    expect(stillWaiting?.plan).toEqual(plan);
    expect(stillWaiting?.rounds[0]?.attempts).toEqual([observeAttempt]);
    expect(stillWaiting?.rounds[0]?.evidence).toEqual([]);
    expect(stillWaiting?.rounds[0]?.receipt).toBeUndefined();
    expect(stillWaiting?.rounds[0]?.result).toBeUndefined();
    expect(stillWaiting?.rounds[0]?.produced).toEqual({ kind: 'summary', body: 'needs confirmation now' });
  });

  it('does not complete extract_content from a matching table when required url has no passed CompletionEvidence', async () => {
    let hooks!: ExecutorHooks;
    const pending = driver({ kind: 'candidate_complete', summary: 'still going' });
    pending.run = vi.fn(() => new Promise<ExecutorOutcome>(() => {}));
    const manager = new TaskManager({
      createExecutor: async (_input, nextHooks) => {
        hooks = nextHooks;
        await hooks.onPlan(_input.roundId, [
          { kind: 'url', operator: 'equals', expected: 'https://must-visit.example/page', required: true },
        ]);
        return pending;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-extract-url', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-extract-url'))?.rounds[0]?.criteria.some(item => item.kind === 'url')).toBe(
        true,
      );
    });
    const roundId = (await manager.snapshot('task-extract-url'))?.currentRoundId;
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
    expect(dispatched.actionResult.isDone).toBe(false);
    const snap = await manager.snapshot('task-extract-url');
    expect(snap?.status).not.toBe('completed');
    expect(snap?.rounds[0]?.result).toBeUndefined();
    expect(snap?.rounds[0]?.receipt).toBeUndefined();
  });

  it('does not complete a table candidate_complete when required url has no passed CompletionEvidence', async () => {
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '$1', rating: '5' }],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan(_input.roundId, [
          { kind: 'url', operator: 'equals', expected: 'https://must-visit.example/page', required: true },
        ]);
        return driver({
          kind: 'candidate_complete',
          summary: 'Extracted 1 record. Task is not complete.',
          artifacts: [artifact],
        });
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });
    await start(manager, 'task-table-url', 'Extract products to a CSV table with name, price, rating');
    await vi.waitFor(async () => {
      const status = (await manager.snapshot('task-table-url'))?.status;
      expect(['waiting_user', 'failed']).toContain(status);
    });
    const snap = await manager.snapshot('task-table-url');
    expect(snap?.status).not.toBe('completed');
    expect(snap?.rounds[0]?.result).toBeUndefined();
    expect(snap?.rounds[0]?.receipt).toBeUndefined();
  });

  it('stores onPlan takeaway text in skill-save meta, not on the task snapshot', async () => {
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
    await start(manager, 'task-asked-text-freeze', 'Fill the name field and submit the form');
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const snap = await manager.snapshot('task-asked-text-freeze');
    const roundId = snap?.currentRoundId;
    if (!roundId) throw new Error('missing round');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'Saved', required: true }]);
    await vi.waitFor(async () => {
      const meta = await getSkillSaveMeta('task-asked-text-freeze', roundId);
      expect(meta?.templates.some(item => item.kind === 'page_text' && item.expectedTemplate === 'Saved')).toBe(true);
    });
    expect(JSON.stringify(await manager.snapshot('task-asked-text-freeze'))).not.toContain('Saved');
  });

  it('restores askedText from skill-save page_text after restart so a short Saved takeaway still matches', async () => {
    const instruction = 'Fill the name field and submit the form';
    store.chatSessions.set('chat-task-asked-text-skill', {
      messages: [{ id: 'message-task-asked-text-skill', content: instruction }],
    });
    store.sessions.set('task-asked-text-skill', {
      id: 'task-asked-text-skill',
      goalSummary: 'User task',
      chatSessionId: 'chat-task-asked-text-skill',
      instructionMessageId: 'message-task-asked-text-skill',
      status: 'waiting_user',
      revision: 2,
      activeTabId: 7,
      currentRoundId: 'round-asked-text-skill',
      targetRefs: [],
      rounds: [
        {
          id: 'round-asked-text-skill',
          instructionMessageId: 'message-task-asked-text-skill',
          instructionSummary: 'User instruction',
          status: 'waiting_user',
          waitReason: 'proof_required',
          commandAcks: {},
          criteria: [
            {
              id: 'confirm-1',
              roundId: 'round-asked-text-skill',
              targetRefId: 'tab-7',
              kind: 'user_confirmed',
              operator: 'equals',
              expected: true,
              required: true,
              frozenAt: 1,
              notBefore: 0,
              timeoutMs: 60_000,
              baseline: false,
            },
          ],
          attempts: [],
          evidence: [],
          produced: { kind: 'summary', body: 'Saved' },
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    });
    await putSkillSaveMeta('task-asked-text-skill', 'round-asked-text-skill', {
      templates: [{ kind: 'page_text', operator: 'present', expectedTemplate: 'Saved', required: true }],
      unsafe: false,
    });
    const manager = new TaskManager({
      createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'ignored' }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 200,
    });
    const confirmed = await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-asked-text-skill',
      taskId: 'task-asked-text-skill',
      expectedRevision: 2,
      roundId: 'round-asked-text-skill',
      criterionId: 'confirm-1',
    });
    expect(confirmed.accepted).toBe(true);
    const completed = await manager.snapshot('task-asked-text-skill');
    expect(completed?.status).toBe('completed');
    expect(completed?.rounds[0]?.result).toEqual({ kind: 'summary', body: 'Saved' });
  });

  it('keeps freeze askedText on confirm when the cached instruction has extra whitespace', async () => {
    const instruction = 'Fill the name field\nand  submit the form';
    const takeaway = '已保存成功';
    let observeCall = 0;
    const manager = new TaskManager({
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: takeaway, required: true },
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
        ]);
        return driver({ kind: 'candidate_complete', summary: takeaway });
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
        observeCall += 1;
        return criteria
          .filter(item => item.kind !== 'user_confirmed')
          .map(item => ({
            criterionId: item.id,
            roundId: item.roundId,
            targetRefId: item.targetRefId,
            observedAt: 100,
            source: 'page' as const,
            value: observeCall > 1,
          }));
      }),
      now: () => 100,
    });
    await start(manager, 'task-asked-text-whitespace', instruction);
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-asked-text-whitespace'))?.status).toBe('waiting_user');
    });
    const waiting = await manager.snapshot('task-asked-text-whitespace');
    const round = waiting?.rounds[0];
    const criterion = round?.criteria.find(item => item.kind === 'user_confirmed');
    if (!waiting || !round || !criterion) throw new Error('Expected proof_required wait');
    expect(round.produced?.body).toBe(takeaway);
    await clearSkillSaveMetaForTask(waiting.id);
    const confirmed = await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-asked-text-whitespace',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      criterionId: criterion.id,
    });
    expect(confirmed.accepted).toBe(true);
    const completed = await manager.snapshot('task-asked-text-whitespace');
    expect(completed?.status).toBe('completed');
    expect(completed?.rounds[0]?.result).toEqual({ kind: 'summary', body: takeaway });
  });

  it.each(['提交成功', 'submitted', 'Success!'])(
    'restores skill askedText %s from skill-save after restart when rehydrateInstruction has no chat message',
    async takeaway => {
      const taskId = `task-skill-asked-text-restart-${takeaway}`;
      const roundId = `round-skill-asked-text-restart-${takeaway}`;
      store.sessions.set(taskId, {
        id: taskId,
        goalSummary: 'Run Skill: Submit form',
        sourceSkillId: 1,
        status: 'waiting_user',
        revision: 2,
        activeTabId: 7,
        currentRoundId: roundId,
        targetRefs: [],
        rounds: [
          {
            id: roundId,
            instructionSummary: 'Run Skill: Submit form',
            status: 'waiting_user',
            waitReason: 'proof_required',
            commandAcks: {},
            criteria: [
              {
                id: 'confirm-1',
                roundId,
                targetRefId: 'tab-7',
                kind: 'user_confirmed',
                operator: 'equals',
                expected: true,
                required: true,
                frozenAt: 1,
                notBefore: 0,
                timeoutMs: 60_000,
                baseline: false,
              },
            ],
            attempts: [],
            evidence: [],
            produced: { kind: 'summary', body: takeaway },
          },
        ],
        createdAt: 1,
        updatedAt: 1,
      });
      await putSkillSaveMeta(taskId, roundId, {
        templates: [{ kind: 'page_text', operator: 'present', expectedTemplate: takeaway, required: true }],
        unsafe: false,
      });
      const manager = new TaskManager({
        createExecutor: async () => driver({ kind: 'candidate_complete', summary: 'ignored' }),
        switchTab: vi.fn(),
        observeCriteria: vi.fn(async () => []),
        now: () => 200,
      });
      const confirmed = await manager.dispatch({
        type: 'confirm_completion',
        commandId: `confirm-skill-asked-text-restart-${takeaway}`,
        taskId,
        expectedRevision: 2,
        roundId,
        criterionId: 'confirm-1',
      });
      expect(confirmed.accepted).toBe(true);
      const completed = await manager.snapshot(taskId);
      expect(completed?.status).toBe('completed');
      expect(completed?.rounds[0]?.result).toEqual({ kind: 'summary', body: takeaway });
    },
  );
});
