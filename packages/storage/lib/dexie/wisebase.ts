import type { ChunkRecord, SourceRecord, WisebasePersistence } from '@extension/wisebase-core';
import { db, type ScionDB } from './db';

export function createDexieWisebasePersistence(database: ScionDB = db): WisebasePersistence {
  return {
    listSources: async () => database.wisebaseSources.orderBy('createdAt').toArray(),
    listChunks: async () => database.wisebaseChunks.orderBy('[sourceId+index]').toArray(),
    replaceSource: async (source, chunks) => replaceSource(database, source, chunks),
    deleteSource: async sourceId => deleteSource(database, sourceId),
  };
}

async function replaceSource(database: ScionDB, source: SourceRecord, chunks: readonly ChunkRecord[]): Promise<void> {
  if (chunks.some(chunk => chunk.sourceId !== source.id)) {
    throw new TypeError('Every chunk must belong to the replaced source');
  }
  await database.transaction('rw', database.wisebaseSources, database.wisebaseChunks, async () => {
    await database.wisebaseChunks.where('sourceId').equals(source.id).delete();
    await database.wisebaseSources.put(source);
    if (chunks.length) await database.wisebaseChunks.bulkAdd([...chunks]);
  });
}

async function deleteSource(database: ScionDB, sourceId: string): Promise<void> {
  await database.transaction('rw', database.wisebaseSources, database.wisebaseChunks, async () => {
    await database.wisebaseChunks.where('sourceId').equals(sourceId).delete();
    await database.wisebaseSources.delete(sourceId);
  });
}

export const wisebasePersistence = createDexieWisebasePersistence();
