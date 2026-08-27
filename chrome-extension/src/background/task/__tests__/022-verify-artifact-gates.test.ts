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

  it('fails schema when a later source table is missing required columns', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price'],
      rows: [{ name: 'Beta', price: '2' }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [
        { kind: 'artifact_exists' },
        { kind: 'artifact_schema', expected: ['name', 'price', 'rating'] },
        { kind: 'artifact_row_count', operator: '>=', expected: 1 },
        { kind: 'artifact_source_count', operator: '>=', expected: 2 },
      ],
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('FAIL');
    expect(result.artifactEvidence.some(e => e.kind === 'artifact_schema' && !e.passed)).toBe(true);
  });

  it('fails row count when a later source table is empty even if the first table is enough', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name'],
      rows: [{ name: 'Alpha' }, { name: 'Keep' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name'],
      rows: [],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [{ kind: 'artifact_row_count', operator: '>=', expected: 2 }],
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('FAIL');
    expect(result.artifactEvidence.some(e => e.kind === 'artifact_row_count' && !e.passed)).toBe(true);
  });

  it('does not let a text artifact pad table source_count', () => {
    const table = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const text = createTextArtifact({
      title: 'shop-b-note',
      text: 'visited https://b.test/products',
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [table, text],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 2 }],
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('FAIL');
    expect(result.artifactEvidence.some(e => e.kind === 'artifact_source_count' && !e.passed)).toBe(true);
    expect(result.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(1);
  });

  it('counts unique sources on one populated table, not an empty table used to inflate count', () => {
    const twoSources = createTableArtifact({
      title: 'combined',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Alpha', price: '1', rating: '5' },
        { name: 'Beta', price: '2', rating: '4' },
      ],
      sources: [{ url: 'https://a.test/products' }, { url: 'https://b.test/products' }],
    });
    const pass = verifyCandidateComplete({
      artifacts: [twoSources],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 2 }],
    });
    expect(pass.verdict).toBe('PASS');
    expect(pass.complete).toBe(true);
    expect(pass.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(2);

    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name'],
      rows: [{ name: 'Alpha' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const empty = createTableArtifact({
      title: 'shop-b',
      columns: ['name'],
      rows: [],
      sources: [{ url: 'https://b.test/products' }],
    });
    const inflated = verifyCandidateComplete({
      artifacts: [first, empty],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 2 }],
    });
    expect(inflated.complete).toBe(false);
    expect(inflated.verdict).toBe('FAIL');
    expect(inflated.artifactEvidence.some(e => e.kind === 'artifact_source_count' && !e.passed)).toBe(true);
    expect(inflated.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(1);
  });

  it('fails schema when a later source table has empty required cells', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Beta', price: '2', rating: '' },
        { name: 'Gamma', price: '3', rating: '' },
      ],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(result.complete).toBe(false);
    expect(result.verdict).toBe('FAIL');
    const schema = result.artifactEvidence.find(e => e.kind === 'artifact_schema');
    expect(schema?.passed).toBe(false);
    expect(schema?.reason).toMatch(/missing_columns|empty_required_cell/);
  });
});
