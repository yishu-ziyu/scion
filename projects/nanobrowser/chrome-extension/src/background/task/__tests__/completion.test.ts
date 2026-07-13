import { describe, expect, it } from 'vitest';
import { checkCompletion } from '../completion';

describe('CompletionChecker', () => {
  it('rejects evidence already true at baseline', () => {
    const result = checkCompletion({
      now: 200,
      currentRoundId: 'round-1',
      criteria: [
        {
          id: 'c1',
          kind: 'page_text',
          operator: 'present',
          expectedDigest: 'saved-digest',
          required: true,
          roundId: 'round-1',
          targetRefId: 'tab-1',
          baseline: true,
          frozenAt: 100,
          notBefore: 150,
          timeoutMs: 5000,
        },
      ],
      observations: [
        {
          criterionId: 'c1',
          roundId: 'round-1',
          targetRefId: 'tab-1',
          observedAt: 200,
          source: 'page',
          value: true,
        },
      ],
    });
    expect(result.passed).toBe(false);
    expect(result.evidence[0].reason).toBe('already_true_at_baseline');
  });

  it.each([
    ['old round', { roundId: 'round-0' }, {}, 'wrong_round'],
    ['wrong target', {}, { targetRefId: 'tab-2' }, 'wrong_target'],
    ['before commit', {}, { observedAt: 149 }, 'stale'],
    ['after timeout', {}, {}, 'timed_out'],
    ['value mismatch', {}, { value: false }, 'mismatch'],
  ] as const)('rejects %s evidence', (_name, criterionPatch, observationPatch, reason) => {
    const criterion = {
      id: 'c1',
      kind: 'page_text' as const,
      operator: 'present' as const,
      expectedDigest: 'saved-digest',
      required: true,
      roundId: 'round-1',
      targetRefId: 'tab-1',
      baseline: false,
      frozenAt: 100,
      notBefore: 150,
      timeoutMs: 5000,
      ...criterionPatch,
    };
    const observation = {
      criterionId: 'c1',
      roundId: 'round-1',
      targetRefId: 'tab-1',
      observedAt: 200,
      source: 'page' as const,
      value: true,
      ...observationPatch,
    };
    const result = checkCompletion({
      now: reason === 'timed_out' ? 5201 : 200,
      currentRoundId: 'round-1',
      criteria: [criterion],
      observations: [observation],
    });
    expect(result.passed).toBe(false);
    expect(result.evidence[0].reason).toBe(reason);
  });

  it('accepts only a dedicated user observation for user_confirmed', () => {
    const criterion = {
      id: 'confirm-1',
      kind: 'user_confirmed' as const,
      operator: 'equals' as const,
      expected: true as const,
      required: true,
      roundId: 'round-1',
      targetRefId: 'tab-1',
      baseline: false,
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: 5000,
    };
    const result = checkCompletion({
      now: 200,
      currentRoundId: 'round-1',
      criteria: [criterion],
      observations: [
        {
          criterionId: 'confirm-1',
          roundId: 'round-1',
          targetRefId: 'tab-1',
          observedAt: 200,
          source: 'user',
          value: true,
        },
      ],
    });
    expect(result.passed).toBe(true);

    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [
          {
            criterionId: 'confirm-1',
            roundId: 'round-1',
            targetRefId: 'tab-1',
            observedAt: 200,
            source: 'page',
            value: true,
          },
        ],
      }).passed,
    ).toBe(false);

    expect(
      checkCompletion({
        now: 200,
        currentRoundId: 'round-1',
        criteria: [criterion],
        observations: [
          {
            criterionId: 'confirm-1',
            roundId: 'round-1',
            targetRefId: 'tab-1',
            observedAt: 200,
            source: 'page',
            value: false,
          },
          {
            criterionId: 'confirm-1',
            roundId: 'round-1',
            targetRefId: 'tab-1',
            observedAt: 200,
            source: 'user',
            value: true,
          },
        ],
      }).passed,
    ).toBe(true);
  });

  it('rejects URL evidence when the same URL already matched at baseline', () => {
    const result = checkCompletion({
      now: 200,
      currentRoundId: 'round-1',
      criteria: [
        {
          id: 'url-1',
          kind: 'url',
          operator: 'equals',
          expected: 'https://example.test/success',
          required: true,
          roundId: 'round-1',
          targetRefId: 'tab-1',
          baseline: 'https://example.test/success',
          frozenAt: 100,
          notBefore: 100,
          timeoutMs: 5000,
        },
      ],
      observations: [
        {
          criterionId: 'url-1',
          roundId: 'round-1',
          targetRefId: 'tab-1',
          observedAt: 200,
          source: 'page',
          value: 'https://example.test/success',
        },
      ],
    });
    expect(result.evidence[0]).toMatchObject({ passed: false, reason: 'already_true_at_baseline' });
  });

  it('allows failed optional criteria without completing an empty required set by accident', () => {
    const optional = {
      id: 'optional-1',
      kind: 'url' as const,
      operator: 'equals' as const,
      expected: 'https://example.test/success',
      required: false,
      roundId: 'round-1',
      targetRefId: 'tab-1',
      baseline: false,
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: 5000,
    };
    const result = checkCompletion({
      now: 200,
      currentRoundId: 'round-1',
      criteria: [optional],
      observations: [],
    });
    expect(result.passed).toBe(true);
    expect(result.evidence).toEqual([expect.objectContaining({ criterionId: 'optional-1', passed: false })]);
  });

  it('never completes an empty criterion set', () => {
    expect(checkCompletion({ now: 200, currentRoundId: 'round-1', criteria: [], observations: [] })).toEqual({
      passed: false,
      evidence: [],
    });
  });
});
