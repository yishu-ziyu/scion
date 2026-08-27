import type { ContextBlock, ContextBundle } from '@extension/context-engine';
import { describe, expect, it } from 'vitest';
import { createWisebase, type ChunkRecord, type SourceRecord, type WisebasePersistence } from '../index';
import { chunkContextBundle } from '../src/chunk';

class MemoryPersistence implements WisebasePersistence {
  readonly sources = new Map<string, SourceRecord>();
  readonly chunks = new Map<string, ChunkRecord>();
  replacements = 0;

  async listSources(): Promise<SourceRecord[]> {
    return [...this.sources.values()];
  }

  async listChunks(): Promise<ChunkRecord[]> {
    return [...this.chunks.values()];
  }

  async replaceSource(source: SourceRecord, chunks: readonly ChunkRecord[]): Promise<void> {
    this.replacements += 1;
    this.sources.set(source.id, source);
    for (const [id, chunk] of this.chunks) {
      if (chunk.sourceId === source.id) this.chunks.delete(id);
    }
    for (const chunk of chunks) this.chunks.set(chunk.id, chunk);
  }

  async deleteSource(sourceId: string): Promise<void> {
    this.sources.delete(sourceId);
    for (const [id, chunk] of this.chunks) {
      if (chunk.sourceId === sourceId) this.chunks.delete(id);
    }
  }
}

function bundle(
  blocks: ContextBlock[],
  options: Partial<Pick<ContextBundle, 'title' | 'url' | 'anchors' | 'sourceType' | 'trustLevel'>> = {},
): ContextBundle {
  return {
    sourceType: options.sourceType ?? 'webpage',
    title: options.title ?? 'Test source',
    url: options.url ?? 'https://example.com/source',
    blocks,
    anchors: options.anchors ?? [],
    trustLevel: options.trustLevel ?? 'untrusted',
  };
}

function tickingClock(start = 1_000): () => number {
  let now = start;
  return () => {
    now += 1;
    return now;
  };
}

describe('Wisebase retrieval', () => {
  it('retrieves English source text with a scored snippet', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence);
    const ingested = await wisebase.ingestSource(
      bundle(
        [
          { type: 'heading', level: 1, text: 'Plant energy' },
          { type: 'paragraph', text: 'Photosynthesis turns sunlight into chemical energy inside plant cells.' },
        ],
        { title: 'Plant energy', url: 'https://biology.example/photosynthesis' },
      ),
    );

    const results = await wisebase.searchSources('sunlight energy');

    expect(results[0]).toMatchObject({
      sourceId: ingested.sourceId,
      title: 'Plant energy',
      url: 'https://biology.example/photosynthesis',
    });
    expect(results[0].score).toBeGreaterThan(0);
    expect(results[0].snippet).toContain('sunlight');
  });

  it('retrieves Chinese source text without requiring spaces', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence);
    await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: '知识图谱可以连接分散的数据，并支持语义检索。' }], {
        url: 'https://example.cn/knowledge-graph',
      }),
    );

    const results = await wisebase.searchSources('语义检索');

    expect(results).toHaveLength(1);
    expect(results[0].snippet).toContain('语义检索');
    expect(results[0].score).toBeGreaterThan(0);
    expect(await wisebase.searchSources('图')).toHaveLength(1);
  });

  it('does not match a multi-character Chinese query on one shared character', async () => {
    const wisebase = createWisebase(new MemoryPersistence());
    await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: '语文课程安排已经发布。' }], { url: 'https://example.cn/course' }),
    );

    expect(await wisebase.searchSources('语义检索')).toEqual([]);
  });

  it('uses search normalization when centering an accented English snippet', async () => {
    const wisebase = createWisebase(new MemoryPersistence());
    await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: `${'Long unrelated prefix. '.repeat(12)}Café target marker.` }]),
    );

    const results = await wisebase.searchSources('cafe', { snippetChars: 40 });

    expect(results[0].snippet).toContain('Café');
  });

  it('returns the retained source anchor for a matching later chunk', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence, { maxChars: 42 });
    await wisebase.ingestSource(
      bundle(
        [
          { type: 'heading', level: 2, text: 'Physics' },
          { type: 'paragraph', text: 'A short introduction.' },
          { type: 'paragraph', text: 'Quantum tunnelling crosses a barrier.' },
        ],
        { anchors: [{ id: 'physics', blockIndex: 0, text: 'Physics' }] },
      ),
    );

    const results = await wisebase.searchSources('tunnelling');

    expect(results[0].anchor).toMatchObject({ id: 'physics', blockIndex: 0 });
  });

  it('carries PDF-style href anchors into later paragraph chunks', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence, { maxChars: 24 });
    await wisebase.ingestSource(
      bundle(
        [
          { type: 'heading', level: 2, text: 'Page 7' },
          { type: 'paragraph', text: 'A later paragraph contains the platypus fact.' },
        ],
        {
          sourceType: 'document',
          anchors: [{ id: 'page-7', blockIndex: 0, text: 'Page 7', href: '#page=7' }],
        },
      ),
    );

    expect((await wisebase.searchSources('platypus'))[0].anchor).toMatchObject({
      id: 'page-7',
      href: '#page=7',
    });
  });

  it('returns an empty result for an empty library or query', async () => {
    const wisebase = createWisebase(new MemoryPersistence());

    expect(await wisebase.searchSources('anything')).toEqual([]);
    expect(await wisebase.searchSources('   ')).toEqual([]);
  });
});

