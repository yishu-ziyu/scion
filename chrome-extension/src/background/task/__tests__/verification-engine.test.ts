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

  it('PASSes a text artifact when required artifact checks hold', () => {
    const artifact = createTextArtifact({
      title: 'answer',
      text: '标题：Example；域名：example.com',
      sources: [{ url: 'https://example.com' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_exists' }, { kind: 'artifact_source_count', operator: '>=', expected: 1 }],
    });
    expect(result.verdict).toBe('PASS');
    expect(result.complete).toBe(true);
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

  it('PASSes text when artifact_contains holds', () => {
    const artifact = createTextArtifact({ title: 'answer', text: 'Visible detail: Alpha' });
    const result = verifyCandidateComplete({
      artifacts: [artifact],
      artifactCriteria: [{ kind: 'artifact_contains', expected: 'Alpha', required: true }],
    });
    expect(result.verdict).toBe('PASS');
    expect(result.complete).toBe(true);
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

  it('counts rows, sources, and content across artifacts, not only the first', () => {
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
        { name: 'Beta', price: '2', rating: '4' },
        { name: 'Gamma', price: '3', rating: '3' },
      ],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [
        { kind: 'artifact_exists' },
        { kind: 'artifact_schema', expected: ['name', 'price', 'rating'] },
        { kind: 'artifact_row_count', operator: '>=', expected: 3 },
        { kind: 'artifact_source_count', operator: '>=', expected: 2 },
        { kind: 'artifact_contains', expected: 'Gamma' },
      ],
    });
    expect(result.verdict).toBe('PASS');
    expect(result.complete).toBe(true);
    expect(result.artifactEvidence.find(e => e.kind === 'artifact_row_count')?.observed).toBe(3);
    expect(result.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(2);
  });

  it('does not let text or empty tables pad source_count when a real table exists', () => {
    const table = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const text = createTextArtifact({
      title: 'shop-b-note',
      text: 'https://b.test/products',
      sources: [{ url: 'https://b.test/products' }],
    });
    const empty = createTableArtifact({
      title: 'shop-c',
      columns: ['name', 'price', 'rating'],
      rows: [],
      sources: [{ url: 'https://c.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [table, text, empty],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 2 }],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.complete).toBe(false);
    expect(result.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(1);
  });

  it('fails schema when a later source table leaves a required column blank', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Beta', price: '2', rating: '   ' }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.complete).toBe(false);
    const schema = result.artifactEvidence.find(e => e.kind === 'artifact_schema');
    expect(schema?.passed).toBe(false);
    expect(schema?.reason).toMatch(/missing_columns|empty_required_cell/);
  });

  it('fails schema when any required cell is null, omitted, or empty on a later table', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const laterNull = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Beta', price: '2', rating: null }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const laterOmitted = createTableArtifact({
      title: 'shop-c',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Gamma', price: '3' }],
      sources: [{ url: 'https://c.test/products' }],
    });
    const laterPartial = createTableArtifact({
      title: 'shop-d',
      columns: ['name', 'price', 'rating'],
      rows: [
        { name: 'Delta', price: '4', rating: '4' },
        { name: 'Epsilon', price: '5', rating: '' },
      ],
      sources: [{ url: 'https://d.test/products' }],
    });
    for (const later of [laterNull, laterOmitted, laterPartial]) {
      const result = verifyCandidateComplete({
        artifacts: [first, later],
        artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
      });
      expect(result.verdict).toBe('FAIL');
      expect(result.artifactEvidence.find(e => e.kind === 'artifact_schema')?.passed).toBe(false);
    }
  });

  it('fails schema when a later source table has columns but no rows', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '5' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.artifactEvidence.find(e => e.kind === 'artifact_schema')?.passed).toBe(false);
  });

  it('fails schema when the first source table is empty even if a later table is filled', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: '1', rating: '' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Beta', price: '2', rating: '4' }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const result = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(result.verdict).toBe('FAIL');
    expect(result.complete).toBe(false);
  });

  it('fails schema when a required cell is not a real value, but keeps 0 and false', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Alpha', price: 0, rating: false }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const pass = verifyCandidateComplete({
      artifacts: [first],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(pass.verdict).toBe('PASS');

    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'price', 'rating'],
      rows: [{ name: 'Beta', price: '2', rating: {} as unknown as string }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const fail = verifyCandidateComplete({
      artifacts: [first, later],
      artifactCriteria: [{ kind: 'artifact_schema', expected: ['name', 'price', 'rating'] }],
    });
    expect(fail.verdict).toBe('FAIL');
    expect(fail.artifactEvidence.find(e => e.kind === 'artifact_schema')?.passed).toBe(false);
  });

  it('does not count sources on empty tables or non-table artifacts', () => {
    const empty = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price', 'rating'],
      rows: [],
      sources: [{ url: 'https://a.test/products' }],
    });
    const file = {
      id: 'file-1',
      type: 'file' as const,
      title: 'export',
      data: { filename: 'b.csv' },
      sources: [{ url: 'https://b.test/products' }],
      createdAt: Date.now(),
    };
    const emptyOnly = verifyCandidateComplete({
      artifacts: [empty],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 1 }],
    });
    expect(emptyOnly.verdict).toBe('FAIL');
    expect(emptyOnly.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(0);

    const table = createTableArtifact({
      title: 'shop-c',
      columns: ['name'],
      rows: [{ name: 'Alpha' }],
      sources: [{ url: 'https://c.test/products' }],
    });
    const padded = verifyCandidateComplete({
      artifacts: [table, file],
      artifactCriteria: [{ kind: 'artifact_source_count', operator: '>=', expected: 2 }],
    });
    expect(padded.verdict).toBe('FAIL');
    expect(padded.artifactEvidence.find(e => e.kind === 'artifact_source_count')?.observed).toBe(1);
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
