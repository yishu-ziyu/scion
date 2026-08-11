import { describe, expect, it } from 'vitest';
import {
  CONTROL_MAX_NO_PROGRESS,
  createResearchEvidenceRetryBudget,
  invokeWithTimeout,
  mapLoopOutcomeToExecutor,
  researchDecisionFailureFeedback,
  shouldKeepActionResultInContext,
  shouldRedirectSearchResultEvidenceAttempt,
  shouldRetryUnrecordedResearchSource,
} from '../control-llm';
import type { LoopOutcome } from '../observe-act-loop';

describe('control-llm outcome mapping (contracts 010/011 harden)', () => {
  it('bounds a hung model invocation', async () => {
    await expect(invokeWithTimeout(() => new Promise(() => undefined), 5)).rejects.toThrow('llm_timeout');
  });

  it('exposes explicit no-progress budget', () => {
    expect(CONTROL_MAX_NO_PROGRESS).toBe(3);
  });

  it('keeps substantive read results in the next model turn', () => {
    expect(shouldKeepActionResultInContext('record_evidence')).toBe(true);
    expect(shouldKeepActionResultInContext('read_page_text')).toBe(true);
    expect(shouldKeepActionResultInContext('inspect_github_repository')).toBe(true);
    expect(shouldKeepActionResultInContext('click_element')).toBe(false);
  });

  it('retries evidence capture on a substantive unrecorded source, but not on search or private pages', () => {
    const base = {
      hasResearchQuotas: true,
      currentSourceRecorded: false,
      pageUnavailable: false,
      textLength: 1_000,
    };
    expect(shouldRetryUnrecordedResearchSource({ ...base, pageUrl: 'https://updf.com/' })).toBe(true);
    expect(
      shouldRetryUnrecordedResearchSource({ ...base, pageUrl: 'https://updf.com/', collectionComplete: true }),
    ).toBe(false);
    expect(
      shouldRetryUnrecordedResearchSource({ ...base, pageUrl: 'https://www.google.com/search?q=updf' }),
    ).toBe(false);
    expect(shouldRetryUnrecordedResearchSource({ ...base, pageUrl: 'https://notebook.google.com/' })).toBe(false);
  });

  it('redirects evidence attempts made on search and community index pages', () => {
    expect(
      shouldRedirectSearchResultEvidenceAttempt({
        pageUrl: 'https://www.reddit.com/r/notebooklm/',
        actionName: 'record_evidence',
      }),
    ).toBe(true);
    expect(
      shouldRedirectSearchResultEvidenceAttempt({
        pageUrl: 'https://www.reddit.com/r/notebooklm/comments/abc/concrete_post',
        actionName: 'record_evidence',
      }),
    ).toBe(false);
  });

  it('returns only fixed validator codes for structured decision correction', () => {
    const feedback = researchDecisionFailureFeedback(
      'Research decision rejected: Secret capability title:seven_answers_required, Secret capability title:product_evidence_required',
    );
    expect(feedback).toContain('seven_answers_required');
    expect(feedback).toContain('product_evidence_required');
    expect(feedback).not.toContain('Secret capability title');
    expect(researchDecisionFailureFeedback('Invalid input containing private values')).not.toContain('private values');
  });

  it('reminds once per source, then allows navigation away from irrelevant research pages', () => {
    const budget = createResearchEvidenceRetryBudget();
    expect(budget.consume('https://www.youtube.com/watch?v=abc&utm_source=test')).toBe(true);
    expect(budget.consume('https://www.youtube.com/watch?v=abc')).toBe(false);
    expect(budget.consume('https://example.com/another-source')).toBe(true);
  });

  it.each(['no_progress', 'max_steps'] as const)(
    'preserves stop category %s for TaskManager failureCategory',
    category => {
      const outcome: LoopOutcome = { kind: 'failed', category };
      expect(mapLoopOutcomeToExecutor(outcome)).toEqual({ kind: 'failed', category });
    },
  );

  it('does not rewrite other failed categories', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: 'observe_failed' })).toEqual({
      kind: 'failed',
      category: 'observe_failed',
    });
  });

  it('maps empty category to unknown (not silent drop)', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: '' })).toEqual({
      kind: 'failed',
      category: 'unknown',
    });
    expect(mapLoopOutcomeToExecutor({ kind: 'failed', category: '   ' })).toEqual({
      kind: 'failed',
      category: 'unknown',
    });
  });

  it('maps waiting_user without converting to failed', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'waiting_user', reason: 'login_required' })).toEqual({
      kind: 'waiting_user',
      reason: 'login_required',
    });
  });

  it('maps candidate_complete and cancelled', () => {
    expect(mapLoopOutcomeToExecutor({ kind: 'candidate_complete', summary: 'done' })).toEqual({
      kind: 'candidate_complete',
      summary: 'done',
    });
    expect(mapLoopOutcomeToExecutor({ kind: 'cancelled' })).toEqual({ kind: 'cancelled' });
  });
});