describe('Wisebase ingestion lifecycle', () => {
  it('deduplicates a canonical URL plus normalized content hash', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence, { now: tickingClock() });
    const first = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'Stable   content\nwith whitespace.' }], {
        url: 'HTTPS://Example.com:443/article?b=2&a=1#intro',
      }),
    );
    const duplicate = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'Stable content with whitespace.' }], {
        url: 'https://example.com/article?b=2&a=1',
      }),
    );

    expect(first.status).toBe('created');
    expect(duplicate).toMatchObject({ status: 'duplicate', sourceId: first.sourceId });
    expect(persistence.sources).toHaveLength(1);
    expect(persistence.replacements).toBe(1);
    expect([...persistence.sources.values()][0].canonicalUrl).toBe('https://example.com/article?b=2&a=1');
  });

  it('updates the same canonical source and replaces stale chunks', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence, { maxChars: 80, now: tickingClock() });
    const first = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'Legacy albatross material.' }], {
        url: 'https://example.com/changing',
      }),
    );
    const updated = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'Current narwhal material.' }], {
        url: 'https://example.com/changing#latest',
      }),
    );

    expect(updated).toMatchObject({ status: 'updated', sourceId: first.sourceId });
    expect([...persistence.sources.values()][0].updatedAt).toBeGreaterThan(
      [...persistence.sources.values()][0].createdAt,
    );
    expect(await wisebase.searchSources('albatross')).toEqual([]);
    expect((await wisebase.searchSources('narwhal'))[0]).toMatchObject({ sourceId: first.sourceId });
  });

  it('keeps changed selections at the same URL as separate snapshots', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence);
    const first = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'First selected passage.' }], {
        sourceType: 'selection',
        trustLevel: 'user-selected',
      }),
    );
    const second = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'Second selected passage.' }], {
        sourceType: 'selection',
        trustLevel: 'user-selected',
      }),
    );

    expect(second).toMatchObject({ status: 'created' });
    expect(second.sourceId).not.toBe(first.sourceId);
    expect(persistence.sources).toHaveLength(2);
  });

  it('rejects an empty or omitted-only source', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence);

    await expect(wisebase.ingestSource(bundle([]))).rejects.toThrow('empty source');
    await expect(wisebase.ingestSource(bundle([{ type: 'paragraph', text: '[…]', omitted: true }]))).rejects.toThrow(
      'empty source',
    );
    expect(persistence.replacements).toBe(0);
  });

  it('deletes a source and all of its searchable chunks', async () => {
    const persistence = new MemoryPersistence();
    const wisebase = createWisebase(persistence);
    const ingested = await wisebase.ingestSource(
      bundle([{ type: 'paragraph', text: 'A uniquely removable porcupine source.' }]),
    );

    await wisebase.removeSource(ingested.sourceId);
    await wisebase.removeSource(ingested.sourceId);

    expect(persistence.sources).toHaveLength(0);
    expect(persistence.chunks).toHaveLength(0);
    expect(await wisebase.searchSources('porcupine')).toEqual([]);
  });
});

describe('semantic chunking', () => {
  it('keeps paragraph boundaries, obeys maxChars, and carries the nearest heading anchor', () => {
    const context = bundle(
      [
        { type: 'heading', level: 1, text: 'Overview' },
        { type: 'paragraph', text: 'Short first paragraph.' },
        { type: 'paragraph', text: 'Quantum tunnelling remains in the anchored section.' },
        { type: 'heading', level: 2, text: 'Next section' },
        { type: 'paragraph', text: 'Separate closing paragraph.' },
      ],
      {
        anchors: [
          { id: 'overview', blockIndex: 0, text: 'Overview' },
          { id: 'next-section', blockIndex: 3, text: 'Next section' },
        ],
      },
    );

    const chunks = chunkContextBundle(context, 'source-1', { maxChars: 58 });
    const quantum = chunks.find(chunk => chunk.text.includes('Quantum tunnelling'));

    expect(chunks.every(chunk => chunk.text.length <= 58)).toBe(true);
    expect(chunks.some(chunk => chunk.text.includes('Short first paragraph.'))).toBe(true);
    expect(chunks.every(chunk => !(chunk.text.includes('Overview') && chunk.text.includes('Next section')))).toBe(true);
    expect(quantum?.anchor).toMatchObject({ id: 'overview', blockIndex: 0 });
  });

  it('splits a single oversized paragraph at readable punctuation boundaries', () => {
    const chunks = chunkContextBundle(
      bundle([
        { type: 'paragraph', text: 'First complete sentence. Second complete sentence. Third complete sentence.' },
      ]),
      'source-2',
      { maxChars: 32 },
    );

    expect(chunks.every(chunk => chunk.text.length <= 32)).toBe(true);
    expect(chunks[0].text).toBe('First complete sentence.');
    expect(chunks.map(chunk => chunk.text).join(' ')).toContain('Second complete sentence.');
  });
});
