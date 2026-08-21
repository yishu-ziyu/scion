/**
 * R1 tracer: list page extract → CSV deliverable on verified complete.
 * Scripted control path (auto_proxy); full e2e against fixture is optional follow-up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionCriterion, TaskEvent } from '@extension/storage/lib/task';
import { TaskManager } from '../manager';
import { createControlLoopDriver, fixtureProductTableControlSteps } from '../../agent/backends/control-loop';
import {
  extractProductsFromHtml,
  formatMostExpensiveProductConclusion,
  formatProductTableDeliverable,
  parseProductTableInstruction,
} from '../../browser/sites/product-table';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type VerifiedCompletionEvent = Extract<TaskEvent, { type: 'task_completed_verified' }>;

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  pageHtml: '',
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
      url: () => 'http://127.0.0.1/products',
      tabId: 11,
      getContent: async () => store.pageHtml,
      observeActionTarget: async () => {
        const visibleCells = [
          'Alpha Wireless Headphones',
          '$49.99',
          '4.5',
          'Beta Mechanical Keyboard',
          '$89.00',
          '4.8',
          'Gamma USB-C Hub',
          '$34.50',
          '4.2',
          'Delta Desk Lamp',
          '$27.99',
          '4.0',
          'Epsilon Notebook Stand',
          '$19.95',
          '4.6',
          'Zeta Webcam Cover',
          '$8.49',
          '3.9',
        ];
        const textDigests = await Promise.all(
          visibleCells.map(async value =>
            Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))))
              .map(byte => byte.toString(16).padStart(2, '0'))
              .join(''),
          ),
        );
        return {
          target: {
            id: 'page-products',
            kind: 'page' as const,
            tabId: 11,
            frameId: 0 as const,
            urlOrigin: 'http://127.0.0.1',
            normalizedUrl: 'http://127.0.0.1/products',
            bodyDigest: 'products-body',
            textDigests,
            pageRevision: 'products-revision',
            digest: 'products-page-digest',
          },
          tag: 'body',
          type: '',
          inForm: false,
          intent: 'product table',
          semanticCommit: false,
        };
      },
      observeMedia: async () => ({ kind: 'none' as const }),
    }),
  },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(path.resolve(__dirname, '../../../../test/fixtures/products.html'), 'utf8');

function waitForVerifiedCompletion(manager: TaskManager, taskId: string): Promise<VerifiedCompletionEvent> {
  return new Promise((resolve, reject) => {
    let unsubscribe: () => void = () => undefined;
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error(`timed out waiting for verified completion: ${taskId}`));
    }, 4_000);
    unsubscribe = manager.subscribe(event => {
      if (
        event.type !== 'task_completed_verified' ||
        event.taskId !== taskId ||
        event.roundId !== event.snapshot.currentRoundId
      ) {
        return;
      }
      clearTimeout(timeout);
      unsubscribe();
      resolve(event);
    });
  });
}

describe('R1 product-table journey (auto_proxy)', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.pageHtml = fixtureHtml;
  });

  it('fixture HTML → CSV deliverable has ≥5 product rows', () => {
    const goal = parseProductTableInstruction('Extract products to a CSV table with name, price, rating');
    expect(goal).not.toBeNull();
    const rows = extractProductsFromHtml(fixtureHtml);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const deliverable = formatProductTableDeliverable(rows, goal!.format);
    expect(deliverable).toContain('name,price,rating');
    expect(deliverable).toContain('Alpha Wireless Headphones');
    // Data rows only (exclude header line after the result sentence)
    const dataLines = deliverable.split('\n').filter(line => line.includes(',') && !line.startsWith('name,'));
    expect(dataLines.length).toBeGreaterThanOrEqual(5);
  });

  it('control script: complete with CSV summary as user-visible deliverable', async () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const csvSummary = formatProductTableDeliverable(rows, 'csv');

    let pageMarkerPresent = false;
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
      const observations = criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 600,
        source: 'page' as const,
        value: pageMarkerPresent,
      }));
      pageMarkerPresent = true;
      return observations;
    });

    const manager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureProductTableControlSteps({ csvSummary }),
        }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 600,
    });
    const completed = waitForVerifiedCompletion(manager, 'task-r1');

    await manager.dispatch({
      type: 'start',
      commandId: 'start-r1',
      taskId: 'task-r1',
      tabId: 11,
      instruction: 'Extract products to a CSV table with name, price, rating',
      chatSessionId: 'chat-r1',
      instructionMessageId: 'msg-r1',
    });

    const completedEvent = await completed;
    expect(completedEvent.snapshot.status).toBe('completed');
    expect(completedEvent.snapshot.rounds.find(round => round.id === completedEvent.roundId)?.receipt?.id).toBe(
      completedEvent.receiptId,
    );

    const snap = await manager.snapshot('task-r1');
    if (!snap) throw new Error('missing task');
    const round = snap.rounds.find(r => r.id === snap.currentRoundId) ?? snap.rounds[0];
    expect(round?.status).toBe('completed');
    // Deliverable lands in instructionSummary for side-panel completion-deliverable.
    const answer = round?.result?.body ?? '';
    expect(answer).toContain('\n');
    expect(answer).toContain('name,price,rating');
    expect(answer).toContain('Alpha Wireless Headphones');
    expect(answer).toContain('$49.99');
    const productLines = answer.split('\n').filter(l => /\$\d/.test(l));
    expect(productLines.length).toBeGreaterThanOrEqual(5);
    expect(round?.instructionSummary).toBe(answer);
  });

  it('completes the exact LH-03 task with the table and derived highest-price result', async () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const conclusion = formatMostExpensiveProductConclusion(rows);
    if (!conclusion) throw new Error('fixture prices must be comparable');
    const csvSummary = `${formatProductTableDeliverable(rows, 'csv')}\n${conclusion}`;

    let pageMarkerPresent = false;
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
      const observations = criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 600,
        source: 'page' as const,
        value: pageMarkerPresent,
      }));
      pageMarkerPresent = true;
      return observations;
    });
    const manager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureProductTableControlSteps({ csvSummary }),
        }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 600,
    });
    const completed = waitForVerifiedCompletion(manager, 'task-lh-03');

    await manager.dispatch({
      type: 'start',
      commandId: 'start-lh-03',
      taskId: 'task-lh-03',
      tabId: 11,
      instruction:
        '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取所有行为 name,price,rating CSV；3) 根据页面数据在回复中写出最贵商品的名称与价格。',
      chatSessionId: 'chat-lh-03',
      instructionMessageId: 'msg-lh-03',
    });

    const completedEvent = await completed;
    expect(completedEvent.snapshot.status).toBe('completed');
    expect(completedEvent.snapshot.rounds.find(round => round.id === completedEvent.roundId)?.receipt?.id).toBe(
      completedEvent.receiptId,
    );
    const snapshot = await manager.snapshot('task-lh-03');
    const round = snapshot?.rounds.find(item => item.id === snapshot.currentRoundId);
    expect(round?.instructionSummary).toContain('name,price,rating');
    expect(round?.instructionSummary).toContain(conclusion);
  });

  it('completes LH-03 when the product name is already visible at freeze', async () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const conclusion = formatMostExpensiveProductConclusion(rows);
    if (!conclusion) throw new Error('fixture prices must be comparable');
    const csvSummary = `${formatProductTableDeliverable(rows, 'csv')}\n${conclusion}`;

    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 600,
        source: 'page' as const,
        value: true,
      })),
    );
    const manager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureProductTableControlSteps({ csvSummary }),
        }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 600,
    });
    const completed = waitForVerifiedCompletion(manager, 'task-lh-03-present');

    await manager.dispatch({
      type: 'start',
      commandId: 'start-lh-03-present',
      taskId: 'task-lh-03-present',
      tabId: 11,
      instruction:
        '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取所有行为 name,price,rating CSV；3) 根据页面数据在回复中写出最贵商品的名称与价格。',
      chatSessionId: 'chat-lh-03-present',
      instructionMessageId: 'msg-lh-03-present',
    });

    const completedEvent = await completed;
    expect(completedEvent.snapshot.status).toBe('completed');
    const snapshot = await manager.snapshot('task-lh-03-present');
    const round = snapshot?.rounds.find(item => item.id === snapshot.currentRoundId);
    expect(round?.instructionSummary).toContain(conclusion);
  });
});
