import { describe, expect, it } from 'vitest';
import type { EvidenceRecord } from '@extension/storage/lib/task';
import {
  extractResearchQuotas,
  isRecoverableResearchDecisionFailure,
  isSearchResultsUrl,
  isRecoverableResearchFailure,
  maxResearchWorkCycles,
  researchContinuationQuery,
  renderResearchDecisionEvidenceShortlist,
  renderResearchCheckpoint,
  researchQuotaMissing,
  researchQuotasMet,
  requiresStructuredResearchDecision,
  shouldGoBackFromUnavailableResearchPage,
  shouldLeavePrivateResearchDashboard,
  shouldRequireEvidenceBeforeNavigation,
} from '../research-checkpoint';

describe('research checkpoint', () => {
  it('extracts the explicit Living Reader research quotas', () => {
    const quotas = extractResearchQuotas(`
      至少搜索并阅读 80 个具有实际信息量的用户讨论或案例。
      至少研究 30 个产品，不局限于 PDF 阅读器。
    `);
    expect(quotas).toEqual({ userDiscussions: 80, products: 30 });
  });

  it('does not turn an ordinary browsing task into a research cycle', () => {
    expect(extractResearchQuotas('打开当前页面并用一句话说明内容。')).toBeNull();
    expect(requiresStructuredResearchDecision('研究普通 PDF 产品')).toBe(false);
    expect(requiresStructuredResearchDecision('接管 The Living Reader / 鲜活阅读器')).toBe(true);
  });

  it('computes durable missing counts and renders a bounded continuation', () => {
    const quotas = { userDiscussions: 80, products: 30 };
    const progress = {
      total: 91,
      userDiscussions: 70,
      products: 21,
      repository: 0,
      browserContext: 0,
      productPrinciples: 0,
    };
    expect(researchQuotaMissing(quotas, progress)).toEqual({ userDiscussions: 10, products: 9 });
    expect(researchQuotasMet(quotas, progress)).toBe(false);
    expect(renderResearchCheckpoint(quotas, progress)).toContain('missing_user_discussions=10');
    expect(renderResearchCheckpoint(quotas, progress)).toContain('missing_products=9');
    expect(renderResearchCheckpoint(quotas, { ...progress, repository: 3 })).toContain(
      'repository audit is already recorded',
    );
    expect(researchQuotasMet(quotas, { ...progress, userDiscussions: 80, products: 30 })).toBe(true);
    expect(maxResearchWorkCycles(quotas)).toBe(236);
    expect(maxResearchWorkCycles({ userDiscussions: 1, products: 1 })).toBe(20);
    expect(isRecoverableResearchFailure('no_action')).toBe(true);
    expect(isRecoverableResearchFailure('evidence_required')).toBe(true);
    expect(isRecoverableResearchDecisionFailure('evidence_required')).toBe(true);
    expect(isRecoverableResearchFailure('source_required')).toBe(true);
    expect(isRecoverableResearchFailure('research_quota_unmet')).toBe(false);
    expect(researchContinuationQuery(quotas, progress)).toContain('product');
    expect(
      researchContinuationQuery(quotas, { ...progress, userDiscussions: 10, products: 29 }),
    ).toContain('github.com');
    expect(
      researchContinuationQuery(quotas, { ...progress, userDiscussions: 80, products: 30 }),
    ).toBeNull();
  });

  it('requires a durable record before leaving a substantive source', () => {
    expect(
      shouldRequireEvidenceBeforeNavigation({
        actionName: 'go_to_url',
        currentUrl: 'https://raw.githubusercontent.com/yishu-ziyu/living-reader/main/design.md',
        sourceRecorded: false,
        pageUnavailable: false,
        hasSubstantiveText: true,
      }),
    ).toBe(true);
    expect(
      shouldRequireEvidenceBeforeNavigation({
        actionName: 'go_to_url',
        currentUrl: 'https://raw.githubusercontent.com/yishu-ziyu/living-reader/main/design.md',
        sourceRecorded: true,
        pageUnavailable: false,
        hasSubstantiveText: true,
      }),
    ).toBe(false);
  });

  it('renders a compact valid evidence shortlist for the structured decision gate', () => {
    const record = (
      id: string,
      recordType: 'user_discussion' | 'product' | 'repository',
      source: string,
      overrides: Partial<EvidenceRecord> = {},
    ): EvidenceRecord => ({
      id,
      taskId: 'task-1',
      recordType,
      source,
      canonicalSource: source,
      sourceTitle: `${recordType} ${id}`,
      rawBasis: 'A sufficiently long verbatim basis from the observed source page.',
      observation: `Observed evidence for ${id}`,
      inference: `Inference for ${id}`,
      confidence: 'high' as const,
      priority: 'high' as const,
      stance: 'support' as const,
      dedupeKey: id,
      capturedAt: 1,
      ...overrides,
    });
    const shortlist = renderResearchDecisionEvidenceShortlist({
      taskId: 'task-1',
      workCycles: 0,
      createdAt: 1,
      updatedAt: 1,
      records: [
        record('user-a', 'user_discussion', 'https://forum.example/a'),
        record('user-a-duplicate', 'user_discussion', 'https://forum.example/a'),
        record('user-b', 'user_discussion', 'https://forum.example/b'),
        record('product-a', 'product', 'https://product.example/', { relatedProduct: 'Product A' }),
        record('repo-a', 'repository', 'https://github.com/example/living-reader'),
      ],
    });
    expect(shortlist).toContain('id=user-a');
    expect(shortlist).not.toContain('id=user-a-duplicate');
    expect(shortlist).toContain('id=user-b');
    expect(shortlist).toContain('id=product-a');
    expect(shortlist).toContain('id=repo-a');
    expect(shortlist).toContain('Stop inspecting');
  });

  it('allows leaving search results and unavailable pages without recording them', () => {
    expect(isSearchResultsUrl('https://www.google.com/search?q=ai+pdf+complaints')).toBe(true);
    expect(isSearchResultsUrl('https://github.com/search?q=pdf&type=issues')).toBe(true);
    expect(
      shouldRequireEvidenceBeforeNavigation({
        actionName: 'click_element',
        currentUrl: 'https://www.google.com/search?q=ai+pdf+complaints',
        sourceRecorded: false,
        pageUnavailable: false,
        hasSubstantiveText: true,
      }),
    ).toBe(false);
    expect(
      shouldRequireEvidenceBeforeNavigation({
        actionName: 'go_back',
        currentUrl: 'https://example.com/dead',
        sourceRecorded: false,
        pageUnavailable: true,
        hasSubstantiveText: true,
      }),
    ).toBe(false);
  });

  it('forces research away from unavailable pages instead of recording, waiting, or finishing', () => {
    expect(
      shouldGoBackFromUnavailableResearchPage({
        pageUnavailable: true,
        actionName: 'record_evidence',
        done: false,
      }),
    ).toBe(true);
    expect(
      shouldGoBackFromUnavailableResearchPage({ pageUnavailable: true, actionName: 'wait', done: false }),
    ).toBe(true);
    expect(
      shouldGoBackFromUnavailableResearchPage({ pageUnavailable: true, actionName: undefined, done: true }),
    ).toBe(true);
    expect(
      shouldGoBackFromUnavailableResearchPage({ pageUnavailable: true, actionName: 'go_to_url', done: false }),
    ).toBe(false);
    expect(
      shouldGoBackFromUnavailableResearchPage({ pageUnavailable: false, actionName: 'record_evidence', done: false }),
    ).toBe(false);
  });

  it('leaves a private Notebook dashboard instead of recording user material', () => {
    expect(
      shouldLeavePrivateResearchDashboard({
        url: 'https://notebook.google.com/?pli=1',
        bodyText: 'My notebooks Featured notebooks Recent notebooks Create new notebook',
        actionName: 'record_evidence',
        done: false,
      }),
    ).toBe(true);
    expect(
      shouldLeavePrivateResearchDashboard({
        url: 'https://support.google.com/notebooklm',
        bodyText: 'Public NotebookLM help',
        actionName: 'record_evidence',
        done: false,
      }),
    ).toBe(false);
  });
});
