import { describe, expect, it } from 'vitest';
import {
  addEvidenceRecordsToSpace,
  canonicalizeEvidenceSource,
  evidenceSpaceProgress,
  evidenceBasisAppearsInPage,
  isSearchResultsEvidenceSource,
  isPrivateDashboardEvidenceSource,
  isDiscussionOnlyProductSource,
  putResearchDecisionInSpace,
  putResearchDeliveryInSpace,
  researchDecisionReady,
  researchDeliveryReady,
  type EvidenceRecordDraft,
} from '@extension/storage/lib/task';

const discussion: EvidenceRecordDraft = {
  recordType: 'user_discussion',
  source: 'https://example.com/thread?utm_source=test#comment-42',
  sourceTitle: 'Reader discussion',
  userProblem: 'The reader loses context in long documents.',
  rawBasis: 'The commenter says they repeatedly lose their place and reopen a separate notes application.',
  observation: 'The reader leaves the document to recover context.',
  inference: 'Persistent reading context may reduce abandonment.',
  confidence: 'medium',
  priority: 'high',
  stance: 'support',
  dedupeKey: 'thread:comment-42',
};

describe('EvidenceSpace', () => {
  it('adds observed records, deduplicates replay and keeps independent counters', () => {
    const first = addEvidenceRecordsToSpace({
      taskId: 'task-1',
      observedSource: 'https://example.com/thread#top',
      drafts: [discussion, { ...discussion, recordType: 'product', dedupeKey: 'product:reader-x' }],
      now: 10,
    });
    expect(first.added).toHaveLength(2);
    expect(evidenceSpaceProgress(first.space)).toMatchObject({ userDiscussions: 1, products: 1, total: 2 });

    const replay = addEvidenceRecordsToSpace({
      space: first.space,
      taskId: 'task-1',
      observedSource: 'https://example.com/thread',
      drafts: [discussion],
      now: 20,
    });
    expect(replay.added).toHaveLength(0);
    expect(replay.duplicateKeys).toEqual(['user_discussion:thread:comment-42']);
    expect(evidenceSpaceProgress(replay.space).total).toBe(2);
  });

  it('keeps one product record per opened product page while allowing independent discussion quotes', () => {
    const first = addEvidenceRecordsToSpace({
      taskId: 'task-product-dedupe',
      observedSource: 'https://example.com/product',
      drafts: [
        {
          ...discussion,
          source: 'https://example.com/product',
          recordType: 'product',
          relatedProduct: 'Reader X',
          dedupeKey: 'product-x:first',
        },
      ],
      now: 10,
    });
    const replay = addEvidenceRecordsToSpace({
      space: first.space,
      taskId: 'task-product-dedupe',
      observedSource: 'https://example.com/product',
      drafts: [
        {
          ...discussion,
          source: 'https://example.com/product',
          recordType: 'product',
          relatedProduct: 'Reader X',
          dedupeKey: 'product-x:rewritten',
        },
      ],
      now: 20,
    });

    expect(replay.space.records).toHaveLength(1);
    expect(replay.duplicateKeys).toEqual(['product:product-x:rewritten']);
  });

  it('rejects unopened sources and records without substantive raw basis', () => {
    const result = addEvidenceRecordsToSpace({
      taskId: 'task-1',
      observedSource: 'https://example.com/opened',
      drafts: [
        { ...discussion, source: 'https://example.com/not-opened' },
        { ...discussion, source: 'https://example.com/opened', rawBasis: 'too short', dedupeKey: 'short' },
      ],
      now: 10,
    });
    expect(result.added).toHaveLength(0);
    expect(result.rejected.map(item => item.reason)).toEqual(['source_not_observed', 'invalid_record']);
  });

  it('normalizes tracking and fragments without changing the content path', () => {
    expect(canonicalizeEvidenceSource('HTTPS://Example.COM/thread/?utm_source=x#comment')).toBe(
      'https://example.com/thread',
    );
    expect(
      canonicalizeEvidenceSource(
        'https://www.reddit.com/r/GetStudying/comments/abc/thread/?logging_in=true&context=3#comment',
      ),
    ).toBe('https://www.reddit.com/r/GetStudying/comments/abc/thread');
    expect(
      evidenceBasisAppearsInPage(
        'The commenter says they repeatedly lose their place.',
        'A long thread. The commenter says they repeatedly lose their place. More text.',
      ),
    ).toBe(true);
    expect(evidenceBasisAppearsInPage('A plausible but invented quotation from nowhere.', 'Different page text.')).toBe(
      false,
    );
  });

  it('counts quota progress by independent discussion source and product identity', () => {
    const first = addEvidenceRecordsToSpace({
      taskId: 'task-quota',
      observedSource: 'https://example.com/thread',
      drafts: [
        discussion,
        { ...discussion, dedupeKey: 'thread:second-observation' },
        {
          ...discussion,
          recordType: 'product',
          relatedProduct: 'Reader X',
          dedupeKey: 'product:reader-x:first',
        },
      ],
      now: 10,
    });
    const second = addEvidenceRecordsToSpace({
      space: first.space,
      taskId: 'task-quota',
      observedSource: 'https://example.com/reader-x/review',
      drafts: [
        {
          ...discussion,
          source: 'https://example.com/reader-x/review',
          recordType: 'product',
          relatedProduct: 'Reader X',
          dedupeKey: 'product:reader-x:second',
        },
      ],
      now: 20,
    });

    expect(evidenceSpaceProgress(second.space)).toMatchObject({
      total: 4,
      userDiscussions: 1,
      products: 1,
    });

    const third = addEvidenceRecordsToSpace({
      space: second.space,
      taskId: 'task-quota',
      observedSource: 'https://example.com/thread',
      drafts: [
        {
          ...discussion,
          rawBasis: 'A second commenter describes abandoning the document and switching to a video lecture instead.',
          dedupeKey: 'thread:independent-case',
        },
      ],
      now: 30,
    });
    expect(evidenceSpaceProgress(third.space).userDiscussions).toBe(2);
  });

  it('does not count search-result pages as user evidence', () => {
    expect(isSearchResultsEvidenceSource('https://hn.algolia.com/?q=chat+PDF+abandoned')).toBe(true);
    expect(isSearchResultsEvidenceSource('https://www.reddit.com/r/ChatPDF/')).toBe(true);
    expect(isSearchResultsEvidenceSource('https://news.ycombinator.com/newest')).toBe(true);
    expect(isSearchResultsEvidenceSource('https://www.reddit.com/r/ChatPDF/comments/abc/a_real_thread/')).toBe(false);
    expect(isPrivateDashboardEvidenceSource('https://notebook.google.com/?pli=1')).toBe(true);
    const result = addEvidenceRecordsToSpace({
      taskId: 'task-search-result',
      observedSource: 'https://hn.algolia.com/?q=chat+PDF+abandoned',
      drafts: [
        {
          ...discussion,
          source: 'https://hn.algolia.com/?q=chat+PDF+abandoned',
          dedupeKey: 'search-snippet',
        },
      ],
      now: 10,
    });

    expect(evidenceSpaceProgress(result.space)).toMatchObject({ total: 0, userDiscussions: 0 });
  });

  it('does not count discussion posts as completed product research', () => {
    expect(isDiscussionOnlyProductSource('https://news.ycombinator.com/item?id=45682192')).toBe(true);
    expect(isDiscussionOnlyProductSource('https://github.com/acme/reader/issues/42')).toBe(true);
    expect(isDiscussionOnlyProductSource('https://github.com/acme/reader')).toBe(false);
    const result = addEvidenceRecordsToSpace({
      taskId: 'task-discussion-product',
      observedSource: 'https://news.ycombinator.com/item?id=45682192',
      drafts: [
        {
          ...discussion,
          source: 'https://news.ycombinator.com/item?id=45682192',
          recordType: 'product',
          relatedProduct: 'EZMind AI',
          dedupeKey: 'ezmind-hn-launch',
        },
      ],
      now: 10,
    });
    expect(result.space.records).toHaveLength(1);
    expect(evidenceSpaceProgress(result.space)).toMatchObject({ total: 0, products: 0 });
  });

  it('accepts exactly three decisions only with seven answers and 2+1+1 evidence coverage', () => {
    const first = addEvidenceRecordsToSpace({
      taskId: 'task-decision',
      observedSource: 'https://example.com/thread-a',
      drafts: [{ ...discussion, source: 'https://example.com/thread-a', dedupeKey: 'thread-a' }],
      now: 10,
    });
    const second = addEvidenceRecordsToSpace({
      space: first.space,
      taskId: 'task-decision',
      observedSource: 'https://example.com/thread-b',
      drafts: [{ ...discussion, source: 'https://example.com/thread-b', dedupeKey: 'thread-b' }],
      now: 20,
    });
    const third = addEvidenceRecordsToSpace({
      space: second.space,
      taskId: 'task-decision',
      observedSource: 'https://example.com/product',
      drafts: [
        {
          ...discussion,
          source: 'https://example.com/product',
          recordType: 'product',
          relatedProduct: 'Reader X',
          dedupeKey: 'product-x',
        },
      ],
      now: 30,
    });
    const fourth = addEvidenceRecordsToSpace({
      space: third.space,
      taskId: 'task-decision',
      observedSource: 'https://example.com/repository',
      drafts: [
        {
          ...discussion,
          source: 'https://example.com/repository',
          recordType: 'repository',
          dedupeKey: 'repository',
        },
      ],
      now: 40,
    });
    const [userA, userB, product, repository] = fourth.space.records;
    const capability = (title: string) => ({
      title,
      userMoment: 'When a reader loses the thread of a complex argument.',
      behaviorChange: 'They inspect a grounded explanation without abandoning the source.',
      whyNow: 'The current reader already preserves source anchors and can extend them.',
      whyOthersLater: 'Generic chat and decorative visual effects do not solve this bottleneck.',
      implementationDistance: 'The source model exists; the smallest gap is a bounded explanation layer.',
      mvp: 'Explain one selected passage with a source-linked visual and return path.',
      successMetric: 'More readers return to the source and finish the active chapter.',
      userEvidenceIds: [userA.id, userB.id],
      productEvidenceIds: [product.id],
      repositoryEvidenceIds: [repository.id],
    });
    const accepted = putResearchDecisionInSpace({
      space: fourth.space,
      draft: {
        capabilities: [capability('Capability A'), capability('Capability B'), capability('Capability C')],
        deferred: ['Generic PDF chat'],
        contradictions: ['Some readers prefer a separate notes tool.'],
      },
      now: 50,
    });
    expect(accepted.accepted).toBe(true);
    expect(researchDecisionReady(accepted.space)).toBe(true);

    const table = putResearchDeliveryInSpace({
      space: accepted.space,
      kind: 'research_table',
      url: 'https://example.feishu.cn/base/research',
      title: 'Living Reader 研究表',
      observedText: '证据 来源 用户问题 观察 推断 置信度 相关产品 对应 Living Reader 能力 优先级',
      rowCount: 4,
      now: 60,
    });
    expect(table.accepted).toBe(true);
    const document = putResearchDeliveryInSpace({
      space: table.space,
      kind: 'decision_document',
      url: 'https://example.feishu.cn/docx/decision',
      title: 'Living Reader 最终决策',
      observedText:
        '下一步做什么 Capability A Capability B Capability C 为什么 这些改变阅读行为 暂时不做 Generic PDF chat',
      now: 70,
    });
    expect(document.accepted).toBe(true);
    expect(researchDeliveryReady(document.space)).toBe(true);

    const rejected = putResearchDecisionInSpace({
      space: fourth.space,
      draft: {
        capabilities: [
          { ...capability('Capability A'), userEvidenceIds: [userA.id] },
          capability('Capability B'),
          capability('Capability C'),
        ],
        deferred: ['Generic PDF chat'],
        contradictions: [],
      },
      now: 50,
    });
    expect(rejected.accepted).toBe(false);
    expect(rejected.reasons).toContain('Capability A:two_user_sources_required');
  });
});
