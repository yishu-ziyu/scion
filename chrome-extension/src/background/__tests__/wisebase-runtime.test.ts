import type { ContextBundle } from '@extension/context-engine';
import {
  createWisebase,
  type ChunkRecord,
  type SourceRecord,
  type WisebasePersistence,
} from '@extension/wisebase-core';
import { describe, expect, it } from 'vitest';
import { attachRecalledSources, ingestPageBundle, recallSavedSources } from '../wisebase-runtime';

class MemoryPersistence implements WisebasePersistence {
  readonly sources = new Map<string, SourceRecord>();
  readonly chunks = new Map<string, ChunkRecord>();

  async listSources(): Promise<SourceRecord[]> {
    return [...this.sources.values()];
  }

  async listChunks(): Promise<ChunkRecord[]> {
    return [...this.chunks.values()];
  }

  async replaceSource(source: SourceRecord, chunks: readonly ChunkRecord[]): Promise<void> {
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

function bundle(text: string, url = 'https://biology.example/photosynthesis'): ContextBundle {
  return {
    sourceType: 'webpage',
    title: 'Plant energy',
    url,
    blocks: [{ type: 'paragraph', text }],
    anchors: [],
    trustLevel: 'untrusted',
  };
}

describe('wisebase runtime', () => {
  it('returns nothing for an empty page and does not throw', async () => {
    const wisebase = createWisebase(new MemoryPersistence());
    await expect(
      ingestPageBundle(
        {
          sourceType: 'webpage',
          title: '',
          url: 'https://example.test/empty',
          blocks: [],
          anchors: [],
          trustLevel: 'untrusted',
        },
        wisebase,
      ),
    ).resolves.toBeNull();
  });

  it('recalls a saved page by later wording, with title and URL', async () => {
    const wisebase = createWisebase(new MemoryPersistence());
    const ingested = await ingestPageBundle(
      bundle('Photosynthesis turns sunlight into chemical energy inside plant cells.'),
      wisebase,
    );
    const recalled = await recallSavedSources('sunlight energy', wisebase);
    expect(ingested).toMatchObject({ status: 'created' });
    expect(recalled[0]).toMatchObject({
      sourceId: ingested!.sourceId,
      title: 'Plant energy',
      url: 'https://biology.example/photosynthesis',
    });
    expect(recalled[0]!.snippet).toContain('sunlight');
  });

  it('prepends recalled sources as untrusted data ahead of the user question', () => {
    const messages = attachRecalledSources(
      [{ role: 'user', content: '光合作用怎么工作' }],
      [
        {
          sourceId: 'source:1',
          title: 'Plant energy',
          url: 'https://biology.example/photosynthesis',
          snippet: 'Photosynthesis turns sunlight into chemical energy.',
        },
      ],
    );
    expect(messages[0]?.role).toBe('system');
    expect(messages[0]?.content).toContain('<<<BEGIN_UNTRUSTED_SAVED_SOURCE>>>');
    expect(messages[0]?.content).toContain('Photosynthesis turns sunlight');
    expect(messages[0]?.content).toContain('https://biology.example/photosynthesis');
    expect(messages.at(-1)).toEqual({ role: 'user', content: '光合作用怎么工作' });
  });
});
