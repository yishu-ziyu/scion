import { describe, expect, it } from 'vitest';
import { createTableArtifact } from '../artifact';
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
