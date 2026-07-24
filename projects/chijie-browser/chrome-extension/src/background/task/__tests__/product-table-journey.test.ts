/**
 * R1 tracer: list page extract → CSV deliverable on verified complete.
 * Scripted control path (auto_proxy); full e2e against fixture is optional follow-up.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionCriterion } from '@extension/storage/lib/task';
import { TaskManager } from '../manager';
import {
  createControlLoopDriver,
  fixtureProductTableControlSteps,
} from '../../agent/backends/control-loop';
import {
  extractProductsFromHtml,
  formatProductTableDeliverable,
  parseProductTableInstruction,
} from '../../browser/sites/product-table';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      url: () => 'http://127.0.0.1/products',
      tabId: 11,
      getContent: async () => '',
      observeActionTarget: async () => ({
        target: {
          id: 'el-1',
          kind: 'element' as const,
          tabId: 11,
          frameId: 0 as const,
          urlOrigin: 'http://127.0.0.1',
          digest: 'el-digest',
        },
        tag: 'li',
        type: '',
        inForm: false,
        intent: 'product row',
        semanticCommit: false,
      }),
      observeMedia: async () => ({ kind: 'none' as const }),
    }),
  },
}));

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureHtml = readFileSync(
  path.resolve(__dirname, '../../../../test/fixtures/products.html'),
  'utf8',
);

describe('R1 product-table journey (auto_proxy)', () => {
  beforeEach(() => store.sessions.clear());

  it('fixture HTML → CSV deliverable has ≥5 product rows', () => {
    const goal = parseProductTableInstruction(
      'Extract products to a CSV table with name, price, rating',
    );
    expect(goal).not.toBeNull();
    const rows = extractProductsFromHtml(fixtureHtml);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const deliverable = formatProductTableDeliverable(rows, goal!.format);
    expect(deliverable).toContain('name,price,rating');
    expect(deliverable).toContain('Alpha Wireless Headphones');
    // Data rows only (exclude header line after the result sentence)
    const dataLines = deliverable
      .split('\n')
      .filter(line => line.includes(',') && !line.startsWith('name,'));
    expect(dataLines.length).toBeGreaterThanOrEqual(5);
  });

  it('control script: complete with CSV summary as user-visible deliverable', async () => {
    const rows = extractProductsFromHtml(fixtureHtml);
    const csvSummary = formatProductTableDeliverable(rows, 'csv');

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

    await manager.dispatch({
      type: 'start',
      commandId: 'start-r1',
      taskId: 'task-r1',
      tabId: 11,
      instruction: 'Extract products to a CSV table with name, price, rating',
      chatSessionId: 'chat-r1',
      instructionMessageId: 'msg-r1',
    });

    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-r1'))?.status).toBe('completed');
    });

    const snap = await manager.snapshot('task-r1');
    if (!snap) throw new Error('missing task');
    const round = snap.rounds.find(r => r.id === snap.currentRoundId) ?? snap.rounds[0];
    expect(round?.status).toBe('completed');
    // Deliverable lands in instructionSummary for side-panel completion-deliverable.
    const answer = round?.instructionSummary ?? '';
    expect(answer).toContain('name,price,rating');
    expect(answer).toContain('Alpha Wireless Headphones');
    expect(answer).toContain('$49.99');
    const productLines = answer.split('\n').filter(l => /\$\d/.test(l));
    expect(productLines.length).toBeGreaterThanOrEqual(5);
  });
});
