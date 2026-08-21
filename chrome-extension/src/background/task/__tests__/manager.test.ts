import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkOrderedSourceVisitProof,
  checkInstructionDeliverable,
  findAnswerSpanOnPage,
  deriveInstructionDeliverableContract,
  deriveInstructionUrlPlan,
  type DeliverablePageEvidence,
  extractExplicitTableFields,
  instructionRequestsReturnedDeliverable,
  normalizeProvenanceUrl,
  queryIdentityDigestForUrl,
  redactDeliverableUrlsForPersistence,
  TaskManager,
} from '../manager';
import type { ExecutorDriver, ExecutorHooks, ExecutorInput, ExecutorOutcome, ObserveCriteria } from '../contracts';
import { StaleTaskRoundError } from '../contracts';
import { Action } from '../../agent/actions/builder';
import {
  clickElementActionSchema,
  closeTabActionSchema,
  controlMediaActionSchema,
  goToUrlActionSchema,
  waitActionSchema,
} from '../../agent/actions/schemas';
import { ActionResult } from '../../agent/types';
import { sha256 } from '../digest';
import { createTextArtifact } from '../artifact';
import type { BrowserTargetRef } from '@extension/storage/lib/task';
import { productRowEvidenceText } from '../../browser/sites/product-table';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  chatSessions: new Map<string, unknown>(),
  evidenceSpaces: new Map<
    string,
    {
      taskId: string;
      records: Array<{ recordType: string }>;
      workCycles: number;
      researchDecision?: unknown;
      researchDelivery?: unknown;
    }
  >(),
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
  evaluate: vi.fn(async () => ''),
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
    resetEvidenceWorkCycles: async (taskId: string) => {
      const current = store.evidenceSpaces.get(taskId);
      if (!current) return null;
      const next = { ...current, workCycles: 0 };
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
      evaluate: store.evaluate,
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

async function productTableEvidenceDigests(rows: Array<{ name: string; price: string; rating: string }>) {
  const rowDigests = await Promise.all(rows.map(row => sha256(productRowEvidenceText(row))));
  const rowSetDigest = await sha256(`product-row-set-v1:${JSON.stringify([...new Set(rowDigests)].sort())}`);
  return Promise.all([
    ...rows.flatMap(row => [row.name, row.price, row.rating]).map(sha256),
    ...rowDigests,
    rowSetDigest,
  ]);
}

describe('instruction deliverable contract', () => {
  const longInstruction =
    '先确认 IANA Example Domains 的标题和 URL，再打开 Wikipedia 的 Web_browser 条目，读取标题和首段定义，最终输出两条中文观察，每条都带 URL。';
  const ianaQuote = '这些域名只用于文档中的说明性示例';
  const wikipediaQuote = '网页浏览器是用于访问网站的软件应用';
  const pageEvidence = async (visitOrder: 'requested' | 'reversed' = 'requested') => [
    {
      normalizedUrl: 'https://www.iana.org/help/example-domains',
      textDigests: [await sha256('Example Domains'), await sha256(ianaQuote)],
      pageRevision: 'iana-revision',
      visitSeq: visitOrder === 'requested' ? 1 : 2,
    },
    {
      normalizedUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      textDigests: [await sha256('Web browser'), await sha256(wikipediaQuote)],
      pageRevision: 'wikipedia-revision',
      visitSeq: visitOrder === 'requested' ? 2 : 1,
    },
  ];

  it('treats only the final URL as current state for an ordered multi-source delivery', () => {
    expect(
      deriveInstructionUrlPlan(
        '先访问 https://www.iana.org/help/example-domains，再打开 https://en.wikipedia.org/wiki/Web_browser，最后输出比较。',
      ),
    ).toEqual({
      sourceUrls: ['https://www.iana.org/help/example-domains', 'https://en.wikipedia.org/wiki/Web_browser'],
      currentPageUrls: ['https://en.wikipedia.org/wiki/Web_browser'],
      requiresOrderedSourceProof: true,
    });
    expect(
      deriveInstructionUrlPlan(
        'Open https://one.test/source first, then https://two.test/result, and finally return a comparison.',
      ),
    ).toMatchObject({
      currentPageUrls: ['https://two.test/result'],
      requiresOrderedSourceProof: true,
    });
    expect(deriveInstructionUrlPlan('打开 https://example.test/report 后完成。')).toMatchObject({
      currentPageUrls: ['https://example.test/report'],
      requiresOrderedSourceProof: false,
    });
    expect(
      deriveInstructionUrlPlan('先访问 https://one.test/source，再访问 https://two.test/result，确认最终 URL 后完成。'),
    ).toMatchObject({
      currentPageUrls: ['https://two.test/result'],
      requiresOrderedSourceProof: true,
    });
    expect(deriveInstructionUrlPlan('访问 https://one.test/source，随后访问 https://two.test/result。')).toMatchObject({
      currentPageUrls: ['https://two.test/result'],
      requiresOrderedSourceProof: true,
    });
    expect(
      deriveInstructionUrlPlan(
        `先访问 https://one.test/source，${'记录页面可见信息。'.repeat(70)}然后访问 https://two.test/result。`,
      ),
    ).toMatchObject({
      currentPageUrls: ['https://two.test/result'],
      requiresOrderedSourceProof: true,
    });
    expect(deriveInstructionUrlPlan('比较 https://one.test/source 与 https://two.test/result。')).toMatchObject({
      currentPageUrls: ['https://one.test/source', 'https://two.test/result'],
      requiresOrderedSourceProof: false,
    });
    expect(
      deriveInstructionUrlPlan('1) 访问 https://one.test/source；2) 访问 https://two.test/result。'),
    ).toMatchObject({
      currentPageUrls: ['https://two.test/result'],
      requiresOrderedSourceProof: true,
    });
  });

  it('requires every ordered URL visit in sequence even when no text deliverable was requested', async () => {
    const instruction = '先访问 https://one.test/source，再访问 https://two.test/result，确认最终 URL 后完成。';
    const first = { normalizedUrl: 'https://one.test/source', visitSeq: 1 };
    const second = { normalizedUrl: 'https://two.test/result', visitSeq: 2 };

    await expect(checkOrderedSourceVisitProof(instruction, [second])).resolves.toBe(false);
    await expect(
      checkOrderedSourceVisitProof(instruction, [
        { ...second, visitSeq: 1 },
        { ...first, visitSeq: 2 },
      ]),
    ).resolves.toBe(false);
    await expect(checkOrderedSourceVisitProof(instruction, [first, second])).resolves.toBe(true);
  });

  it('does not classify the utterance into an output contract', () => {
    expect(deriveInstructionDeliverableContract(longInstruction)).toEqual({
      required: false,
      requiresPageContent: false,
      requiresChinese: false,
      minimumItems: 1,
      minimumItemsWithUrl: 0,
      minimumDistinctUrls: 0,
      eachItemNeedsUrl: false,
      requiresSourceOrder: false,
      minimumSourceCount: 0,
      requiresStructuredTable: false,
      requiresConclusion: false,
      requiresThemeAndCitation: false,
      requiredItemPrefixes: [],
      minimumContentChars: 0,
    });
    expect(instructionRequestsReturnedDeliverable('不要返回最终结果')).toBe(true);
    expect(instructionRequestsReturnedDeliverable('打开 https://example.com 后完成')).toBe(true);
  });

  it('rejects acknowledgement-only answers and accepts a real written result', async () => {
    expect(
      await checkInstructionDeliverable('阅读当前页面并概括核心主题', '好的，我来阅读当前页面并概括核心主题。'),
    ).toEqual({ passed: false, reasons: ['non_substantive'] });
    expect(
      await checkInstructionDeliverable('阅读当前页面并概括核心主题', '核心主题：这是一套面向长程推理的记忆系统。'),
    ).toEqual({ passed: true, reasons: [] });
  });

  it('requires URLs in the answer to have been visited', async () => {
    const answer = '观察：页面可用。 https://www.iana.org/help/example-domains';
    expect(await checkInstructionDeliverable(longInstruction, answer)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['url_not_visited']),
    });
    expect(await checkInstructionDeliverable(longInstruction, answer, await pageEvidence())).toEqual({
      passed: true,
      reasons: [],
    });
  });

  it('does not require visiting http(s) literals that are table cell values', async () => {
    const answer = [
      'name,price,url',
      'Alpha,$49.99,https://shop.example/p/alpha',
      'Beta,$9.00,https://shop.example/p/beta',
    ].join('\n');
    expect(await checkInstructionDeliverable('Extract products to a CSV table with name, price, url', answer)).toEqual({
      passed: true,
      reasons: [],
    });
  });

  it('does not require visiting http(s) literals in a Markdown table cell', async () => {
    const answer = ['| name | url |', '| --- | --- |', '| Alpha | https://shop.example/p/alpha |'].join('\n');
    expect(await checkInstructionDeliverable('Extract a Markdown table with name and url', answer)).toEqual({
      passed: true,
      reasons: [],
    });
  });

  it('still requires visiting a URL written outside the table', async () => {
    const answer = [
      'name,price,url',
      'Alpha,$49.99,https://shop.example/p/alpha',
      '详见 https://www.iana.org/help/example-domains',
    ].join('\n');
    expect(await checkInstructionDeliverable(longInstruction, answer)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['url_not_visited']),
    });
  });

  it('does not treat comma prose as a table that skips visit-check', async () => {
    const answer = ['See Alpha, https://a.example/source', 'See Beta, https://b.example/source'].join('\n');
    expect(await checkInstructionDeliverable(longInstruction, answer)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['url_not_visited']),
    });
  });
});

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
    store.evaluate.mockReset();
    store.evaluate.mockResolvedValue('');
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

  it('does not create a task when decideUserTurn says reply, even without a tab', async () => {
    const createExecutor = vi.fn(async () => fakeDriver());
    const decideUserTurn = vi.fn(async () => ({
      kind: 'reply' as const,
      userVisibleText: '你好，需要我帮你在页面上做什么？',
    }));
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      decideUserTurn,
      ...noPostCommitBackoff,
    });
    const ack = await manager.dispatch({
      type: 'start',
      commandId: 'cmd-classify-reply',
      taskId: 'task-classify-reply',
      instruction: '你好',
      chatSessionId: 'chat-classify',
      instructionMessageId: 'msg-classify',
      tabId: -1,
    });
    expect(ack).toMatchObject({
      accepted: false,
      error: 'not_executable',
      userVisibleText: '你好，需要我帮你在页面上做什么？',
    });
    expect(decideUserTurn).toHaveBeenCalledTimes(1);
    expect(createExecutor).not.toHaveBeenCalled();
    expect(store.sessions.get('task-classify-reply')).toBeUndefined();
  });

  it('skips decideUserTurn when forceExecute is set', async () => {
    const createExecutor = vi.fn(async () => fakeDriver());
    const decideUserTurn = vi.fn(async () => ({
      kind: 'reply' as const,
      userVisibleText: 'should not run',
    }));
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      decideUserTurn,
      ...noPostCommitBackoff,
    });
    const ack = await manager.dispatch({
      type: 'start',
      commandId: 'cmd-force',
      taskId: 'task-force',
      instruction: '你好',
      chatSessionId: 'chat-force',
      instructionMessageId: 'msg-force',
      tabId: 7,
      forceExecute: true,
    });
    expect(ack.accepted).toBe(true);
    expect(decideUserTurn).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
  });

  it('cancels the live task when follow_up is classified as stop', async () => {
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      decideUserTurn: async ({ text }) =>
        text === '停止'
          ? { kind: 'stop', userVisibleText: '好的，已停止。' }
          : { kind: 'execute', userVisibleText: '' },
      ...noPostCommitBackoff,
    });
    const started = await manager.dispatch({
      type: 'start',
      commandId: 'cmd-run',
      taskId: 'task-stop-follow',
      instruction: '打开 YouTube',
      chatSessionId: 'chat-stop',
      instructionMessageId: 'msg-run',
      tabId: 7,
    });
    expect(started.accepted).toBe(true);
    await vi.waitFor(async () => {
      const live = await manager.snapshot('task-stop-follow');
      expect(live?.status).toBe('running');
    });
    let stopped: Awaited<ReturnType<TaskManager['dispatch']>> | undefined;
    await vi.waitFor(async () => {
      const current = await manager.snapshot('task-stop-follow');
      stopped = await manager.dispatch({
        type: 'follow_up',
        commandId: `cmd-stop-${current?.revision ?? 0}`,
        taskId: 'task-stop-follow',
        expectedRevision: current?.revision ?? 0,
        instruction: '停止',
        chatSessionId: 'chat-stop',
        instructionMessageId: 'msg-stop',
      });
      expect(stopped.accepted || (stopped.accepted === false && stopped.error === 'stale_revision')).toBe(true);
      expect(stopped.accepted).toBe(true);
    });
    expect(stopped).toMatchObject({ accepted: true, userVisibleText: '好的，已停止。' });
    const snapshot = await manager.snapshot('task-stop-follow');
    expect(snapshot?.status).toBe('cancelled');
  });

  it('does not hold this.transition while decideUserTurn is still running', async () => {
    const driver = fakeDriver();
    let finishClassify!: (decision: { kind: 'execute'; userVisibleText: string }) => void;
    const decideUserTurn = vi.fn(
      () =>
        new Promise<{ kind: 'execute'; userVisibleText: string }>(resolve => {
          finishClassify = resolve;
        }),
    );
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      decideUserTurn,
      ...noPostCommitBackoff,
    });
    const started = await manager.dispatch({
      type: 'start',
      commandId: 'cmd-lock-start',
      taskId: 'task-lock',
      instruction: '打开 YouTube',
      chatSessionId: 'chat-lock',
      instructionMessageId: 'msg-lock-start',
      tabId: 7,
      forceExecute: true,
    });
    expect(started.accepted).toBe(true);
    await vi.waitFor(async () => {
      const live = await manager.snapshot('task-lock');
      expect(live?.status).toBe('running');
    });
    const live = await manager.snapshot('task-lock');
    const followPromise = manager.dispatch({
      type: 'follow_up',
      commandId: 'cmd-lock-follow',
      taskId: 'task-lock',
      expectedRevision: live?.revision ?? 0,
      instruction: '再搜一次',
      chatSessionId: 'chat-lock',
      instructionMessageId: 'msg-lock-follow',
    });
    await vi.waitFor(() => expect(decideUserTurn).toHaveBeenCalled());
    const beforePause = await manager.snapshot('task-lock');
    const paused = await manager.dispatch({
      type: 'pause',
      commandId: 'cmd-lock-pause',
      taskId: 'task-lock',
      expectedRevision: beforePause?.revision ?? 0,
    });
    // Must settle while decideUserTurn is still hanging. stale_revision is
    // still a dispatch result; hanging would mean this.transition held the classify.
    expect(paused.accepted || (paused.accepted === false && paused.error === 'stale_revision')).toBe(true);
    finishClassify({ kind: 'execute', userVisibleText: '' });
    await followPromise;
  });

  it('writes a live 获取页面快照 step on start before createExecutor returns', async () => {
    let finishCreate!: (driver: ExecutorDriver) => void;
    const createExecutor = vi.fn(() => new Promise<ExecutorDriver>(resolve => (finishCreate = resolve)));
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'cmd-live-step',
      taskId: 'task-live-step',
      instruction: '打开这个网页的第二行的第一个视频',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    const snap = await manager.snapshot('task-live-step');
    expect(snap?.rounds[0]?.attempts).toEqual([
      expect.objectContaining({
        actionName: 'observe',
        state: 'executing',
        displaySummary: '获取页面快照',
      }),
    ]);
    finishCreate(fakeDriver());
  });

  it('marks the start snapshot done when the loop reports decide', async () => {
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
      commandId: 'cmd-decide-step',
      taskId: 'task-decide-step',
      instruction: '打开这个网页的第二行的第一个视频',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-decide-step');
    await hooks.reportLoopPhase?.(roundId, { phase: 'decide', step: 0 });
    const snap = await manager.snapshot('task-decide-step');
    expect(snap?.rounds[0]?.attempts[0]).toMatchObject({
      actionName: 'observe',
      state: 'observed',
    });
  });

  it('follows only when asked and takeover pauses without leaving follow on', async () => {
    const driver = fakeDriver();
    const setFollowForeground = vi.fn();
    const revealTab = vi.fn();
    const beginTaskTabGroup = vi.fn(async () => 12);
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      setFollowForeground,
      revealTab,
      beginTaskTabGroup,
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'cmd-1',
      taskId: 'task-1',
      instruction: 'open the form',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    expect(setFollowForeground).toHaveBeenCalledWith(false);
    expect(beginTaskTabGroup).toHaveBeenCalled();
    expect((await manager.snapshot('task-1'))?.tabGroupId).toBe(12);
    expect((await manager.snapshot('task-1'))?.followForeground).toBeFalsy();

    const followed = await manager.dispatch({
      type: 'set_follow',
      commandId: 'cmd-follow',
      taskId: 'task-1',
      expectedRevision: 1,
      follow: true,
    });
    expect(followed.accepted).toBe(true);
    expect((await manager.snapshot('task-1'))?.followForeground).toBe(true);
    expect(setFollowForeground).toHaveBeenCalledWith(true);
    expect(revealTab).toHaveBeenCalledWith(7);

    const taken = await manager.dispatch({
      type: 'takeover',
      commandId: 'cmd-take',
      taskId: 'task-1',
      expectedRevision: 2,
    });
    expect(taken.accepted).toBe(true);
    const after = await manager.snapshot('task-1');
    expect(after?.status).toBe('paused');
    expect(after?.followForeground).toBe(false);
    expect(driver.pause).toHaveBeenCalled();
    expect(setFollowForeground).toHaveBeenLastCalledWith(false);
  });

  it('rejects malformed URL criteria instead of degrading them to user confirmation', async () => {
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    const freezeCriterion = (
      manager as unknown as {
        freezeCriterion(
          draft: {
            kind: 'url';
            operator: 'equals';
            expected: string;
            required: boolean;
          },
          roundId: string,
          targetRefId: string,
          frozenAt: number,
          userFieldValues: Set<string>,
        ): Promise<unknown>;
      }
    ).freezeCriterion.bind(manager);
    await expect(
      freezeCriterion(
        { kind: 'url', operator: 'equals', expected: 'https://example.test/report?q=%ZZ', required: true },
        'round-malformed',
        'tab-7',
        100,
        new Set(),
      ),
    ).rejects.toThrow('invalid_url_criterion');
  });

  it('clears stale body evidence when a later fresh page capture fails', async () => {
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-stale-capture',
      taskId: 'task-stale-capture',
      instruction: '读取当前页面正文',
      chatSessionId: 'chat-stale-capture',
      instructionMessageId: 'message-stale-capture',
      tabId: 7,
    });
    const roundId = await taskRoundId(manager, 'task-stale-capture');
    const persistTarget = (
      manager as unknown as {
        persistTarget(taskId: string, roundId: string, target: BrowserTargetRef): Promise<void>;
      }
    ).persistTarget.bind(manager);
    const queryIdentityDigest = await queryIdentityDigestForUrl('https://example.test/report?id=1');
    await persistTarget('task-stale-capture', roundId, {
      id: 'page-stale-capture',
      kind: 'page',
      tabId: 7,
      frameId: 0,
      urlOrigin: 'https://example.test',
      normalizedUrl: 'https://example.test/report',
      queryIdentityDigest,
      bodyDigest: 'old-body',
      textDigests: ['old-text'],
      pageRevision: 'old-revision',
      digest: 'old-capture-digest',
    });
    const before = (await manager.snapshot('task-stale-capture'))?.targetRefs.find(
      target => target.id === 'page-stale-capture',
    );

    await persistTarget('task-stale-capture', roundId, {
      id: 'page-stale-capture',
      kind: 'page',
      tabId: 7,
      frameId: 0,
      urlOrigin: 'https://example.test',
      normalizedUrl: 'https://example.test/report',
      queryIdentityDigest,
      digest: 'failed-fresh-capture',
    });
    const after = (await manager.snapshot('task-stale-capture'))?.targetRefs.find(
      target => target.id === 'page-stale-capture',
    );
    expect(before).toMatchObject({ bodyDigest: 'old-body', textDigests: ['old-text'], pageRevision: 'old-revision' });
    expect(after).toMatchObject({ digest: 'failed-fresh-capture' });
    expect(after?.visitSeq).toBeGreaterThan(before?.visitSeq ?? 0);
    expect(after).not.toHaveProperty('bodyDigest');
    expect(after).not.toHaveProperty('textDigests');
    expect(after).not.toHaveProperty('pageRevision');
    expect(after).toMatchObject({ queryIdentityDigest });

    store.observeActionTarget.mockRejectedValueOnce(new Error('execution context destroyed before capture'));
    const captureCurrentPageEvidence = (
      manager as unknown as {
        captureCurrentPageEvidence(taskId: string, roundId: string): Promise<void>;
      }
    ).captureCurrentPageEvidence.bind(manager);
    await captureCurrentPageEvidence('task-stale-capture', roundId);
    const latest = [...((await manager.snapshot('task-stale-capture'))?.targetRefs ?? [])]
      .filter(target => target.kind === 'page')
      .sort((left, right) => (right.visitSeq ?? -1) - (left.visitSeq ?? -1))[0];
    expect(latest?.visitSeq).toBeGreaterThan(after?.visitSeq ?? 0);
    expect(latest).toMatchObject({
      normalizedUrl: 'https://example.test/report',
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(latest).not.toHaveProperty('bodyDigest');
    expect(latest).not.toHaveProperty('textDigests');
    expect(latest).not.toHaveProperty('pageRevision');
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
    expect(snap?.plan?.phases).toHaveLength(1);
    expect(snap?.plan?.phases[0]).toMatchObject({ id: 'phase-1', title: '执行', status: 'active' });
    expect(snap?.plan?.goal).toBe('执行任务');
    expect(snap?.goalSummary).toBe('执行任务');
    expect(JSON.stringify(snap)).not.toContain('竞品');
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
    expect(planBefore?.phases.map(p => p.title)).toEqual(['执行']);

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

  it('reconciles first frozen criteria into one proof phase and a requested output phase', async () => {
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
    expect(snap?.plan?.phases).toEqual([
      expect.objectContaining({ title: '执行', status: 'active', criteriaIds: [criterionId] }),
    ]);
  });

  it.each([
    [
      '先再',
      '先访问 https://www.iana.org/help/example-domains，再打开 https://en.wikipedia.org/wiki/Web_browser，最后输出比较。',
    ],
    [
      '随后',
      '访问 https://www.iana.org/help/example-domains，随后打开 https://en.wikipedia.org/wiki/Web_browser，最后输出比较。',
    ],
  ])('freezes only the final URL for an ordered two-source delivery: %s', async (caseName, instruction) => {
    const taskId = `task-two-source-url-plan-${caseName}`;
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
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
      commandId: `start-${taskId}`,
      taskId,
      instruction,
      chatSessionId: 'chat-two-source-url-plan',
      instructionMessageId: 'message-two-source-url-plan',
      tabId: 7,
    });

    await vi.waitFor(async () => expect((await manager.snapshot(taskId))?.rounds[0]?.criteria.length).toBe(1));
    const snapshot = await manager.snapshot(taskId);
    expect(snapshot?.rounds[0]?.criteria).toEqual([
      expect.objectContaining({
        kind: 'url',
        expected: 'https://en.wikipedia.org/wiki/Web_browser',
        targetRefId: 'tab-7',
      }),
    ]);
    expect(snapshot?.plan?.phases.map(phase => phase.title)).toEqual(['执行']);
  });

  it('completes an ordered two-URL page-state task only after persisted visit-order proof', async () => {
    const instruction = '先访问 https://one.test/source，再访问 https://two.test/result，确认最终 URL 后完成。';
    let finish!: (outcome: ExecutorOutcome) => void;
    let observeCall = 0;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
        observeCall += 1;
        return criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: observeCall === 1 ? 'https://one.test/source' : 'https://two.test/result',
        }));
      }),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-ordered-page-state',
      taskId: 'task-ordered-page-state',
      instruction,
      chatSessionId: 'chat-ordered-page-state',
      instructionMessageId: 'message-ordered-page-state',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    const persisted = structuredClone(store.sessions.get('task-ordered-page-state')) as
      | { targetRefs: BrowserTargetRef[] }
      | undefined;
    if (!persisted) throw new Error('missing persisted task');
    persisted.targetRefs = [
      {
        id: 'page-one',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://one.test',
        normalizedUrl: 'https://one.test/source',
        digest: 'one-digest',
        visitSeq: 1,
      },
      {
        id: 'page-two',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://two.test',
        normalizedUrl: 'https://two.test/result',
        digest: 'two-digest',
        visitSeq: 2,
      },
    ];
    store.sessions.set('task-ordered-page-state', persisted);
    finish({ kind: 'candidate_complete', summary: '最终页面已到达目标地址。' });

    await vi.waitFor(async () =>
      expect(await manager.snapshot('task-ordered-page-state')).toMatchObject({
        status: 'completed',
        rounds: [{ receipt: { taskId: 'task-ordered-page-state' } }],
      }),
    );
  });

  it('freezes LH-02 URL and page text into one proof phase without a chat output phase', async () => {
    let hooks!: ExecutorHooks;
    const instruction =
      '离开 example.com；打开 https://en.wikipedia.org/wiki/Web_browser；确认页面正文含 web browser 后再完成。';
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
      commandId: 'start-lh02-plan',
      taskId: 'task-lh02-plan',
      instruction,
      chatSessionId: 'chat-lh02-plan',
      instructionMessageId: 'message-lh02-plan',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const snapshot = await manager.snapshot('task-lh02-plan');
    const kinds = snapshot?.rounds[0]?.criteria.map(criterion => criterion.kind);
    expect(kinds).toEqual(['url', 'page_text']);
    expect(snapshot?.plan?.phases).toEqual([
      expect.objectContaining({
        title: '执行',
        status: 'active',
        criteriaIds: snapshot?.rounds[0]?.criteria.map(criterion => criterion.id),
      }),
    ]);

    const roundId = snapshot?.currentRoundId;
    expect(roundId).toBeTruthy();
    await expect(hooks.getMissionPlan?.(roundId!)).resolves.toEqual({
      id: snapshot?.plan?.id,
      goal: snapshot?.plan?.goal,
      phases: [{ id: snapshot?.plan?.phases[0]?.id, title: '执行', status: 'active' }],
    });
    await expect(hooks.getMissionPlan?.('stale-round')).rejects.toBeInstanceOf(StaleTaskRoundError);

    await hooks.onPlan(roundId!, [{ kind: 'page_text', operator: 'present', expected: 'web browser', required: true }]);
    expect((await manager.snapshot('task-lh02-plan'))?.rounds[0]?.criteria).toHaveLength(2);
  });

  it('safely adds a model page-text criterion after an implicit URL freeze', async () => {
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
      commandId: 'start-url-then-text',
      taskId: 'task-url-then-text',
      instruction: '打开 https://example.test/report 后完成。',
      chatSessionId: 'chat-url-then-text',
      instructionMessageId: 'message-url-then-text',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-url-then-text');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'Report title', required: true }]);
    const snapshot = await manager.snapshot('task-url-then-text');
    expect(snapshot?.rounds[0]?.criteria.map(criterion => criterion.kind)).toEqual(['url', 'page_text']);
    expect(snapshot?.plan?.phases).toEqual([
      expect.objectContaining({
        title: '执行',
        criteriaIds: snapshot?.rounds[0]?.criteria.map(criterion => criterion.id),
      }),
    ]);
  });

  it.each([
    [
      'LH-01',
      '进入英文维基；搜索并打开 Artificial intelligence 条目；确认 URL 在 wiki/Artificial_intelligence 后再完成。',
      ['执行'],
      ['url'],
    ],
    [
      'LH-04',
      '这是一个双来源交付任务：先访问 IANA Example Domains，再打开 https://en.wikipedia.org/wiki/Web_browser。最终交付包含两个完整 URL、两条中文观察、IANA 标题、Wikipedia 标题与首段定义。',
      ['执行'],
      ['url'],
    ],
  ])('aligns %s initial proof and returned-deliverable plan shape', async (label, instruction, titles, kinds) => {
    const taskId = `task-${label.toLowerCase()}`;
    const manager = new TaskManager({
      createExecutor: async () => fakeDriver(),
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
      commandId: `start-${label.toLowerCase()}`,
      taskId,
      instruction,
      chatSessionId: `chat-${label.toLowerCase()}`,
      instructionMessageId: `message-${label.toLowerCase()}`,
      tabId: 7,
    });
    await vi.waitFor(async () =>
      expect((await manager.snapshot(taskId))?.rounds[0]?.criteria.length).toBeGreaterThan(0),
    );
    const snapshot = await manager.snapshot(taskId);
    expect(snapshot?.rounds[0]?.criteria.map(criterion => criterion.kind)).toEqual(kinds);
    expect(snapshot?.plan?.phases.map(phase => phase.title)).toEqual(titles);
    expect(snapshot?.plan?.phases[0]?.criteriaIds).toEqual(
      snapshot?.rounds[0]?.criteria.filter(criterion => criterion.required).map(criterion => criterion.id),
    );
    expect(snapshot?.rounds[0]?.receipt).toBeUndefined();
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
    expect(snap?.plan?.phases.map(p => p.status)).toEqual(['active']);

    await hooks.dispatchAction(roundId, new Action(async () => new ActionResult({ success: true }), waitActionSchema), {
      seconds: 1,
      intent: 'wait again',
    });
    snap = await manager.snapshot('task-plan-no-heuristic');
    expect(snap?.plan?.phases.map(p => p.status)).toEqual(['active']);
  });

  it('does not let a forged output close a progressed proof phase', async () => {
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
        evidenceIds: [...(mid.plan.phases[0]?.criteriaIds ?? [])],
      };
      mid.plan.phases[1] = { ...mid.plan.phases[1]!, status: 'active' };
      if (mid.plan.phases[0]?.status === 'done' && mid.plan.phases[1]?.status === 'active') {
        store.sessions.set('task-plan-done', structuredClone(mid));
      }
    }

    pageTextPresent = true;
    finish({ kind: 'candidate_complete', summary: 'done' });

    await vi.waitFor(async () => {
      const snapshot = await manager.snapshot('task-plan-done');
      expect(snapshot?.status === 'completed' || snapshot?.status === 'failed' || snapshot?.status === 'running').toBe(
        true,
      );
    });
    const done = await manager.snapshot('task-plan-done');
    expect(done?.plan?.phases.map(p => p.status)).not.toEqual(['done', 'done', 'done']);
    // Intermediate evidence preserved on the already-done proof phase.
    expect(done?.plan?.phases[0]?.evidenceIds).toEqual(done?.plan?.phases[0]?.criteriaIds);
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
      rounds: [
        { attempts: expect.arrayContaining([expect.objectContaining({ state: 'observed' })]) },
        { status: 'running' },
      ],
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
      rounds: [
        {
          waitReason: 'target_missing',
          attempts: expect.arrayContaining([expect.objectContaining({ state: 'blocked' })]),
        },
      ],
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
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: true,
        })),
      ),
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
                expectedDigest: await sha256('Saved successfully'.toLocaleLowerCase()),
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
              expected: 'https://www.youtube.com',
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
      expected: 'https://www.youtube.com',
    });
  });

  it('completes from a written result even when only optional page_text exists', async () => {
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

    finish({ kind: 'candidate_complete', summary: 'I grouped the visible sections on this page.' });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-optional-proof')).toMatchObject({
        status: 'completed',
        rounds: [{ status: 'completed' }],
      });
    });
    expect((await manager.snapshot('task-optional-proof'))?.rounds[0]?.receipt).toBeDefined();
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
      expected: 'https://www.youtube.com',
    });
  });

  it('completes a written source fact once the URL is reached', async () => {
    const url = 'https://example.test/report';
    const instruction = `At ${url}, tell me the launch date.`;
    const driver = fakeDriver();
    driver.run = vi.fn().mockResolvedValue({
      kind: 'candidate_complete',
      summary: 'The launch date is 2099-01-01.',
    });
    let observeCall = 0;
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) => {
        observeCall += 1;
        return criteria.map(criterion => ({
          criterionId: criterion.id,
          roundId: criterion.roundId,
          targetRefId: criterion.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: criterion.kind === 'url' ? (observeCall === 1 ? 'about:blank' : url) : false,
        }));
      }),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-url-fact-no-text',
      taskId: 'task-url-fact-no-text',
      instruction,
      chatSessionId: 'chat-url-fact-no-text',
      instructionMessageId: 'message-url-fact-no-text',
      tabId: 7,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-url-fact-no-text')).toMatchObject({
        status: 'completed',
        rounds: [{ status: 'completed' }],
      });
    });
    const snapshot = await manager.snapshot('task-url-fact-no-text');
    expect(snapshot?.rounds[0]?.receipt).toBeDefined();
    expect(snapshot?.rounds[0]?.instructionSummary).toContain('2099-01-01');
    expect(driver.run).toHaveBeenCalledTimes(1);
  });

  it('accepts open-ended identity output as a written result', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({ kind: 'candidate_complete', summary: '是。host=bilibili.com' });
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
        rounds: [{ status: 'completed', instructionSummary: '是。host=bilibili.com' }],
      });
    });
    const snap = await manager.snapshot('task-open-ended');
    expect(snap?.rounds[0]?.waitReason).toBeUndefined();
    expect(snap?.rounds[0]?.receipt).toBeDefined();
  });

  it('accepts a page summary when the written result is not an acknowledgement', async () => {
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
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('not a result'));
    expect((await manager.snapshot('task-aicss-summary'))?.rounds[0]?.receipt).toBeDefined();
  });

  it('completes a current-page video-about question from visible titles, not a model page_text', async () => {
    const instruction = '现在这个页面的视频都是跟什么有关的';
    const title1 = 'Harness 实践:让 Agent 全自动制作知识讲解视频';
    const title2 = '给智能体的记忆系统怎么落地';
    let hooks!: ExecutorHooks;
    let finish!: (outcome: ExecutorOutcome) => void;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
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
      commandId: 'start-bili-about',
      taskId: 'task-bili-about',
      instruction,
      chatSessionId: 'chat-bili-about',
      instructionMessageId: 'message-bili-about',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-bili-about');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: title1, required: false }]);
    expect((await manager.snapshot('task-bili-about'))?.rounds[0]?.criteria).toEqual([]);

    store.evaluate.mockResolvedValue(`${title1}\n${title2}\n登录\n首页`);
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'page-bili-about',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://www.bilibili.com',
        normalizedUrl: 'https://www.bilibili.com',
        digest: 'bili-about-digest',
        textDigests: [await sha256(title1), await sha256(title2)],
        pageRevision: 'bili-about-revision',
        observedAt: 100,
      },
      tag: 'body',
      type: '',
      inForm: false,
    });
    finish({
      kind: 'candidate_complete',
      summary: '这些视频主要跟 Agent 和知识讲解有关。',
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-bili-about')).toMatchObject({
        status: 'completed',
        rounds: [{ status: 'completed' }],
      });
    });
    const snap = await manager.snapshot('task-bili-about');
    expect(snap?.rounds[0]?.failureCategory).toBeUndefined();
    expect(snap?.rounds[0]?.instructionSummary).toContain('这些视频主要跟 Agent 和知识讲解有关。');
    expect(snap?.rounds[0]?.receipt).toBeDefined();
    expect(driver.run).toHaveBeenCalledTimes(1);
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
        rounds: [{ status: 'failed', failureCategory: 'no_completion_criteria' }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect((await manager.snapshot('task-summary-missing'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('accepts a two-part theme and citation grounded in current-page text', async () => {
    const quote = '用于结构化长程推理的自组织记忆操作系统';
    const { answerThemeAndCitationFromPage } = await import('../../browser/sites/theme-citation');
    const result = answerThemeAndCitationFromPage(
      ['EverMemOS', quote, '面向各种用例的基于记忆的 AI 解决方案'].join('\n'),
      'EverMind',
    );
    expect(result?.answer).toBeTruthy();

    await expect(
      checkInstructionDeliverable(
        '阅读当前页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。',
        result!.answer,
        [
          {
            normalizedUrl: 'https://evermind.ai/zh/',
            pageRevision: 'evermind-1',
            textDigests: [await sha256(quote)],
            visitSeq: 1,
            label: 'EverMind',
          },
        ],
      ),
    ).resolves.toMatchObject({ passed: true, reasons: [] });
  });

  it('rejects placeholder complete text and grounds a quote in page evidence', async () => {
    await expect(checkInstructionDeliverable('读当前页', 'Control loop candidate complete')).resolves.toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['non_substantive']),
    });
    const quote = '长期记忆准确率 93.05%';
    await expect(
      findAnswerSpanOnPage(`主题：给智能体的记忆系统。引用：「${quote}」`, [
        {
          normalizedUrl: 'https://evermind.ai/zh/',
          pageRevision: 'evermind-1',
          textDigests: [await sha256(quote)],
        },
      ]),
    ).resolves.toBe(quote);
  });

  it('grounds a quote that is only a substring of a captured sentence via live page text', async () => {
    const sentence = 'EverMind 是用于结构化长程推理的自组织记忆操作系统。';
    const quote = '用于结构化长程推理';
    const evidence = [
      {
        normalizedUrl: 'https://evermind.ai/zh/',
        pageRevision: 'evermind-1',
        textDigests: [await sha256(sentence)],
      },
    ];
    await expect(findAnswerSpanOnPage(`主题：给智能体的记忆系统。引用：「${quote}」`, evidence)).resolves.toBeNull();
    await expect(
      findAnswerSpanOnPage(`主题：给智能体的记忆系统。引用：「${quote}」`, evidence, sentence),
    ).resolves.toBe(quote);
  });

  it('grounds an opened-video title quoted from the watch page', async () => {
    const title = '《传教士》第5期：圣杀者领取追杀令，上帝视频通话小镇！【墨菲】';
    const live = `分享\n${title}\n投币 收藏`;
    await expect(findAnswerSpanOnPage(`已打开「${title}」`, [], live)).resolves.toBe(title);
  });

  it('accepts a written theme even when it is title and domain', async () => {
    const artifact = createTextArtifact({
      title: 'Understanding answer',
      text: '标题：上下文工程（中文版） - Feishu Docs；域名：my.feishu.cn',
      sources: [{ url: 'https://my.feishu.cn/wiki/example', title: '上下文工程（中文版）' }],
    });
    const driver = fakeDriver();
    driver.run = vi.fn().mockResolvedValue({
      kind: 'candidate_complete',
      summary: '标题：上下文工程（中文版） - Feishu Docs；域名：my.feishu.cn',
      artifacts: [artifact],
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
      commandId: 'start-feishu-theme',
      taskId: 'task-feishu-theme',
      instruction: '阅读当前飞书页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。',
      chatSessionId: 'chat-feishu-theme',
      instructionMessageId: 'message-feishu-theme',
      tabId: 7,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-feishu-theme')).toMatchObject({
        status: 'completed',
        rounds: [{ status: 'completed' }],
      });
    });
    expect((await manager.snapshot('task-feishu-theme'))?.rounds[0]?.receipt).toBeDefined();
    expect((await manager.snapshot('task-feishu-theme'))?.rounds[0]?.instructionSummary).toContain('上下文工程');
    expect(driver.run).toHaveBeenCalledTimes(1);
  });

  it('rejects an acknowledgement, then accepts a written result', async () => {
    const instruction = '阅读当前页面，用一句中文概括核心主题。';
    const answer = '核心主题：这是一套面向长程推理的记忆系统。';
    let hooks!: ExecutorHooks;
    let finish!: (outcome: ExecutorOutcome) => void;
    let criteriaFrozen = false;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 100,
          source: 'page' as const,
          value: criteriaFrozen,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-ack-then-answer',
      taskId: 'task-ack-then-answer',
      instruction,
      chatSessionId: 'chat-ack-then-answer',
      instructionMessageId: 'message-ack-then-answer',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-ack-then-answer');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: '记忆', required: true }]);
    criteriaFrozen = true;
    finish({ kind: 'candidate_complete', summary: '好的，我来阅读当前页面并概括核心主题。' });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    finish({ kind: 'candidate_complete', summary: answer });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-ack-then-answer')).toMatchObject({
        status: 'completed',
        rounds: [{ instructionSummary: answer, receipt: { taskId: 'task-ack-then-answer' } }],
      });
    });
  });

  it('never persists a raw query from a verified final answer or its visited page', async () => {
    const rawUrl = 'https://example.test/report?id=1&token=TOPSECRET';
    const visibleQuote = '当前报告页面展示了这一条可验证的正文事实';
    const answer = `页面写道“${visibleQuote}”：${rawUrl}`;
    let hooks!: ExecutorHooks;
    let finish!: (outcome: ExecutorOutcome) => void;
    let criteriaFrozen = false;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    const manager = new TaskManager({
      createExecutor: vi.fn(async (_input, nextHooks) => {
        hooks = nextHooks;
        return driver;
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: Parameters<ObserveCriteria>[0]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          pageRevision: item.pageRevision,
          observedAt: 100,
          source: 'page' as const,
          value: criteriaFrozen,
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-query-persistence',
      taskId: 'task-query-persistence',
      instruction: '输出当前页面正文引文和 URL。',
      chatSessionId: 'chat-query-persistence',
      instructionMessageId: 'message-query-persistence',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-query-persistence');
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: visibleQuote, required: true }]);
    criteriaFrozen = true;
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'page-query-persistence',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.test',
        normalizedUrl: normalizeProvenanceUrl(rawUrl)!,
        queryIdentityDigest: await queryIdentityDigestForUrl(rawUrl),
        digest: 'query-persistence-digest',
        textDigests: [await sha256(visibleQuote)],
        pageRevision: 'query-persistence-revision',
        observedAt: 100,
      },
      tag: 'body',
      type: '',
      inForm: false,
    });
    await hooks.dispatchAction(
      roundId,
      new Action(async () => new ActionResult({ success: true }), goToUrlActionSchema),
      {
        url: rawUrl,
        intent: 'visit report',
      },
    );
    finish({ kind: 'candidate_complete', summary: answer });

    await vi.waitFor(async () => expect((await manager.snapshot('task-query-persistence'))?.status).toBe('completed'));
    const snapshot = await manager.snapshot('task-query-persistence');
    expect(JSON.stringify(snapshot)).not.toContain('TOPSECRET');
    expect(JSON.stringify(snapshot)).not.toContain('?id=1');
    if (snapshot?.rounds[0]?.instructionSummary !== 'User instruction') {
      expect(snapshot?.rounds[0]?.instructionSummary).toBe(await redactDeliverableUrlsForPersistence(answer));
    }
  });

  it('does not receipt a complete-looking two-URL answer when those sources were never visited', async () => {
    const instruction =
      '先确认 IANA Example Domains 的标题和 URL，再打开 Wikipedia 的 Web_browser 条目，读取标题和首段定义，最终输出两条中文观察，每条都带 URL。';
    const answer = [
      '1. IANA 页面说明这些域名只用于文档示例：https://www.iana.org/help/example-domains',
      '2. Web browser 条目定义浏览器是访问网站的软件：https://en.wikipedia.org/wiki/Web_browser',
    ].join('\n');
    const driver = fakeDriver();
    driver.run = vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: answer });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => driver),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-unvisited-sources',
      taskId: 'task-unvisited-sources',
      instruction,
      chatSessionId: 'chat-unvisited',
      instructionMessageId: 'message-unvisited',
      tabId: 7,
    });
    await vi.waitFor(async () => {
      expect((await manager.snapshot('task-unvisited-sources'))?.status).toBe('failed');
    });
    expect((await manager.snapshot('task-unvisited-sources'))?.rounds[0]?.receipt).toBeUndefined();
    expect(driver.run).toHaveBeenCalledTimes(2);
  });

  it('completes a read-only page summary from the written result', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({
        kind: 'candidate_complete',
        summary: 'The AICSS page presents a completed five-item To-do List component alongside its React example code.',
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
          ...(criterion.pageRevision ? { pageRevision: criterion.pageRevision } : {}),
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
    const quote = 'A completed five-item To-do List appears next to its React example code';
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'page-summary',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.test',
        normalizedUrl: 'https://example.test/watch',
        digest: 'digest-summary',
        textDigests: [await sha256(quote)],
        pageRevision: 'summary-revision',
        observedAt: 100,
      },
      inForm: false,
    });
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'To-dos 5/5', required: true }]);
    finish({
      kind: 'candidate_complete',
      summary: `The AICSS page shows: “${quote}”.`,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-summary-with-criterion')).toMatchObject({
        status: 'completed',
        rounds: [{ status: 'completed' }],
      });
    });
    expect((await manager.snapshot('task-summary-with-criterion'))?.rounds[0]?.receipt).toBeDefined();
    expect(driver.run).toHaveBeenCalledTimes(1);
  });

  it('completes a read-only page summary only when page_text evidence is true', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    let pageTextPresent = false;
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
          value: pageTextPresent,
          ...(criterion.pageRevision ? { pageRevision: criterion.pageRevision } : {}),
        })),
      ),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-summary-positive-proof',
      taskId: 'task-summary-positive-proof',
      instruction: '用一句话说明当前 AICSS 页面展示的内容。不要点击或修改页面。',
      chatSessionId: 'chat-summary-positive-proof',
      instructionMessageId: 'message-summary-positive-proof',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-summary-positive-proof');
    const quote = 'A completed five-item To-do List appears next to its React example code';
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'page-summary-positive',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.test',
        normalizedUrl: 'https://example.test/watch',
        digest: 'digest-summary-positive',
        textDigests: [await sha256(quote)],
        pageRevision: 'summary-positive-revision',
        observedAt: 100,
      },
      inForm: false,
    });
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: 'To-dos 5/5', required: true }]);
    pageTextPresent = true;
    finish({
      kind: 'candidate_complete',
      summary: `The AICSS page shows: “${quote}”.`,
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-summary-positive-proof')).toMatchObject({
        status: 'completed',
        rounds: [{ status: 'completed' }],
      });
    });
    expect((await manager.snapshot('task-summary-positive-proof'))?.rounds[0]?.receipt).toBeDefined();
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
        rounds: [{ status: 'failed', failureCategory: 'no_completion_criteria' }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect((await manager.snapshot('task-summary-proof-regression'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('fails a page-mismatched theme citation instead of waiting_user', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const pageQuote = '用于结构化长程推理的自组织记忆操作系统';
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({
        kind: 'candidate_complete',
        summary: '好的，我来读取当前页面并提取主题与正文引用。',
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
      commandId: 'start-theme-mismatch',
      taskId: 'task-theme-mismatch',
      instruction: '读当前页，一句主题，引用一处正文',
      chatSessionId: 'chat-theme-mismatch',
      instructionMessageId: 'message-theme-mismatch',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-theme-mismatch');
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'page-theme-mismatch',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.test',
        normalizedUrl: 'https://example.test/theme',
        digest: 'digest-theme-mismatch',
        textDigests: [await sha256(pageQuote)],
        pageRevision: 'theme-mismatch-revision',
        observedAt: 100,
      },
      inForm: false,
    });
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: pageQuote, required: true }]);
    finish({
      kind: 'candidate_complete',
      summary: '好的，我来读取当前页面并提取主题与正文引用。',
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-theme-mismatch')).toMatchObject({
        status: 'failed',
        rounds: [{ status: 'failed' }],
      });
    });
    const snap = await manager.snapshot('task-theme-mismatch');
    expect(snap?.status).toBe('failed');
    expect(snap?.rounds[0]?.waitReason).toBeUndefined();
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('Do not acknowledge'));
  });

  it('fails an acknowledgement even when page_text is only optional', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    let hooks!: ExecutorHooks;
    const pageQuote = '用于结构化长程推理的自组织记忆操作系统';
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({
        kind: 'candidate_complete',
        summary: '好的，我来读取当前页面并提取主题与正文引用。',
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
      commandId: 'start-optional-mismatch',
      taskId: 'task-optional-mismatch',
      instruction: '读当前页，一句主题，引用一处正文',
      chatSessionId: 'chat-optional-mismatch',
      instructionMessageId: 'message-optional-mismatch',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-optional-mismatch');
    store.observeActionTarget.mockResolvedValue({
      target: {
        id: 'page-optional-mismatch',
        kind: 'page',
        tabId: 7,
        frameId: 0,
        urlOrigin: 'https://example.test',
        normalizedUrl: 'https://example.test/optional',
        digest: 'digest-optional-mismatch',
        textDigests: [await sha256(pageQuote)],
        pageRevision: 'optional-mismatch-revision',
        observedAt: 100,
      },
      inForm: false,
    });
    await hooks.onPlan(roundId, [{ kind: 'page_text', operator: 'present', expected: pageQuote, required: false }]);
    finish({
      kind: 'candidate_complete',
      summary: '好的，我来读取当前页面并提取主题与正文引用。',
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-optional-mismatch')).toMatchObject({
        status: 'failed',
        rounds: [{ status: 'failed' }],
      });
    });
    expect((await manager.snapshot('task-optional-mismatch'))?.rounds[0]?.waitReason).toBeUndefined();
    expect(driver.run).toHaveBeenCalledTimes(2);
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
        rounds: [
          {
            receipt: { taskId: 'task-post-commit' },
            attempts: expect.arrayContaining([
              expect.objectContaining({ actionName: 'click_element', state: 'observed' }),
            ]),
          },
        ],
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
        rounds: [
          {
            waitReason: 'commit_outcome_uncertain',
            attempts: expect.arrayContaining([expect.objectContaining({ state: 'uncertain' })]),
          },
        ],
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
        rounds: [
          {
            waitReason: 'commit_outcome_uncertain',
            attempts: expect.arrayContaining([expect.objectContaining({ state: 'uncertain' })]),
          },
        ],
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

  it('persists setup_failed when createExecutor throws the localized API key message', async () => {
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => {
        throw new Error('请先在设置页面中完成 API 密钥的设置。');
      }),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'start-setup-fail',
      taskId: 'task-setup-fail',
      instruction: 'open youtube',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(async () => {
      const snap = await manager.snapshot('task-setup-fail');
      expect(snap?.status).toBe('failed');
      expect(snap?.rounds[0]?.failureCategory).toBe('setup_failed');
    });
  });

  it('opens a blank task tab when start has no content tab and the user asked to search', async () => {
    const switchTab = vi.fn();
    const openBlankTaskTab = vi.fn(async () => 42);
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => fakeDriver()),
      switchTab,
      openBlankTaskTab,
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    const ack = await manager.dispatch({
      type: 'start',
      commandId: 'start-search-blank',
      taskId: 'task-search-blank',
      instruction: '搜一下北京天气',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: -1,
    });
    expect(ack.accepted).toBe(true);
    expect(openBlankTaskTab).toHaveBeenCalledTimes(1);
    expect(switchTab).toHaveBeenCalledWith(42);
    expect(store.sessions.get('task-search-blank')).toMatchObject({ activeTabId: 42 });
  });

  it('refuses 这个页面 when there is no usable content tab', async () => {
    const openBlankTaskTab = vi.fn(async () => 42);
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => fakeDriver()),
      switchTab: vi.fn(),
      openBlankTaskTab,
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });
    const ack = await manager.dispatch({
      type: 'start',
      commandId: 'start-this-page',
      taskId: 'task-this-page',
      instruction: '这个页面讲什么',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: -1,
    });
    expect(ack).toMatchObject({
      accepted: false,
      error: 'invalid_input',
    });
    expect(ack.accepted === false && ack.userVisibleText).toContain('这个页面');
    expect(openBlankTaskTab).not.toHaveBeenCalled();
    expect(store.sessions.get('task-this-page')).toBeUndefined();
  });
});

