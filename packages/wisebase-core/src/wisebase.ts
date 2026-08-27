import type { ContextBundle } from '@extension/context-engine';
import { createSnippet, rankChunks } from './bm25';
import { chunkContextBundle } from './chunk';
import {
  canonicalizeSourceUrl,
  hashText,
  normalizedSourceContent,
  sourceContentHash,
  sourceFingerprint,
} from './identity';
import type {
  IngestSourceResult,
  SearchSourcesOptions,
  SourceRecord,
  SourceSearchResult,
  Wisebase,
  WisebaseOptions,
  WisebasePersistence,
} from './types';

const DEFAULT_SEARCH_LIMIT = 10;
const DEFAULT_SNIPPET_CHARS = 180;

export function createWisebase(persistence: WisebasePersistence, options: WisebaseOptions = {}): Wisebase {
  return {
    ingestSource: contextBundle => ingestSource(contextBundle, persistence, options),
    removeSource: sourceId => removeSource(sourceId, persistence),
    searchSources: (query, searchOptions) => searchSources(query, persistence, searchOptions),
  };
}

export async function ingestSource(
  contextBundle: ContextBundle,
  persistence: WisebasePersistence,
  options: WisebaseOptions = {},
): Promise<IngestSourceResult> {
  if (!normalizedSourceContent(contextBundle)) throw new TypeError('Cannot ingest an empty source');
  const canonicalUrl = canonicalizeSourceUrl(contextBundle.url);
  const contentHash = await sourceContentHash(contextBundle);
  const fingerprint = await sourceFingerprint(contextBundle.sourceType, canonicalUrl, contentHash);
  const sources = await persistence.listSources();
  const duplicate = findDuplicate(sources, contextBundle, canonicalUrl, contentHash, fingerprint);
  if (duplicate) return duplicateResult(duplicate, persistence);

  const current = findRefreshableSource(sources, contextBundle, canonicalUrl);
  const sourceId = current?.id ?? (await createSourceId(contextBundle, canonicalUrl, fingerprint));
  const timestamp = (options.now ?? Date.now)();
  const source: SourceRecord = {
    id: sourceId,
    fingerprint,
    canonicalUrl,
    contentHash,
    sourceType: contextBundle.sourceType,
    title: contextBundle.title.trim(),
    trustLevel: contextBundle.trustLevel,
    createdAt: current?.createdAt ?? timestamp,
    updatedAt: timestamp,
  };
  const chunks = chunkContextBundle(contextBundle, sourceId, { maxChars: options.maxChars });
  await persistence.replaceSource(source, chunks);
  return {
    status: current ? 'updated' : 'created',
    sourceId,
    fingerprint,
    chunkCount: chunks.length,
  };
}

export async function removeSource(sourceId: string, persistence: WisebasePersistence): Promise<void> {
  await persistence.deleteSource(sourceId);
}

export async function searchSources(
  query: string,
  persistence: WisebasePersistence,
  options: SearchSourcesOptions = {},
): Promise<SourceSearchResult[]> {
  if (!query.trim()) return [];
  const limit = positiveInteger(options.limit ?? DEFAULT_SEARCH_LIMIT, 'limit');
  const snippetChars = positiveInteger(options.snippetChars ?? DEFAULT_SNIPPET_CHARS, 'snippetChars');
  const [sources, chunks] = await Promise.all([persistence.listSources(), persistence.listChunks()]);
  const byId = new Map(sources.map(source => [source.id, source]));
  return rankChunks(
    chunks.filter(chunk => byId.has(chunk.sourceId)),
    query,
  )
    .slice(0, limit)
    .map(({ chunk, score }) => {
      const source = byId.get(chunk.sourceId);
      return {
        sourceId: chunk.sourceId,
        score,
        snippet: createSnippet(chunk.text, query, snippetChars),
        title: source?.title ?? '',
        url: source?.canonicalUrl ?? '',
        ...(chunk.anchor ? { anchor: { ...chunk.anchor } } : {}),
      };
    });
}

function findDuplicate(
  sources: readonly SourceRecord[],
  contextBundle: ContextBundle,
  canonicalUrl: string,
  contentHash: string,
  fingerprint: string,
): SourceRecord | undefined {
  return sources.find(
    source =>
      source.fingerprint === fingerprint &&
      source.sourceType === contextBundle.sourceType &&
      source.canonicalUrl === canonicalUrl &&
      source.contentHash === contentHash,
  );
}

async function duplicateResult(source: SourceRecord, persistence: WisebasePersistence): Promise<IngestSourceResult> {
  const chunks = await persistence.listChunks();
  return {
    status: 'duplicate',
    sourceId: source.id,
    fingerprint: source.fingerprint,
    chunkCount: chunks.filter(chunk => chunk.sourceId === source.id).length,
  };
}

function findRefreshableSource(
  sources: readonly SourceRecord[],
  contextBundle: ContextBundle,
  canonicalUrl: string,
): SourceRecord | undefined {
  if (!canonicalUrl || (contextBundle.sourceType !== 'webpage' && contextBundle.sourceType !== 'document')) {
    return undefined;
  }
  return sources.find(source => source.sourceType === contextBundle.sourceType && source.canonicalUrl === canonicalUrl);
}

async function createSourceId(
  contextBundle: ContextBundle,
  canonicalUrl: string,
  fingerprint: string,
): Promise<string> {
  const refreshable =
    canonicalUrl && (contextBundle.sourceType === 'webpage' || contextBundle.sourceType === 'document');
  const identity = refreshable ? JSON.stringify([contextBundle.sourceType, canonicalUrl]) : fingerprint;
  return `source:${await hashText(identity)}`;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
