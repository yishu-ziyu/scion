/**
 * M2: control backend under TaskManager (design/002 A2).
 * Scripted form path: plan → fill → submit (approval) → verified receipt.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionCriterion } from '@extension/storage/lib/task';
import { TaskManager } from '../manager';
import {
  createControlLoopDriver,
  fixtureFormControlSteps,
  fixtureNavigateControlSteps,
} from '../../agent/backends/control-loop';
import { ActionResult } from '../../agent/types';
import { isForbiddenTaskContentUrl } from '../../agent/backends/observe-act-loop';

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
      url: () => 'https://fixture.test/form',
      tabId: 7,
      observeActionTarget: async () => ({
        target: {
          id: 'el-1',
          kind: 'element' as const,
          tabId: 7,
          frameId: 0 as const,
          urlOrigin: 'https://fixture.test',
          digest: 'el-digest',
        },
        tag: 'button',
        type: 'submit',
        inForm: true,
        intent: 'submit form',
        semanticCommit: true,
      }),
      observeMedia: async () => ({ kind: 'none' as const }),
    }),
  },
}));

describe('control backend under TaskManager (G6 seam)', () => {
  beforeEach(() => store.sessions.clear());

  it('control form script: approve once then verified complete; no field values in snapshot', async () => {
    let submissions = 0;
    let observationCall = 0;
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
      const value = observationCall++ > 0 && submissions === 1;
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 500,
        source: 'page' as const,
        value,
      }));
    });

    const manager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureFormControlSteps({ nameText: 'FIELD_SENTINEL_CTRL' }),
          actionHandlers: {
            input_text: async () => new ActionResult({ success: true }),
            click_element: async () => {
              submissions += 1;
              return new ActionResult({ success: true });
            },
          },
        }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 500,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-ctrl',
      taskId: 'task-ctrl',
      tabId: 7,
      instruction: 'fill form FIELD_SENTINEL_CTRL and submit',
      chatSessionId: 'chat-ctrl',
      instructionMessageId: 'msg-ctrl',
    });

    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-ctrl'))?.status).toBe('waiting_approval');
    });

    const waiting = await manager.snapshot('task-ctrl');
    if (!waiting) throw new Error('missing task');
    const round = waiting.rounds.find(item => item.id === waiting.currentRoundId);
    const approval = round?.approvals[0];
    if (!round || !approval) throw new Error('missing approval');
    expect(submissions).toBe(0);

    await manager.dispatch({
      type: 'approve',
      commandId: 'approve-ctrl',
      taskId: 'task-ctrl',
      expectedRevision: waiting.revision,
      roundId: round.id,
      approvalId: approval.id,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-ctrl')).toMatchObject({
        status: 'completed',
      });
    });

    expect(submissions).toBe(1);
    const snap = await manager.snapshot('task-ctrl');
    expect(JSON.stringify(snap)).not.toContain('FIELD_SENTINEL_CTRL');
    expect(snap?.rounds[0]?.receipt).toBeTruthy();
  });

  it('navigate-first script: go_to_url + wait via TaskManager; steps recorded; no approval', async () => {
    let currentUrl = 'about:blank';
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        // Must match TaskManager baseline filter tab-\d+
        targetRefId: item.targetRefId?.startsWith('tab-') ? item.targetRefId : 'tab-9',
        observedAt: 600,
        source: 'page' as const,
        // url criteria match on string URL, not boolean
        value: item.kind === 'url' ? currentUrl : false,
      })),
    );

    const manager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureNavigateControlSteps({ url: 'https://www.youtube.com/' }),
          actionHandlers: {
            go_to_url: async args => {
              currentUrl = String(args.url);
              expect(isForbiddenTaskContentUrl(currentUrl)).toBe(false);
              return new ActionResult({ success: true });
            },
            wait: async () => new ActionResult({ success: true }),
          },
        }),
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 600,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-nav',
      taskId: 'task-nav',
      tabId: 9,
      instruction: '打开 YouTube',
      chatSessionId: 'chat-nav',
      instructionMessageId: 'msg-nav',
    });

    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-nav'))?.status).toBe('completed');
    });

    const snap = await manager.snapshot('task-nav');
    const round = snap?.rounds[0];
    expect(round?.receipt).toBeTruthy();
    const actionNames = (round?.attempts ?? []).map(a => a.actionName);
    expect(actionNames).toContain('go_to_url');
    // May complete right after go_to_url when url criteria already pass (no need to wait).
    expect(currentUrl).toBe('https://www.youtube.com/');
    // Side panel / extension pages must not be the navigated content target
    expect(isForbiddenTaskContentUrl(currentUrl)).toBe(false);
    expect(round?.approvals ?? []).toHaveLength(0);
  });

  it('ticket 05: go_to_url never waits approval; form submit does (single commit after approve)', async () => {
    // --- reversible navigate ---
    let navUrl = 'about:blank';
    const navObserve = vi.fn(async (criteria: CompletionCriterion[]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId?.startsWith('tab-') ? item.targetRefId : 'tab-3',
        observedAt: 700,
        source: 'page' as const,
        value: item.kind === 'url' ? navUrl : false,
      })),
    );
    const navManager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureNavigateControlSteps({
            url: 'https://example.com/',
            urlStartsWith: 'https://example.com',
          }),
          actionHandlers: {
            go_to_url: async args => {
              navUrl = String(args.url);
              return new ActionResult({ success: true });
            },
            wait: async () => new ActionResult({ success: true }),
          },
        }),
      switchTab: vi.fn(),
      observeCriteria: navObserve,
      now: () => 700,
    });
    await navManager.dispatch({
      type: 'start',
      commandId: 'nav-5',
      taskId: 'task-nav-5',
      tabId: 3,
      instruction: 'open example',
      chatSessionId: 'c-nav',
      instructionMessageId: 'm-nav',
    });
    await vi.waitFor(async () => {
      expect((await navManager.snapshot('task-nav-5'))?.status).toBe('completed');
    });
    expect((await navManager.snapshot('task-nav-5'))?.status).not.toBe('waiting_approval');

    // --- external commit form ---
    let submits = 0;
    let obs = 0;
    const formObserve = vi.fn(async (criteria: CompletionCriterion[]) => {
      const ok = obs++ > 0 && submits === 1;
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 800,
        source: 'page' as const,
        value: ok,
      }));
    });
    const formManager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: fixtureFormControlSteps({ nameText: 'X' }),
          actionHandlers: {
            input_text: async () => new ActionResult({ success: true }),
            click_element: async () => {
              submits += 1;
              return new ActionResult({ success: true });
            },
          },
        }),
      switchTab: vi.fn(),
      observeCriteria: formObserve,
      now: () => 800,
    });
    await formManager.dispatch({
      type: 'start',
      commandId: 'form-5',
      taskId: 'task-form-5',
      tabId: 4,
      instruction: 'submit form',
      chatSessionId: 'c-form',
      instructionMessageId: 'm-form',
    });
    await vi.waitFor(async () => {
      expect((await formManager.snapshot('task-form-5'))?.status).toBe('waiting_approval');
    });
    expect(submits).toBe(0);
    const waiting = await formManager.snapshot('task-form-5');
    if (!waiting) throw new Error('missing');
    const round = waiting.rounds.find(r => r.id === waiting.currentRoundId);
    const approval = round?.approvals[0];
    if (!round || !approval) throw new Error('missing approval');
    await formManager.dispatch({
      type: 'approve',
      commandId: 'ap-5',
      taskId: 'task-form-5',
      expectedRevision: waiting.revision,
      roundId: round.id,
      approvalId: approval.id,
    });
    await vi.waitFor(async () => {
      expect((await formManager.snapshot('task-form-5'))?.status).toBe('completed');
    });
    expect(submits).toBe(1);
  });

  it('ticket 03: navigation failure does not yield verified receipt (no false complete)', async () => {
    const manager = new TaskManager({
      createExecutor: async (input, hooks) =>
        createControlLoopDriver(input, hooks, {
          steps: [
            {
              type: 'plan',
              criteria: [{ kind: 'url', operator: 'starts_with', expected: 'https://www.youtube.com', required: true }],
            },
            { type: 'action', name: 'go_to_url', args: { url: 'https://www.youtube.com/' } },
            { type: 'fail', category: 'action_failed' },
          ],
          actionHandlers: {
            go_to_url: async () => new ActionResult({ error: 'nav_blocked', success: false }),
          },
        }),
      switchTab: vi.fn(),
      observeCriteria: async criteria =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId ?? 'tab-1',
          observedAt: 900,
          source: 'page' as const,
          value: 'about:blank',
        })),
      now: () => 900,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'fail-nav',
      taskId: 'task-fail-nav',
      tabId: 1,
      instruction: '打开 YouTube',
      chatSessionId: 'c-fail',
      instructionMessageId: 'm-fail',
    });

    await vi.waitFor(async () => {
      const s = await manager.snapshot('task-fail-nav');
      expect(s?.status === 'failed' || s?.status === 'waiting_user').toBe(true);
    });
    const snap = await manager.snapshot('task-fail-nav');
    expect(snap?.rounds[0]?.receipt).toBeFalsy();
    expect(snap?.status).not.toBe('completed');
  });
});
