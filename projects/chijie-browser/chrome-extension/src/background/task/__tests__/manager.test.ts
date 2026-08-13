import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkOrderedSourceVisitProof,
  checkInstructionDeliverable,
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

  it('derives explicit item, URL, language, and body-content requirements', () => {
    expect(deriveInstructionDeliverableContract(longInstruction)).toMatchObject({
      required: true,
      requiresPageContent: true,
      requiresChinese: true,
      minimumItems: 2,
      minimumItemsWithUrl: 2,
      minimumDistinctUrls: 2,
      eachItemNeedsUrl: true,
    });
  });

  it.each([
    ['列出三个竞品并给出结论', { minimumItems: 3, requiresConclusion: true }],
    ['输出一个竞品对比表格并写结论', { requiresStructuredTable: true, requiresConclusion: true }],
    ['调研两个来源后写结论', { required: true, minimumItems: 2, minimumSourceCount: 2 }],
    ['合并两个来源做表格', { required: true, requiresStructuredTable: true, minimumSourceCount: 2 }],
  ])('derives object, source, table, and conclusion output requirements: %s', (instruction, expected) => {
    expect(deriveInstructionDeliverableContract(instruction)).toMatchObject(expected);
  });

  it.each([
    ['不要导出商品CSV表格', { requiresStructuredTable: false }],
    ['返回页面标题，但不要输出表格', { required: true, requiresStructuredTable: false }],
    ['返回页面标题，但不要给出结论', { required: true, requiresConclusion: false }],
    ['不要修改页面并输出表格', { required: true, requiresStructuredTable: true }],
    ['Do not modify the page and provide a conclusion', { required: true, requiresConclusion: true }],
  ])('derives output shape only from affirmed helper predicates: %s', (instruction, expected) => {
    expect(deriveInstructionDeliverableContract(instruction)).toMatchObject(expected);
  });

  it.each([
    ['返回上一页', false],
    ['返回首页', false],
    ['返回列表', false],
    ['返回商品页', false],
    ['Return to the previous page', false],
    ['Return to the product page', false],
    ['不要输出表格但请输出表格', true],
    ['请输出表格但不要输出表格', false],
  ])('uses the resolved final predicate for returned output: %s', (instruction, expected) => {
    expect(instructionRequestsReturnedDeliverable(instruction)).toBe(expected);
  });

  it('uses affirmed product count instead of a negated complete-set phrase', () => {
    expect(deriveInstructionDeliverableContract('不要全部商品，只前5并CSV')).toMatchObject({
      required: true,
      requiresStructuredTable: true,
      minimumItems: 5,
    });
    expect(deriveInstructionDeliverableContract('Do not export all products; export the first 5 as CSV')).toMatchObject(
      {
        required: true,
        requiresStructuredTable: true,
        minimumItems: 5,
      },
    );
  });

  it('rejects completion boilerplate for a requested three-competitor table and conclusion', async () => {
    const instruction = '调研三家竞品；输出表格；写出结论。';
    expect(
      await checkInstructionDeliverable(instruction, '这是最终结果：相关工作已经全部完成，请查看以上信息。'),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['table_structure', 'item_count', 'conclusion_missing']),
    });
  });

  it('requires distinct visited sources for source-count deliverables', async () => {
    const instruction = '合并两个来源做表格';
    const firstFact = '第一来源的可见事实';
    const secondFact = '第二来源的可见事实';
    const answer = ['来源,结果', `来源一,"${firstFact}"`, `来源二,"${secondFact}"`].join('\n');
    const oneSource = [
      { normalizedUrl: 'https://a.test/report', pageRevision: 'a1', textDigests: [], visitSeq: 1 },
      { normalizedUrl: 'https://a.test/report', pageRevision: 'a2', textDigests: [], visitSeq: 2 },
    ];
    expect(await checkInstructionDeliverable(instruction, answer, oneSource)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_count']),
    });
    await expect(
      checkInstructionDeliverable(instruction, answer, [
        {
          normalizedUrl: 'https://a.test/report',
          pageRevision: 'a1',
          textDigests: await Promise.all(['来源一', firstFact].map(sha256)),
          visitSeq: 1,
        },
        {
          normalizedUrl: 'https://b.test/report',
          pageRevision: 'b1',
          textDigests: await Promise.all(['来源二', secondFact].map(sha256)),
          visitSeq: 2,
        },
      ]),
    ).resolves.toEqual({ passed: true, reasons: [] });
  });

  it('separates returned deliverables from page-state verification for long-horizon tasks', () => {
    expect(
      instructionRequestsReturnedDeliverable(
        '进入英文维基；搜索并打开 Artificial intelligence 条目；确认 URL 在 wiki/Artificial_intelligence 后再完成。',
      ),
    ).toBe(false);
    expect(
      instructionRequestsReturnedDeliverable(
        '离开 example.com；打开 https://en.wikipedia.org/wiki/Web_browser；确认页面正文含 web browser 后再完成。',
      ),
    ).toBe(false);
    expect(
      instructionRequestsReturnedDeliverable(
        '读取 Wikipedia 标题和首段定义。最终交付包含两个完整 URL，以及“观察一：”和“观察二：”开头的两条中文观察。',
      ),
    ).toBe(true);
    expect(
      instructionRequestsReturnedDeliverable(
        '阅读当前产品列表页；提取所有行为 name,price,rating CSV；在回复中写出最贵商品的名称与价格。',
      ),
    ).toBe(true);
    expect(instructionRequestsReturnedDeliverable('用一句话说明当前页标题和网站域名')).toBe(true);
    expect(instructionRequestsReturnedDeliverable('如果页面给出错误提示就停止')).toBe(false);
    expect(instructionRequestsReturnedDeliverable('页面返回404时停止')).toBe(false);
    expect(instructionRequestsReturnedDeliverable('请给出当前页标题')).toBe(true);
    expect(instructionRequestsReturnedDeliverable('返回结果给我')).toBe(true);
  });

  it.each([
    ['不要复制页面内容，只打开 https://example.com 后完成', false],
    ['Do not answer with page content; just open https://example.com and finish', false],
    ['请说明当前页面的标题', true],
    ['State the current page title', true],
    ['页面返回404', false],
    ['页面给出错误', false],
    ['不要猜；请写出结果', true],
    ['把404内容返回给我', true],
    ['确认接口返回结果后完成', false],
    ['接口返回404后完成', false],
    ['不要猜测而要输出最终结果', true],
    ['不要总结但要列出两点', true],
    ['Do not explain but return the final result', true],
    ['别忘了返回最终结果', true],
    ["Don't forget to return the final result", true],
    ['请勿省略最终答案', true],
    ['请勿省略验证步骤', false],
    ["Don't forget that the API returns 404", false],
    ['不要返回最终结果', false],
    ['Do not return the final result', false],
    ['不要输出任何内容', false],
    ['不要不输出最终结果', true],
    ['不可不返回最终结果', true],
    ['不得不提供最终结果', true],
    ['Do not fail to return the final result', true],
    ['Never fail to provide the final result', true],
    ['绝不能漏掉最终结果', true],
    ['不要输出任何内容，等接口返回结果后完成', false],
    ['等接口返回结果后完成', false],
    ['待 API 给出结果后完成', false],
    ['确认服务报告结果后完成', false],
    ['等系统返回结果后完成', false],
    ['待页面给出结果后完成', false],
    ['确认网站报告结果后完成', false],
    ['Once the page returns the result, finish', false],
    ['Wait for the API to return the result, then finish', false],
    ['把接口返回内容告诉我', true],
    ['把接口返回内容返回给我', true],
    ['等接口返回内容后，把它告诉我', true],
  ])('detects clause-aware returned deliverable intent: %s', (instruction, expected) => {
    expect(instructionRequestsReturnedDeliverable(instruction)).toBe(expected);
  });

  it.each([
    ['先访问 https://a.test，再访问 https://b.test', true],
    ['访问 https://a.test，然后访问 https://b.test', true],
    ['访问 https://a.test，随后访问 https://b.test', true],
    ['访问 https://a.test，接下来访问 https://b.test', true],
    ['访问 https://a.test，之后访问 https://b.test', true],
    ['先访问 https://a.test，最后访问 https://b.test', true],
    ['Visit https://a.test; after that visit https://b.test', true],
    ['Visit https://a.test before https://b.test', true],
    ['Visit https://a.test; later visit https://b.test', true],
    ['Visit https://a.test; next visit https://b.test', true],
    ['无需依次访问 https://a.test 和 https://b.test', false],
    ['不要按顺序访问 https://a.test 和 https://b.test', false],
    ['Do not visit https://a.test then https://b.test', false],
    ['Never open https://a.test before https://b.test', false],
    ['不要随意打开页面，但按顺序访问 https://a.test 和 https://b.test', true],
    ['Do not open random pages, but visit https://a.test then https://b.test', true],
    ['1. Visit https://a.test; 2. Visit https://b.test', true],
    ['比较 https://a.test 与 https://b.test', false],
  ])('recognizes explicit URL ordering connectors without inventing order: %s', (instruction, expected) => {
    expect(deriveInstructionUrlPlan(instruction).requiresOrderedSourceProof).toBe(expected);
  });

  it('keeps A→B→A as three ordered occurrences and requires the final return to A', async () => {
    const instruction = '先打开 https://a.test，然后打开 https://b.test，最后回到 https://a.test。';
    expect(deriveInstructionUrlPlan(instruction)).toEqual({
      sourceUrls: ['https://a.test', 'https://b.test', 'https://a.test'],
      currentPageUrls: ['https://a.test'],
      requiresOrderedSourceProof: true,
    });
    await expect(
      checkOrderedSourceVisitProof(instruction, [
        { normalizedUrl: 'https://a.test', visitSeq: 1 },
        { normalizedUrl: 'https://b.test', visitSeq: 2 },
      ]),
    ).resolves.toBe(false);
    await expect(
      checkOrderedSourceVisitProof(instruction, [
        { normalizedUrl: 'https://a.test', visitSeq: 1 },
        { normalizedUrl: 'https://b.test', visitSeq: 2 },
        { normalizedUrl: 'https://a.test', visitSeq: 3 },
      ]),
    ).resolves.toBe(true);
    expect(deriveInstructionDeliverableContract(instruction).minimumDistinctUrls).toBe(2);
  });

  it('checks per-item URLs separately from distinct full-URL provenance', async () => {
    const duplicateUrlAnswer = [
      `1. IANA 页面写道“${ianaQuote}”：https://www.iana.org/help/example-domains`,
      `2. 浏览器页面写道“${wikipediaQuote}”：https://www.iana.org/help/example-domains`,
    ].join('\n');
    expect(await checkInstructionDeliverable(longInstruction, duplicateUrlAnswer, await pageEvidence())).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['distinct_url_count']),
    });

    const exactAnswer = [
      `1. IANA 页面写道“${ianaQuote}”：https://www.iana.org/help/example-domains`,
      `2. Wikipedia 页面写道“${wikipediaQuote}”：https://en.wikipedia.org/wiki/Web_browser#lead`,
    ].join('\n');
    expect(await checkInstructionDeliverable(longInstruction, exactAnswer, await pageEvidence())).toEqual({
      passed: true,
      reasons: [],
    });
    expect(
      await checkInstructionDeliverable(longInstruction, exactAnswer, [
        'https://www.iana.org/',
        'https://en.wikipedia.org/wiki/Artificial_intelligence',
      ]),
    ).toMatchObject({ passed: false, reasons: expect.arrayContaining(['url_not_visited']) });
    expect(normalizeProvenanceUrl('https://www.iana.org/help/example-domains?secret=1#x')).toBe(
      'https://www.iana.org/help/example-domains',
    );
  });

  it('derives table schema only from fields explicit in the instruction', () => {
    expect(extractExplicitTableFields('Extract products to a CSV table with name, price, rating')).toEqual([
      'name',
      'price',
      'rating',
    ]);
    expect(extractExplicitTableFields('Extract products to a CSV table')).toEqual([]);
    expect(
      extractExplicitTableFields(
        '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取所有行为 name,price,rating CSV；3) 根据页面数据在回复中写出最贵商品的名称与价格。',
      ),
    ).toEqual(['name', 'price', 'rating']);
    expect(extractExplicitTableFields('把结果导出为表格，表格列为名称、价格、评分。')).toEqual([
      '名称',
      '价格',
      '评分',
    ]);
  });

  it('rejects final-page status and accepts a complete two-source deliverable', async () => {
    expect(
      await checkInstructionDeliverable(
        longInstruction,
        '页面地址已符合目标：https://en.wikipedia.org/wiki/Web_browser',
      ),
    ).toMatchObject({ passed: false });

    expect(
      await checkInstructionDeliverable(
        longInstruction,
        [
          `1. IANA 页面写道“Example Domains”、“${ianaQuote}”：https://www.iana.org/help/example-domains`,
          `2. Web browser 条目写道“Web browser”、“${wikipediaQuote}”：https://en.wikipedia.org/wiki/Web_browser`,
        ].join('\n'),
        await pageEvidence(),
      ),
    ).toEqual({ passed: true, reasons: [] });
  });

  it('requires a unique, complete row set and the exact row-derived highest-price conclusion for LH-03', async () => {
    const instruction =
      '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取所有行为 name,price,rating CSV；3) 根据页面数据在回复中写出最贵商品的名称与价格。';
    const rows = [
      { name: 'Alpha', price: '¥10', rating: '4.1' },
      { name: 'Beta', price: '¥25', rating: '4.5' },
      { name: 'Gamma', price: '¥15', rating: '4.3' },
    ];
    const evidence: DeliverablePageEvidence[] = [
      {
        normalizedUrl: 'https://shop.test/list',
        textDigests: await productTableEvidenceDigests(rows),
        pageRevision: 'products-revision',
        visitSeq: 1,
      },
    ];
    const table = ['已提取 3 件商品（CSV）：', 'name,price,rating', 'Alpha,¥10,4.1', 'Beta,¥25,4.5', 'Gamma,¥15,4.3'];

    expect(deriveInstructionDeliverableContract(instruction).requiresPageContent).toBe(true);

    expect(
      await checkInstructionDeliverable(instruction, [...table, '最贵商品是 Beta，价格为 ¥25。'].join('\n'), evidence),
    ).toEqual({
      passed: true,
      reasons: [],
    });

    expect(
      await checkInstructionDeliverable(instruction, [...table, '最贵商品是 Beta，价格为 ¥25。'].join('\n'), [
        ...evidence,
        { normalizedUrl: 'https://shop.test/list', pageRevision: 'later-empty-capture' },
      ]),
    ).toEqual({
      passed: true,
      reasons: [],
    });

    const duplicateAndOmit = [
      '已提取 3 件商品（CSV）：',
      'name,price,rating',
      'Alpha,¥10,4.1',
      'Beta,¥25,4.5',
      'Beta,¥25,4.5',
      '最贵商品是 Beta，价格为 ¥25。',
    ].join('\n');
    expect(await checkInstructionDeliverable(instruction, duplicateAndOmit, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['table_row_duplicate', 'page_content_incomplete']),
    });

    const duplicateOnly = [
      ...table.slice(0, 2),
      'Alpha,¥10,4.1',
      'Beta,¥25,4.5',
      'Beta,¥25,4.5',
      'Gamma,¥15,4.3',
      '最贵商品是 Beta，价格为 ¥25。',
    ].join('\n');
    expect(await checkInstructionDeliverable(instruction, duplicateOnly, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['table_row_duplicate']),
    });

    const extraFake = [...table, 'Delta,¥30,5.0', '最贵商品是 Delta，价格为 ¥30。'].join('\n');
    expect(await checkInstructionDeliverable(instruction, extraFake, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded', 'page_content_incomplete']),
    });

    expect(
      await checkInstructionDeliverable(instruction, [...table, '最贵商品是 Alpha，价格为 ¥10。'].join('\n'), evidence),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_unsupported']),
    });

    const recombinedRows = [
      '已提取 2 件商品（CSV）：',
      'name,price,rating',
      'Alpha,¥25,4.1',
      'Beta,¥10,4.5',
      '最贵商品是 Alpha，价格为 ¥25。',
    ].join('\n');
    expect(await checkInstructionDeliverable(instruction, recombinedRows, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });
  });

  it('rejects title/domain metadata and fabricated body text when page content was requested', async () => {
    const instruction = '阅读当前飞书页面，用一句中文概括核心主题，并引用一个正文中可见的细节；不要修改页面。';
    const actualQuote = '上下文工程会直接影响语言模型的表现';
    const evidence: DeliverablePageEvidence[] = [
      {
        normalizedUrl: 'https://my.feishu.cn/docx/CaseSensitivePath',
        textDigests: [await sha256(actualQuote)],
        pageRevision: 'feishu-revision',
        visitSeq: 1,
      },
    ];
    expect(
      await checkInstructionDeliverable(
        instruction,
        '标题：上下文工程（中文版） - Feishu Docs；域名：my.feishu.cn',
        evidence,
      ),
    ).toMatchObject({ passed: false, reasons: expect.arrayContaining(['page_content']) });
    expect(
      await checkInstructionDeliverable(
        instruction,
        '文章核心是火星永久居民的登记制度，正文细节写道“火星居民都拥有三个月亮”。',
        evidence,
      ),
    ).toMatchObject({ passed: false, reasons: expect.arrayContaining(['page_content_ungrounded']) });
    expect(
      await checkInstructionDeliverable(instruction, `文章核心与正文细节是：“${actualQuote}”。`, evidence),
    ).toEqual({ passed: true, reasons: [] });
  });

  it.each([
    ['launch date', 'At https://example.test/report, tell me the launch date.', 'The launch date is 2099-01-01.'],
    ['price', 'From https://example.test/report, tell me the price.', 'The price is $999.'],
    ['publication date', 'What publication date is shown on https://example.test/report?', 'It was published in 2099.'],
    ['author', 'Who is the author at https://example.test/report?', 'The author is Ada Example.'],
    ['current-page date', '这个页面的发布日期是什么？', '发布日期是 2099-01-01。'],
    ['linked author', '从链接 https://example.test/report 查作者。', '作者是 Ada Example。'],
    ['amount', 'Report the amount at https://example.test/report.', 'The amount is $999.'],
    [
      'page claim',
      'Does https://example.test/report claim that the launch succeeded?',
      'Yes, the page claims the launch succeeded.',
    ],
  ])('requires live page text for a URL-sourced %s fact', async (_label, instruction, claim) => {
    const url = 'https://example.test/report';
    expect(deriveInstructionDeliverableContract(instruction)).toMatchObject({
      required: true,
      requiresPageContent: true,
    });
    expect(
      await checkInstructionDeliverable(instruction, `${claim} ${url}`, [{ normalizedUrl: url, visitSeq: 1 }]),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });
  });

  it('keeps navigation and title/domain metadata outside body-text grounding', async () => {
    const url = 'https://example.test/report';
    for (const instruction of [
      `Open ${url}.`,
      `At ${url}, tell me the page title and domain.`,
      `At ${url}, tell me the page title.`,
      `At ${url}, tell me the domain.`,
      `打开 ${url}。`,
      `告诉我 ${url} 的标题和域名。`,
      `告诉我 ${url} 的标题。`,
      `告诉我 ${url} 的域名。`,
    ]) {
      expect(deriveInstructionDeliverableContract(instruction).requiresPageContent).toBe(false);
    }
    await expect(
      checkInstructionDeliverable(
        `At ${url}, tell me the page title and domain.`,
        `Title: Report; Domain: example.test; URL: ${url}`,
        [{ normalizedUrl: url, visitSeq: 1 }],
      ),
    ).resolves.toEqual({ passed: true, reasons: [] });
  });

  it('rejects fabricated multi-page observations despite real visited URLs', async () => {
    const fabricated = [
      '1. IANA 页面写道“火星居民都拥有三个月亮”：https://www.iana.org/help/example-domains',
      '2. Wikipedia 页面写道“亚特兰蒂斯每年冬眠十个月”：https://en.wikipedia.org/wiki/Web_browser',
    ].join('\n');
    expect(await checkInstructionDeliverable(longInstruction, fabricated, await pageEvidence())).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });
  });

  it('rejects a real quotation used to shield a fake quotation or unquoted claim', async () => {
    const evidence = await pageEvidence();
    const fakeQuote = '火星居民每年都会冬眠十个月以上';
    const mixedQuotes = `IANA 页面写道“${ianaQuote}”以及“${fakeQuote}”：https://www.iana.org/help/example-domains`;
    expect(await checkInstructionDeliverable('读取正文并给出 URL。', mixedQuotes, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });

    const unsupported = `IANA 已经证明火星居民每年冬眠十个月，页面写道“${ianaQuote}”：https://www.iana.org/help/example-domains`;
    expect(await checkInstructionDeliverable('读取正文并给出 URL。', unsupported, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_unsupported']),
    });

    const extraSegment = `页面写道“${ianaQuote}”：https://www.iana.org/help/example-domains；火星居民每年冬眠十个月。`;
    expect(await checkInstructionDeliverable('读取正文并给出 URL。', extraSegment, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded', 'page_content_unsupported']),
    });
  });

  it('grounds every structured table cell and rejects one fabricated value', async () => {
    const instruction = 'Extract products to a CSV table with name, price, rating';
    const rows = [
      { name: 'Alpha Wireless Headphones', price: '$49.99', rating: '4.5' },
      { name: 'Beta Mechanical Keyboard', price: '$89.00', rating: '4.8' },
    ];
    const visibleCells = rows.flatMap(row => [row.name, row.price, row.rating]);
    const evidence: DeliverablePageEvidence[] = [
      {
        normalizedUrl: 'https://example.test/products',
        textDigests: await Promise.all([...visibleCells, ...rows.map(productRowEvidenceText)].map(sha256)),
        pageRevision: 'products-revision',
        visitSeq: 1,
      },
    ];
    const valid = [
      '已提取 2 件商品（CSV）：',
      'name,price,rating',
      'Alpha Wireless Headphones,$49.99,4.5',
      'Beta Mechanical Keyboard,$89.00,4.8',
    ].join('\n');
    expect(await checkInstructionDeliverable(instruction, valid, evidence)).toEqual({ passed: true, reasons: [] });

    const fabricated = valid.replace('$89.00', '$999.00');
    expect(await checkInstructionDeliverable(instruction, fabricated, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });

    const missingHeader = valid
      .split('\n')
      .filter(line => line !== 'name,price,rating')
      .join('\n');
    expect(await checkInstructionDeliverable(instruction, missingHeader, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_unsupported']),
    });
  });

  it('uses redacted query identity for distinct and per-segment provenance', async () => {
    const quoteOne = '第一份查询结果展示了一个可见正文事实';
    const quoteTwo = '第二份查询结果展示了另一个正文事实';
    const urlOne = 'https://example.test/report?id=1&view=full';
    const urlTwo = 'https://example.test/report?id=2&view=full';
    const instruction = `先读取 ${urlOne}，再读取 ${urlTwo}，最终输出两条中文观察，每条都带 URL。`;
    expect(deriveInstructionDeliverableContract(instruction).minimumDistinctUrls).toBe(2);
    const evidence = [
      {
        normalizedUrl: normalizeProvenanceUrl(urlOne)!,
        queryIdentityDigest: await queryIdentityDigestForUrl(urlOne),
        textDigests: [await sha256(quoteOne)],
        pageRevision: 'query-one',
        visitSeq: 1,
      },
      {
        normalizedUrl: normalizeProvenanceUrl(urlTwo)!,
        queryIdentityDigest: await queryIdentityDigestForUrl(urlTwo),
        textDigests: [await sha256(quoteTwo)],
        pageRevision: 'query-two',
        visitSeq: 2,
      },
    ];
    const valid = [`1. 页面写道“${quoteOne}”：${urlOne}`, `2. 页面写道“${quoteTwo}”：${urlTwo}`].join('\n');
    expect(await checkInstructionDeliverable(instruction, valid, evidence)).toEqual({ passed: true, reasons: [] });

    const wrongQuery = valid.replace(urlTwo, 'https://example.test/report?id=3&view=full');
    expect(await checkInstructionDeliverable(instruction, wrongQuery, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['url_not_visited', 'page_content_ungrounded']),
    });
    expect(JSON.stringify(evidence)).not.toContain('?id=');
  });

  it('redacts raw query values before a deliverable enters durable task state', async () => {
    const first = await redactDeliverableUrlsForPersistence('结果：https://example.test/report?id=1&token=TOPSECRET。');
    const second = await redactDeliverableUrlsForPersistence(
      '结果：https://example.test/report?id=2&token=TOPSECRET。',
    );
    expect(first).toContain('https://example.test/report?__chijie_query_identity=');
    expect(first).not.toContain('id=1');
    expect(first).not.toContain('TOPSECRET');
    expect(second).not.toBe(first);
  });

  it('rejects reversed source output and reversed visit order', async () => {
    const reversedOutput = [
      `1. Wikipedia 页面写道“${wikipediaQuote}”：https://en.wikipedia.org/wiki/Web_browser`,
      `2. IANA 页面写道“${ianaQuote}”：https://www.iana.org/help/example-domains`,
    ].join('\n');
    expect(await checkInstructionDeliverable(longInstruction, reversedOutput, await pageEvidence())).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_order_unverified']),
    });

    const requestedOutput = [
      `1. IANA 页面写道“${ianaQuote}”：https://www.iana.org/help/example-domains`,
      `2. Wikipedia 页面写道“${wikipediaQuote}”：https://en.wikipedia.org/wiki/Web_browser`,
    ].join('\n');
    expect(
      await checkInstructionDeliverable(longInstruction, requestedOutput, await pageEvidence('reversed')),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_order_unverified']),
    });
  });

  it('enforces the exact two-site delivery labels, source coverage, and visit order', async () => {
    const instruction =
      '这是一个双来源交付任务，请在当前任务绑定标签页中依次完成：1) 点击 More information 访问 IANA Example Domains；2) 记录 IANA 页面标题和完整 URL；3) 再打开 https://en.wikipedia.org/wiki/Web_browser；4) 读取 Wikipedia 标题和首段定义的第一句。最终交付必须只在完成两站后输出，包含两个完整 URL、IANA 标题 Example Domains、Wikipedia 标题 Web browser、Wikipedia 首段第一句英文原文，以及“观察一：”和“观察二：”开头的两条中文观察。任一项缺失都不得完成。';
    const ianaDetail = '这些域名供文档中的示例使用';
    const wikiDetail = 'A web browser is an application for accessing websites.';
    const evidenceFor = async (reversed = false) => {
      const values: DeliverablePageEvidence[] = [
        {
          normalizedUrl: 'https://www.iana.org/help/example-domains',
          textDigests: await Promise.all(['Example Domains', ianaDetail].map(sha256)),
          pageRevision: 'iana-lh04',
          label: 'Example Domains',
          visitSeq: reversed ? 2 : 1,
        },
        {
          normalizedUrl: 'https://en.wikipedia.org/wiki/Web_browser',
          textDigests: await Promise.all(['Web browser', wikiDetail].map(sha256)),
          pageRevision: 'wiki-lh04',
          label: 'Web browser',
          visitSeq: reversed ? 1 : 2,
        },
      ];
      return values;
    };
    const valid = [
      `观察一：IANA 页面写道“Example Domains”、“${ianaDetail}”：https://www.iana.org/help/example-domains`,
      `观察二：Wikipedia 页面写道“Web browser”、“${wikiDetail}”：https://en.wikipedia.org/wiki/Web_browser`,
    ].join('\n');
    expect(await checkInstructionDeliverable(instruction, valid, await evidenceFor())).toEqual({
      passed: true,
      reasons: [],
    });
    expect(await checkInstructionDeliverable(instruction, valid, await evidenceFor(true))).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_order_unverified']),
    });
    const completeEvidence = await evidenceFor();
    expect(await checkInstructionDeliverable(instruction, valid, completeEvidence.slice(1))).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_count', 'url_not_visited', 'source_content_coverage']),
    });
    expect(
      await checkInstructionDeliverable(instruction, valid, [
        completeEvidence[1],
        { ...completeEvidence[1], pageRevision: 'wiki-lh04-repeat', visitSeq: 3 },
      ]),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_count', 'url_not_visited', 'source_content_coverage']),
    });
    expect(
      await checkInstructionDeliverable(
        instruction,
        valid,
        completeEvidence.map(item => ({
          normalizedUrl: item.normalizedUrl,
          visitSeq: item.visitSeq,
          label: item.label,
        })),
      ),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded', 'source_content_coverage']),
    });
    expect(
      await checkInstructionDeliverable(instruction, valid.replace(/观察一：|观察二：/g, ''), await evidenceFor()),
    ).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['item_label']),
    });
    const bothFromWiki = [
      '观察一：IANA 标题“Example Domains”：https://www.iana.org/help/example-domains',
      `观察二：Wikipedia 写道“${wikiDetail}”：https://en.wikipedia.org/wiki/Web_browser`,
      `观察三：Wikipedia 仍写道“${wikiDetail}”：https://en.wikipedia.org/wiki/Web_browser`,
    ].join('\n');
    expect(await checkInstructionDeliverable(instruction, bothFromWiki, await evidenceFor())).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['source_content_coverage']),
    });
  });

  it('keeps URL path casing exact in provenance checks', async () => {
    const instruction = '阅读页面正文并给出 URL。';
    const quote = '大小写路径属于不同的页面资源';
    expect(
      await checkInstructionDeliverable(instruction, `正文写道“${quote}”：https://example.test/casepath`, [
        {
          normalizedUrl: 'https://example.test/CasePath',
          textDigests: [await sha256(quote)],
          pageRevision: 'case-revision',
          visitSeq: 1,
        },
      ]),
    ).toMatchObject({ passed: false, reasons: expect.arrayContaining(['url_not_visited']) });
  });

  it('grounds a current-page answer only in the latest page observation', async () => {
    const instruction = '阅读当前页面并概括正文中的一个细节。';
    const staleQuote = '旧页面曾经展示过这一段可见正文';
    const currentQuote = '当前页面展示的是另一段可见正文';
    const evidence = [
      {
        normalizedUrl: 'https://example.test/old',
        textDigests: [await sha256(staleQuote)],
        pageRevision: 'old-revision',
        visitSeq: 1,
      },
      {
        normalizedUrl: 'https://example.test/current',
        textDigests: [await sha256(currentQuote)],
        pageRevision: 'current-revision',
        visitSeq: 2,
      },
    ];
    expect(await checkInstructionDeliverable(instruction, `正文细节是：“${staleQuote}”。`, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });
    expect(await checkInstructionDeliverable(instruction, `正文细节是：“${currentQuote}”。`, evidence)).toEqual({
      passed: true,
      reasons: [],
    });
  });

  it('uses only the latest revision for the same URL identity, including a failed-capture tombstone', async () => {
    const instruction = '阅读 https://example.test/report?id=1 的正文并给出 URL。';
    const url = 'https://example.test/report?id=1';
    const queryIdentityDigest = await queryIdentityDigestForUrl(url);
    const oldQuote = '旧版页面曾经展示的正文句子已经过期';
    const newQuote = '新版页面现在展示的正文句子才有效';
    const evidence: DeliverablePageEvidence[] = [
      {
        normalizedUrl: normalizeProvenanceUrl(url)!,
        queryIdentityDigest,
        textDigests: [await sha256(oldQuote)],
        pageRevision: 'revision-old',
        visitSeq: 1,
      },
      {
        normalizedUrl: normalizeProvenanceUrl(url)!,
        queryIdentityDigest,
        textDigests: [await sha256(newQuote)],
        pageRevision: 'revision-new',
        visitSeq: 2,
      },
    ];
    expect(await checkInstructionDeliverable(instruction, `页面写道“${oldQuote}”：${url}`, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
    });
    expect(await checkInstructionDeliverable(instruction, `页面写道“${newQuote}”：${url}`, evidence)).toEqual({
      passed: true,
      reasons: [],
    });

    evidence.push({
      normalizedUrl: normalizeProvenanceUrl(url)!,
      queryIdentityDigest,
      visitSeq: 3,
    });
    expect(await checkInstructionDeliverable(instruction, `页面写道“${newQuote}”：${url}`, evidence)).toMatchObject({
      passed: false,
      reasons: expect.arrayContaining(['page_content_ungrounded']),
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
    expect(snap?.plan?.phases).toHaveLength(3);
    expect(snap?.plan?.phases[0]).toMatchObject({ id: 'phase-1', title: '调研', status: 'active' });
    expect(snap?.plan?.phases[1]?.title).toBe('输出');
    expect(snap?.plan?.phases[2]?.title).toBe('总结');
    expect(snap?.plan?.goal).toBe('调研并总结');
    expect(snap?.goalSummary).toBe('调研并总结');
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

  it('does not mint a task receipt when structured research phases have no per-phase evidence', async () => {
    let finish!: (outcome: ExecutorOutcome) => void;
    const driver = fakeDriver();
    driver.run = vi.fn(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)));
    store.evidenceSpaces.set('task-research-delivered', {
      taskId: 'task-research-delivered',
      records: [
        ...Array.from({ length: 80 }, () => ({ recordType: 'user_discussion' })),
        ...Array.from({ length: 30 }, () => ({ recordType: 'product' })),
        { recordType: 'repository' },
      ],
      workCycles: 0,
      researchDecision: { capabilities: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] },
      researchDelivery: { research_table: {}, decision_document: {} },
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
      commandId: 'start-research-delivered',
      taskId: 'task-research-delivered',
      instruction:
        'Living Reader：至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最终恰好 3 个能力并完成飞书研究表与决策文档回读。',
      chatSessionId: 'chat-research-delivered',
      instructionMessageId: 'message-research-delivered',
      tabId: 7,
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(1));
    const storedTask = structuredClone(store.sessions.get('task-research-delivered')) as {
      rounds: Array<{ criteria: unknown[] }>;
    };
    storedTask.rounds[0].criteria = [
      {
        id: 'criterion-user-confirmed',
        kind: 'user_confirmed',
        description: 'User confirms delivery',
        required: true,
      },
    ];
    store.sessions.set('task-research-delivered', storedTask);

    finish({ kind: 'candidate_complete', summary: 'All durable research gates are verified.' });

    await vi.waitFor(async () => {
      const snapshot = await manager.snapshot('task-research-delivered');
      expect(snapshot?.status).toBe('failed');
      expect(snapshot?.rounds[0]?.status).toBe('failed');
      expect(snapshot?.rounds[0]?.failureCategory).toBe('mission_plan_unverified');
      expect(snapshot?.rounds[0]?.waitReason).toBeUndefined();
      expect(snapshot?.rounds[0]?.receipt).toBeUndefined();
      expect(snapshot?.rounds[0]?.criteria).toEqual([]);
    });
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

  it('bounds structured decision output retries after quotas are met without reopening research', async () => {
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockResolvedValueOnce({ kind: 'failed', category: 'no_action' })
      .mockResolvedValueOnce({ kind: 'failed', category: 'json_parse_failed' })
      .mockResolvedValueOnce({ kind: 'failed', category: 'action_failed' })
      .mockResolvedValueOnce({ kind: 'failed', category: 'no_action' });
    store.evidenceSpaces.set('task-research-decision-retry', {
      taskId: 'task-research-decision-retry',
      records: [
        ...Array.from({ length: 80 }, () => ({ recordType: 'user_discussion' })),
        ...Array.from({ length: 30 }, () => ({ recordType: 'product' })),
        { recordType: 'repository' },
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
      commandId: 'start-research-decision-retry',
      taskId: 'task-research-decision-retry',
      instruction: 'Living Reader：至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最终恰好 3 个能力并完成飞书回读。',
      chatSessionId: 'chat-research-decision-retry',
      instructionMessageId: 'message-research-decision-retry',
      tabId: 7,
    });

    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(4));
    expect(driver.addFollowUp).toHaveBeenCalledTimes(3);
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('failed with no_action'));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('failed with json_parse_failed'));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('failed with action_failed'));
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('use these exact keys'));
    expect(store.evidenceSpaces.get('task-research-decision-retry')?.workCycles).toBe(0);
    await vi.waitFor(async () =>
      expect((await manager.snapshot('task-research-decision-retry'))?.status).toBe('failed'),
    );
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
      expect.objectContaining({ title: '验证', status: 'active', criteriaIds: [criterionId] }),
      expect.objectContaining({ title: '输出', status: 'planned', criteriaIds: [] }),
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
    expect(snapshot?.plan?.phases.map(phase => phase.title)).toEqual(['验证', '输出']);
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
    finish({ kind: 'candidate_complete', summary: 'done' });

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
        title: '验证',
        status: 'active',
        criteriaIds: snapshot?.rounds[0]?.criteria.map(criterion => criterion.id),
      }),
    ]);

    const roundId = snapshot?.currentRoundId;
    expect(roundId).toBeTruthy();
    await expect(hooks.getMissionPlan?.(roundId!)).resolves.toEqual({
      id: snapshot?.plan?.id,
      goal: snapshot?.plan?.goal,
      phases: [{ id: snapshot?.plan?.phases[0]?.id, title: '验证', status: 'active' }],
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
        title: '验证',
        criteriaIds: snapshot?.rounds[0]?.criteria.map(criterion => criterion.id),
      }),
    ]);
  });

  it.each([
    [
      'LH-01',
      '进入英文维基；搜索并打开 Artificial intelligence 条目；确认 URL 在 wiki/Artificial_intelligence 后再完成。',
      ['验证'],
      ['url', 'page_text'],
    ],
    [
      'LH-04',
      '这是一个双来源交付任务：先访问 IANA Example Domains，再打开 https://en.wikipedia.org/wiki/Web_browser。最终交付包含两个完整 URL、两条中文观察、IANA 标题、Wikipedia 标题与首段定义。',
      ['验证', '输出'],
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
    expect(snap?.plan?.phases.map(p => p.status)).toEqual(['active', 'planned', 'planned']);

    await hooks.dispatchAction(roundId, new Action(async () => new ActionResult({ success: true }), waitActionSchema), {
      seconds: 1,
      intent: 'wait again',
    });
    snap = await manager.snapshot('task-plan-no-heuristic');
    expect(snap?.plan?.phases.map(p => p.status)).toEqual(['active', 'planned', 'planned']);
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
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    finish({ kind: 'candidate_complete', summary: 'done' });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-plan-done')).toMatchObject({
        status: 'failed',
        rounds: [{ failureCategory: 'no_action' }],
      });
    });
    const done = await manager.snapshot('task-plan-done');
    expect(done?.plan?.phases.map(p => p.status)).not.toEqual(['done', 'done', 'done']);
    expect(done?.rounds[0]?.receipt).toBeUndefined();
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

  it('rehydrates prior research quotas when the user resumes an interrupted correction round', async () => {
    const researchInstruction = '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。';
    const latestCorrection = '停止浏览，直接调用 record_research_decision 完成剩余调研决策。';
    store.sessions.set('task-resume-research-correction', {
      id: 'task-resume-research-correction',
      goalSummary: 'User task',
      chatSessionId: 'chat-resume-research-correction',
      instructionMessageId: 'message-latest-correction',
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
          instructionMessageId: 'message-latest-correction',
          instructionSummary: 'User instruction',
          status: 'interrupted',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
    });
    store.chatSessions.set('chat-resume-research-correction', {
      messages: [
        { id: 'message-original-research', actor: 'user', content: researchInstruction },
        { id: 'message-latest-correction', actor: 'user', content: latestCorrection },
      ],
    });
    let resumedInstruction = '';
    const createExecutor = vi.fn(async (input: ExecutorInput) => {
      resumedInstruction = input.instruction;
      return fakeDriver();
    });
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
      ...noPostCommitBackoff,
    });

    await manager.dispatch({
      type: 'resume',
      commandId: 'resume-research-correction',
      taskId: 'task-resume-research-correction',
      expectedRevision: 5,
    });

    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    expect(resumedInstruction).toContain(researchInstruction);
    expect(resumedInstruction).toContain(latestCorrection);
    await expect(manager.snapshot('task-resume-research-correction')).resolves.toMatchObject({
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

  it('explicitly retries an exhausted quota research task without replacing its evidence or mission plan', async () => {
    const instruction = '至少搜索并阅读 80 个用户讨论；至少研究 30 个产品；最后交付结论。';
    const plan = {
      id: 'plan-retry-research',
      goal: instruction,
      phases: [
        {
          id: 'phase-research',
          title: '调研',
          status: 'active' as const,
          criteriaIds: [],
          evidenceIds: [],
          notes: ['保留原计划'],
        },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    store.sessions.set('task-retry-research', {
      id: 'task-retry-research',
      goalSummary: 'User task',
      chatSessionId: 'chat-retry-research',
      instructionMessageId: 'message-latest-correction',
      status: 'failed',
      revision: 9,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      plan,
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionMessageId: 'message-latest-correction',
          instructionSummary: 'User instruction',
          status: 'failed',
          failureCategory: 'executor_start_failed',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
    });
    store.chatSessions.set('chat-retry-research', {
      messages: [
        { id: 'message-retry-research', actor: 'user', content: instruction },
        {
          id: 'message-latest-correction',
          actor: 'user',
          content: '停止浏览，直接完成剩余决策。',
        },
      ],
    });
    const evidenceRecords = [
      ...Array.from({ length: 76 }, () => ({ recordType: 'user_discussion' })),
      ...Array.from({ length: 30 }, () => ({ recordType: 'product' })),
    ];
    store.evidenceSpaces.set('task-retry-research', {
      taskId: 'task-retry-research',
      records: evidenceRecords,
      workCycles: 236,
    });
    const createExecutor = vi.fn(async () => fakeDriver());
    const switchTab = vi.fn();
    const manager = new TaskManager({
      createExecutor,
      switchTab,
      observeCriteria: vi.fn(async () => []),
      now: () => 500,
      ...noPostCommitBackoff,
    });

    await expect(
      manager.dispatch({
        type: 'retry_research',
        commandId: 'retry-research-1',
        taskId: 'task-retry-research',
        expectedRevision: 9,
        tabId: 11,
      }),
    ).resolves.toMatchObject({ accepted: true, revision: 10 });

    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    await expect(manager.snapshot('task-retry-research')).resolves.toMatchObject({
      status: 'running',
      activeTabId: 11,
      currentRoundId: 'round-1',
      plan,
      rounds: [{ id: 'round-1', status: 'running' }],
    });
    expect((await manager.snapshot('task-retry-research'))?.rounds[0]?.failureCategory).toBeUndefined();
    expect(store.evidenceSpaces.get('task-retry-research')).toMatchObject({
      workCycles: 0,
      records: evidenceRecords,
    });
    expect(switchTab).toHaveBeenCalledWith(11);
  });

  it('rejects explicit research retry for an ordinary failed task', async () => {
    store.sessions.set('task-not-research', {
      id: 'task-not-research',
      goalSummary: 'User task',
      status: 'failed',
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
          status: 'failed',
          failureCategory: 'setup_failed',
          commandAcks: {},
          criteria: [],
          attempts: [],
          evidence: [],
        },
      ],
    });
    const manager = new TaskManager({
      createExecutor: vi.fn(async () => fakeDriver()),
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 500,
      ...noPostCommitBackoff,
    });

    await expect(
      manager.dispatch({
        type: 'retry_research',
        commandId: 'retry-not-research',
        taskId: 'task-not-research',
        expectedRevision: 2,
      }),
    ).resolves.toMatchObject({ accepted: false, error: 'invalid_transition' });
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
      expected: 'https://www.youtube.com',
    });
  });

  it('does not mint a native receipt for a URL-sourced fact without page text evidence', async () => {
    const url = 'https://example.test/report';
    const instruction = `At ${url}, tell me the launch date.`;
    const driver = fakeDriver();
    driver.run = vi.fn().mockResolvedValue({
      kind: 'candidate_complete',
      summary: `The launch date is 2099-01-01. ${url}`,
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
        status: 'failed',
        rounds: [{ status: 'failed', failureCategory: 'no_action' }],
      });
    });
    const snapshot = await manager.snapshot('task-url-fact-no-text');
    expect(snapshot?.rounds[0]?.receipt).toBeUndefined();
    expect(snapshot?.rounds[0]?.evidence).toEqual(expect.arrayContaining([expect.objectContaining({ passed: true })]));
    expect(driver.run).toHaveBeenCalledTimes(2);
  });

  it('fails open-ended identity output without observable criteria', async () => {
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
        status: 'failed',
        rounds: [
          {
            status: 'failed',
            failureCategory: 'no_completion_criteria',
          },
        ],
      });
    });
    const snap = await manager.snapshot('task-open-ended');
    expect(snap?.rounds[0]?.waitReason).toBeUndefined();
    expect(snap?.rounds[0]?.receipt).toBeUndefined();
  });

  it('fails a requested page summary without browser criteria even when prose looks substantive', async () => {
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
        status: 'failed',
        rounds: [
          {
            status: 'failed',
            failureCategory: 'no_completion_criteria',
          },
        ],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('browser completion criterion'));
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
        rounds: [{ status: 'failed', failureCategory: 'no_completion_criteria' }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect((await manager.snapshot('task-summary-missing'))?.rounds[0]?.waitReason).toBeUndefined();
  });

  it('fails closed when a page-theme request receives only title/domain metadata', async () => {
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
        status: 'failed',
        plan: { goal: '阅读并总结', phases: [{ status: 'active' }] },
        rounds: [{ status: 'failed', failureCategory: 'artifact_verification_failed' }],
      });
    });
    expect((await manager.snapshot('task-feishu-theme'))?.rounds[0]?.receipt).toBeUndefined();
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect(driver.addFollowUp).toHaveBeenCalledWith(expect.stringContaining('not independently verified'));
  });

  it('rejects a final-URL-only long-horizon answer, then accepts the complete two-source result', async () => {
    const instruction =
      '先确认 IANA Example Domains 的标题和 URL，再打开 Wikipedia 的 Web_browser 条目，读取标题和首段定义，最终输出两条中文观察，每条都带 URL。';
    const ianaQuote = '这些域名只用于文档中的说明性示例';
    const wikipediaQuote = '网页浏览器是用于访问网站的软件应用';
    const completeAnswer = [
      `1. IANA 页面写道“Example Domains”、“${ianaQuote}”：https://www.iana.org/help/example-domains`,
      `2. Web browser 条目写道“Web browser”、“${wikipediaQuote}”：https://en.wikipedia.org/wiki/Web_browser`,
    ].join('\n');
    let hooks!: ExecutorHooks;
    let finish!: (outcome: ExecutorOutcome) => void;
    let criteriaFrozen = false;
    const driver = fakeDriver();
    driver.run = vi
      .fn()
      .mockImplementationOnce(() => new Promise<ExecutorOutcome>(resolve => (finish = resolve)))
      .mockResolvedValueOnce({ kind: 'candidate_complete', summary: completeAnswer });
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
      commandId: 'start-two-source',
      taskId: 'task-two-source',
      instruction,
      chatSessionId: 'chat-two-source',
      instructionMessageId: 'message-two-source',
      tabId: 7,
    });
    await vi.waitFor(() => expect(hooks).toBeDefined());
    const roundId = await taskRoundId(manager, 'task-two-source');
    await hooks.onPlan(roundId, [
      { kind: 'page_text', operator: 'present', expected: 'Example Domains', required: true },
      { kind: 'page_text', operator: 'present', expected: 'Web browser', required: true },
      { kind: 'page_text', operator: 'present', expected: 'software application', required: true },
      { kind: 'page_text', operator: 'present', expected: 'source detail', required: true },
    ]);
    criteriaFrozen = true;
    for (const [url, title, quote, pageRevision] of [
      ['https://www.iana.org/help/example-domains', 'Example Domains', ianaQuote, 'iana-revision'],
      ['https://en.wikipedia.org/wiki/Web_browser', 'Web browser', wikipediaQuote, 'wikipedia-revision'],
    ] as const) {
      store.observeActionTarget.mockResolvedValue({
        target: {
          id: 'page-' + new URL(url).hostname,
          kind: 'page',
          tabId: 7,
          frameId: 0,
          urlOrigin: new URL(url).origin,
          normalizedUrl: normalizeProvenanceUrl(url)!,
          digest: 'digest-' + new URL(url).hostname,
          label: title,
          textDigests: [await sha256(title), await sha256(quote)],
          pageRevision,
          observedAt: 100,
        },
        tag: undefined,
        type: undefined,
        inForm: false,
      });
      await hooks.dispatchAction(
        roundId,
        new Action(async () => new ActionResult({ success: true }), goToUrlActionSchema),
        { url, intent: 'visit source' },
      );
    }
    finish({
      kind: 'candidate_complete',
      summary: '页面地址已符合目标：https://en.wikipedia.org/wiki/Web_browser',
    });

    await vi.waitFor(async () => {
      const snapshot = await manager.snapshot('task-two-source');
      expect(snapshot).toMatchObject({
        status: 'completed',
        rounds: [{ instructionSummary: completeAnswer, receipt: { taskId: 'task-two-source' } }],
      });
    });
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect(driver.addFollowUp).toHaveBeenCalledTimes(1);
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
    expect(snapshot?.rounds[0]?.instructionSummary).toBe(await redactDeliverableUrlsForPersistence(answer));
    expect(JSON.stringify(snapshot)).not.toContain('TOPSECRET');
    expect(JSON.stringify(snapshot)).not.toContain('?id=1');
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

  it('does not complete a read-only page summary when page_text evidence is false', async () => {
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
        status: 'failed',
        rounds: [
          {
            status: 'failed',
            failureCategory: 'no_action',
            criteria: [expect.objectContaining({ kind: 'page_text', baseline: false })],
          },
        ],
      });
    });
    expect((await manager.snapshot('task-summary-with-criterion'))?.rounds[0]?.waitReason).toBeUndefined();
    expect((await manager.snapshot('task-summary-with-criterion'))?.rounds[0]?.receipt).toBeUndefined();
    expect(driver.run).toHaveBeenCalledTimes(2);
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
        rounds: [
          {
            status: 'completed',
            criteria: [expect.objectContaining({ kind: 'page_text' })],
            evidence: [expect.objectContaining({ passed: true, source: 'page' })],
            receipt: { criterionIds: [expect.any(String)] },
          },
        ],
      });
    });
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
