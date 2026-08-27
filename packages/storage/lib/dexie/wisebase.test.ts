import 'fake-indexeddb/auto';
import { Dexie } from 'dexie';
import { createWisebase, type ChunkRecord, type SourceRecord } from '@extension/wisebase-core';
import { afterEach, describe, expect, it } from 'vitest';
import { ScionDB } from './db';
import { createDexieWisebasePersistence } from './wisebase';

const databaseNames = new Set<string>();
const connections = new Set<Dexie>();

function databaseName(label: string): string {
  const name = `scion-wisebase-${label}-${crypto.randomUUID()}`;
  databaseNames.add(name);
  return name;
}

afterEach(async () => {
  for (const connection of connections) connection.close();
  await Promise.all([...databaseNames].map(name => Dexie.delete(name)));
  connections.clear();
  databaseNames.clear();
});

describe('Dexie Wisebase persistence', () => {
  it('atomically replaces chunks and cascades an idempotent delete', async () => {
    const database = track(new ScionDB(databaseName('replace')));
    const persistence = createDexieWisebasePersistence(database);
    const source = sourceRecord('source-1', 'fingerprint-1');
    await persistence.replaceSource(source, [
      chunkRecord(source.id, 0, 'old one'),
      chunkRecord(source.id, 1, 'old two'),
    ]);

    const updated = { ...source, fingerprint: 'fingerprint-2', contentHash: 'hash-2', updatedAt: 20 };
    await persistence.replaceSource(updated, [chunkRecord(source.id, 0, 'new only')]);

    expect(await persistence.listSources()).toEqual([updated]);
    expect((await persistence.listChunks()).map(chunk => chunk.text)).toEqual(['new only']);

    await persistence.deleteSource(source.id);
    await persistence.deleteSource(source.id);
    expect(await persistence.listSources()).toEqual([]);
    expect(await persistence.listChunks()).toEqual([]);
  });

  it('rolls back chunk replacement when the source write fails', async () => {
    const database = track(new ScionDB(databaseName('rollback')));
    const persistence = createDexieWisebasePersistence(database);
    const first = sourceRecord('source-1', 'fingerprint-1');
    const second = sourceRecord('source-2', 'fingerprint-2');
    await persistence.replaceSource(first, [chunkRecord(first.id, 0, 'must survive')]);
    await persistence.replaceSource(second, [chunkRecord(second.id, 0, 'other')]);

    await expect(
      persistence.replaceSource({ ...first, fingerprint: second.fingerprint, updatedAt: 30 }, [
        chunkRecord(first.id, 0, 'must roll back'),
      ]),
    ).rejects.toThrow();

    expect(await database.wisebaseSources.get(first.id)).toEqual(first);
    expect(
      (await database.wisebaseChunks.where('sourceId').equals(first.id).toArray()).map(chunk => chunk.text),
    ).toEqual(['must survive']);
  });

  it('persists the ingest, search, and remove flow through the adapter', async () => {
    const database = track(new ScionDB(databaseName('flow')));
    const wisebase = createWisebase(createDexieWisebasePersistence(database), { maxChars: 80 });
    const ingested = await wisebase.ingestSource({
      sourceType: 'webpage',
      title: 'Local reference',
      url: 'https://example.com/reference',
      blocks: [{ type: 'paragraph', text: 'Persistent knowledge survives between Wisebase calls.' }],
      anchors: [],
      trustLevel: 'untrusted',
    });

    expect((await wisebase.searchSources('persistent knowledge'))[0]).toMatchObject({ sourceId: ingested.sourceId });
    await wisebase.removeSource(ingested.sourceId);
    expect(await wisebase.searchSources('persistent knowledge')).toEqual([]);
  });

  it('upgrades a version 1 database without losing existing task sources', async () => {
    const name = databaseName('upgrade');
    const legacy = track(new Dexie(name));
    legacy.version(1).stores({
      chat_sessions: 'id, status, createdAt, updatedAt',
      chat_messages: 'id, sessionId, createdAt',
      tasks: 'id, status, createdAt, updatedAt',
      sources: 'id, taskId, createdAt',
      notes: 'id, taskId, createdAt',
    });
    await legacy.open();
    await legacy.table('sources').put({ id: 'legacy', taskId: 'task-1', content: 'kept', createdAt: 1, updatedAt: 1 });
    legacy.close();

    const upgraded = track(new ScionDB(name));
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    expect(await upgraded.sources.get('legacy')).toMatchObject({ taskId: 'task-1', content: 'kept' });

    const persistence = createDexieWisebasePersistence(upgraded);
    await persistence.replaceSource(sourceRecord('source-new', 'fingerprint-new'), [
      chunkRecord('source-new', 0, 'searchable'),
    ]);
    expect(await persistence.listChunks()).toHaveLength(1);
  });
});

function track<T extends Dexie>(database: T): T {
  connections.add(database);
  return database;
}

function sourceRecord(id: string, fingerprint: string): SourceRecord {
  return {
    id,
    fingerprint,
    canonicalUrl: `https://example.com/${id}`,
    contentHash: `hash-${id}`,
    sourceType: 'webpage',
    title: id,
    trustLevel: 'untrusted',
    createdAt: 10,
    updatedAt: 10,
  };
}

function chunkRecord(sourceId: string, index: number, text: string): ChunkRecord {
  return {
    id: `${sourceId}:chunk:${index}`,
    sourceId,
    index,
    text,
    startBlockIndex: index,
    endBlockIndex: index,
  };
}
