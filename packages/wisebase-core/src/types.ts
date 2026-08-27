import type { ContextAnchor, ContextBundle, ContextSourceType, TrustLevel } from '@extension/context-engine';

export interface SourceRecord {
  id: string;
  fingerprint: string;
  canonicalUrl: string;
  contentHash: string;
  sourceType: ContextSourceType;
  title: string;
  trustLevel: TrustLevel;
  createdAt: number;
  updatedAt: number;
}

export interface ChunkRecord {
  id: string;
  sourceId: string;
  index: number;
  text: string;
  startBlockIndex: number;
  endBlockIndex: number;
  anchor?: ContextAnchor;
}

/**
 * Persistence owns atomic source/chunk replacement so this core package stays
 * independent from IndexedDB and extension APIs.
 */
export interface WisebasePersistence {
  listSources(): Promise<readonly SourceRecord[]>;
  listChunks(): Promise<readonly ChunkRecord[]>;
  replaceSource(source: SourceRecord, chunks: readonly ChunkRecord[]): Promise<void>;
  deleteSource(sourceId: string): Promise<void>;
}

export interface WisebaseOptions {
  maxChars?: number;
  now?: () => number;
}

export interface ChunkOptions {
  maxChars?: number;
}

export type IngestStatus = 'created' | 'updated' | 'duplicate';

export interface IngestSourceResult {
  status: IngestStatus;
  sourceId: string;
  fingerprint: string;
  chunkCount: number;
}

export interface SearchSourcesOptions {
  limit?: number;
  snippetChars?: number;
}

export interface SourceSearchResult {
  sourceId: string;
  score: number;
  snippet: string;
  title: string;
  url: string;
  anchor?: ContextAnchor;
}

export interface Wisebase {
  ingestSource(contextBundle: ContextBundle): Promise<IngestSourceResult>;
  removeSource(sourceId: string): Promise<void>;
  searchSources(query: string, options?: SearchSourcesOptions): Promise<SourceSearchResult[]>;
}
