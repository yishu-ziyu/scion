import { describe, expect, it } from 'vitest';
import { createTableArtifact, createTextArtifact } from '../artifact';
import { verifyCandidateComplete } from '../verification-engine';

describe('VerificationEngine', () => {
  it('PASS when artifact schema + row count hold', () => {
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'a', price: '1', rating: '5' },
        { name: 'b', price: '2', rating: '4' },
      ],
      sources: [{ url: 'https://shop.test/1' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [
        { kind: 'artifact_exists' },
        { kind: 'artifact_schema', expected: ['name', 'price', 'rating'] },
        { kind: 'artifact_row_count', operator: '>=', expected: 2 },
        { kind: 'artifact_source_count', operator: '>=', expected: 1 },
      ],
    });
    expect(result.verdict).toBe('PASS');
    expect(result.complete).toBe(true);
  });

  it('FAIL on row count and judge cannot rescue', () => {
    const artifact = createTableArtifact({
      title: 'products',
      columns: ['name'],
      rows: [{ name: 'only' }],
      sources: [],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_row_count', operator: '>=', expected: 10 }],
      llmJudge: { passed: true, reason: 'looks good' },
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.complete).toBe(false);
  });

  it('INCONCLUSIVE without criteria or artifact is not complete', () => {
    const result = verifyCandidateComplete({});
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.complete).toBe(false);
  });

  it('INCONCLUSIVE for a text artifact with only existence/source checks', () => {
    const artifact = createTextArtifact({
      title: 'answer',
      text: '标题：Example；域名：example.com',
      sources: [{ url: 'https://example.com' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_exists' }, { kind: 'artifact_source_count', operator: '>=', expected: 1 }],
    });
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.complete).toBe(false);
    expect(result.reasons).toContain('text_artifact_unverified');
  });

  it('INCONCLUSIVE when every criterion is optional', () => {
    const result = verifyCandidateComplete({
      artifacts: [
        createTableArtifact({
          title: 'optional',
          columns: ['name'],
          rows: [{ name: 'A' }],
        }),
      ],
      artifactCriteria: [{ kind: 'artifact_exists', required: false }],
    });
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasons).toContain('no_required_criteria');
  });

  it('does not let artifact_contains make text self-verifying', () => {
    const artifact = createTextArtifact({ title: 'answer', text: 'Visible detail: Alpha' });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_contains', expected: 'Alpha', required: true }],
    });
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasons).toContain('text_artifact_unverified');
  });

  it('PASSes text only with a required browser criterion that is freshly observed', () => {
    const artifact = createTextArtifact({ title: 'answer', text: 'Visible detail: Alpha' });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_contains', expected: 'Alpha', required: true }],
      completion: {
        now: 200,
        currentRoundId: 'round-1',
        criteria: [
          {
            id: 'page-proof',
            kind: 'page_text',
            operator: 'present',
            expectedDigest: 'alpha-digest',
            required: true,
            roundId: 'round-1',
            targetRefId: 'tab-1',
            baseline: false,
            frozenAt: 100,
            notBefore: 100,
            timeoutMs: 5_000,
          },
        ],
        observations: [
          {
            criterionId: 'page-proof',
            roundId: 'round-1',
            targetRefId: 'tab-1',
            observedAt: 200,
            source: 'page',
            value: true,
          },
        ],
      },
    });
    expect(result.verdict).toBe('PASS');
    expect(result.complete).toBe(true);
  });

  it('FAILs text when required browser evidence targets the wrong page', () => {
    const artifact = createTextArtifact({ title: 'answer', text: 'Visible detail: Alpha' });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_contains', expected: 'Alpha', required: true }],
      completion: {
        now: 200,
        currentRoundId: 'round-1',
        criteria: [
          {
            id: 'page-proof',
            kind: 'page_text',
            operator: 'present',
            expectedDigest: 'alpha-digest',
            required: true,
            roundId: 'round-1',
            targetRefId: 'tab-1',
            baseline: false,
            frozenAt: 100,
            notBefore: 100,
            timeoutMs: 5_000,
          },
        ],
        observations: [
          {
            criterionId: 'page-proof',
            roundId: 'round-1',
            targetRefId: 'tab-2',
            observedAt: 200,
            source: 'page',
            value: true,
          },
        ],
      },
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.reasons).toContain('completion_failed');
  });

  it('LLM judge failure after deterministic pass still fails', () => {
    const artifact = createTableArtifact({
      title: 't',
      columns: ['name'],
      rows: [{ name: 'a' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_exists' }],
      llmJudge: { passed: false, reason: 'does not answer question' },
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.reasons.join(' ')).toMatch(/llm_judge/);
  });
});
