/**
 * 022-VERIFY-01 / 022-ARTIFACT-01: Verifier rejects false candidate_complete;
 * artifact schema/row/source checks are real, not summary-text only.
 */
import { describe, expect, it } from 'vitest';
import { createTableArtifact, createTextArtifact } from '../artifact';
import { verifyCandidateComplete } from '../verification-engine';

describe('022-VERIFY-01 false candidate_complete', () => {
  it('rejects empty candidate with no evidence (Executor cannot self-complete)', () => {
    const result = verifyCandidateComplete({
      // Executor claims done with no artifacts/criteria
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('does not treat an arbitrary text artifact as verified completion', () => {
    const result = verifyCandidateComplete({
      artifacts: [
        createTextArtifact({
          title: 'metadata shortcut',
          text: '标题：Context engineering；域名：example.test',
          sources: [{ url: 'https://example.test' }],
        }),
      ],
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('INCONCLUSIVE');
  });

  it('rejects when required artifact criteria fail even if summary would look fine', () => {
    const artifact = createTableArtifact({
      title: 'bad',
      columns: ['name'],
      rows: [],
      sources: [],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_exists' }, { kind: 'artifact_row_count', operator: '>=', expected: 5 }],
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('FAIL');
    expect(result.artifactEvidence.some(e => e.kind === 'artifact_row_count' && !e.passed)).toBe(true);
  });

  it('LLM judge cannot override deterministic artifact failure', () => {
    const artifact = createTableArtifact({
      title: 't',
      columns: ['name'],
      rows: [{ name: 'x' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_row_count', operator: '>=', expected: 99 }],
      llmJudge: { passed: true, reason: 'summary looks done' },
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('FAIL');
  });
});

describe('022-ARTIFACT-01 schema row source', () => {
  it('passes only when schema + rows + sources all hold', () => {
    const good = createTableArtifact({
      title: 'products',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'A', price: '1', rating: '5' },
        { name: 'B', price: '9', rating: '4' },
      ],
      sources: [{ url: 'https://fixture.local/products' }],
    });
    const pass = verifyCandidateComplete({
      artifacts: [good],
      artifactCriteria: [
        { kind: 'artifact_exists' },
        { kind: 'artifact_schema', expected: ['name', 'price', 'rating'] },
        { kind: 'artifact_row_count', operator: '>=', expected: 2 },
        { kind: 'artifact_source_count', operator: '>=', expected: 1 },
      ],
    });
    expect(pass.verdict).toBe('PASS');
    expect(pass.complete).toBe(true);

    const missingCol = createTableArtifact({
      title: 'products',
      columns: ['name', 'price'],
      rows: [{ name: 'A', price: '1' }],
      sources: [{ url: 'https://x' }],
    });
    const failSchema = verifyCandidateComplete({
      artifacts: [missingCol],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(failSchema.verdict).toBe('FAIL');

    const noSource = createTableArtifact({
      title: 'products',
      columns: ['name'],
      rows: [{ name: 'A' }],
      sources: [],
    });
    const failSrc = verifyCandidateComplete({
      artifacts: [noSource],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 1 }],
    });
    expect(failSrc.verdict).toBe('FAIL');
  });

  it('does not pass on summary string alone', () => {
    const result = verifyCandidateComplete({
      artifacts: [],
      artifactCriteria: [{ kind: 'artifact_exists', required: true }],
    });
    expect(result.complete).toBe(false);
  });
});
