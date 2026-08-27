import { describe, expect, it } from 'vitest';
import {
  createTableArtifact,
  createTextArtifact,
  mergeTableArtifacts,
  tableColumns,
  tableRowCount,
  uniqueArtifactSources,
} from '../artifact';

describe('mergeTableArtifacts', () => {
  it('returns the only table unchanged', () => {
    const only = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price'],
      rows: [{ name: 'Alpha', price: '1' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    expect(mergeTableArtifacts([only])).toBe(only);
  });

  it('returns null when there is no table', () => {
    expect(mergeTableArtifacts([createTextArtifact({ title: 'note', text: 'no table' })])).toBeNull();
  });

  it('unions rows and sources and stamps a source column', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name', 'price'],
      rows: [{ name: 'Alpha', price: '1' }],
      sources: [{ url: 'https://a.test/products' }],
    });
    const later = createTableArtifact({
      title: 'shop-b',
      columns: ['name', 'rating'],
      rows: [{ name: 'Beta', rating: '4' }],
      sources: [{ url: 'https://b.test/products' }],
    });
    const merged = mergeTableArtifacts([first, later]);
    expect(merged).not.toBeNull();
    expect(tableColumns(merged!)).toEqual(['name', 'price', 'rating', 'source']);
    expect(tableRowCount(merged!)).toBe(2);
    expect(uniqueArtifactSources([merged!]).map(source => source.url)).toEqual([
      'https://a.test/products',
      'https://b.test/products',
    ]);
    const rows = (merged!.data as { rows: Array<Record<string, string>> }).rows;
    expect(rows[0]).toMatchObject({ name: 'Alpha', price: '1', source: 'https://a.test/products' });
    expect(rows[1]).toMatchObject({ name: 'Beta', rating: '4', source: 'https://b.test/products' });
  });

  it('counts the same origin and path as one source even with query strings', () => {
    const first = createTableArtifact({
      title: 'shop-a',
      columns: ['name'],
      rows: [{ name: 'Alpha' }],
      sources: [{ url: 'https://a.test/products?utm=1' }],
    });
    const later = createTableArtifact({
      title: 'shop-a-again',
      columns: ['name'],
      rows: [{ name: 'Beta' }],
      sources: [{ url: 'https://a.test/products?ref=2#top' }],
    });
    expect(uniqueArtifactSources([first, later])).toEqual([
      expect.objectContaining({ url: 'https://a.test/products' }),
    ]);
    expect(mergeTableArtifacts([first, later])?.sources).toEqual([
      expect.objectContaining({ url: 'https://a.test/products' }),
    ]);
  });
});