describe('TaskManager independent URL opens', () => {
  const dualTitleInstruction =
    '打开 https://www.iana.org 和 https://en.wikipedia.org/wiki/Web_browser，写出两个页面的标题';

  beforeEach(() => {
    store.sessions.clear();
    store.chatSessions.clear();
    store.evidenceSpaces.clear();
    store.saveTask.mockClear();
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async (id: number) => {
          if (id === 7) return { id: 7, url: 'chrome-extension://test/side-panel/index.html', title: '持节' };
          if (id === 21) {
            return { id: 21, url: 'https://www.iana.org/', title: 'Internet Assigned Numbers Authority' };
          }
          if (id === 22) {
            return { id: 22, url: 'https://en.wikipedia.org/wiki/Web_browser', title: 'Web browser' };
          }
          if (id === 23) return { id: 23, url: 'https://missing.test/gone', title: '404 Not Found' };
          throw new Error('missing tab');
        }),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes two page records before the first decide', async () => {
    const openIndependentTabs = vi.fn(async (urls: string[]) => [
      {
        tabId: 21,
        requestedUrl: urls[0]!,
        pageUrl: 'https://www.iana.org/',
        title: 'Internet Assigned Numbers Authority',
      },
      {
        tabId: 22,
        requestedUrl: urls[1]!,
        pageUrl: 'https://en.wikipedia.org/wiki/Web_browser',
        title: 'Web browser',
      },
    ]);
    let manager!: TaskManager;
    const driver = fakeDriver();
    const run = vi.fn(async (): Promise<ExecutorOutcome> => {
      const snap = await manager.snapshot('task-parallel-urls');
      const pages = (snap?.targetRefs ?? []).filter(ref => ref.kind === 'page');
      expect(pages.find(ref => ref.normalizedUrl === 'https://www.iana.org')?.title).toBe(
        'Internet Assigned Numbers Authority',
      );
      expect(pages.find(ref => ref.normalizedUrl === 'https://en.wikipedia.org/wiki/Web_browser')?.title).toBe(
        'Web browser',
      );
      return { kind: 'paused' };
    });
    driver.run = run;
    manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      openIndependentTabs,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'cmd-parallel',
      taskId: 'task-parallel-urls',
      instruction: dualTitleInstruction,
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(openIndependentTabs).toHaveBeenCalledWith([
      'https://www.iana.org',
      'https://en.wikipedia.org/wiki/Web_browser',
    ]);
    expect(openIndependentTabs.mock.invocationCallOrder[0]).toBeLessThan(run.mock.invocationCallOrder[0]);
    const snap = await manager.snapshot('task-parallel-urls');
    expect(
      snap?.rounds[0]?.attempts.some(
        attempt => attempt.actionName === 'open_tab' && attempt.targetUrl === 'https://www.iana.org',
      ),
    ).toBe(true);
  });

  it('does not open ordered first-then-next URLs together', async () => {
    const openIndependentTabs = vi.fn(async () => []);
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      openIndependentTabs,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'cmd-ordered',
      taskId: 'task-ordered-urls',
      instruction: '先打开 https://one.test/a 再打开 https://two.test/b',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    expect(openIndependentTabs).not.toHaveBeenCalled();
  });

  it('does not open a YouTube first-video sentence in parallel', async () => {
    const openIndependentTabs = vi.fn(async () => []);
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      openIndependentTabs,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'cmd-yt',
      taskId: 'task-youtube-skill',
      instruction: '打开 YouTube 并点击第一个视频',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    expect(openIndependentTabs).not.toHaveBeenCalled();
  });

  it('records the good page when the other tab is a 404 and keeps the task running', async () => {
    const openIndependentTabs = vi.fn(async () => [
      {
        tabId: 21,
        requestedUrl: 'https://www.iana.org',
        pageUrl: 'https://www.iana.org/',
        title: 'Internet Assigned Numbers Authority',
      },
      {
        tabId: 23,
        requestedUrl: 'https://missing.test/gone',
        pageUrl: 'https://missing.test/gone',
        title: '404 Not Found',
      },
    ]);
    const driver = fakeDriver();
    const manager = new TaskManager({
      createExecutor: async () => driver,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      openIndependentTabs,
      ...noPostCommitBackoff,
    });
    await manager.dispatch({
      type: 'start',
      commandId: 'cmd-404',
      taskId: 'task-one-404',
      instruction: '打开 https://www.iana.org 和 https://missing.test/gone，写出两个页面的标题',
      chatSessionId: 'chat-1',
      instructionMessageId: 'message-1',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    const snap = await manager.snapshot('task-one-404');
    const pages = (snap?.targetRefs ?? []).filter(ref => ref.kind === 'page');
    expect(
      pages.some(
        ref => ref.normalizedUrl === 'https://www.iana.org' && ref.title === 'Internet Assigned Numbers Authority',
      ),
    ).toBe(true);
    expect(pages.some(ref => ref.normalizedUrl === 'https://missing.test/gone')).toBe(false);
    expect(snap?.status).toBe('running');
  });
});
