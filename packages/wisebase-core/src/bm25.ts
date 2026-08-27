import type { ChunkRecord } from './types';

const TOKEN_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+|[a-z0-9\u00c0-\u024f]+/g;
const HAN_PATTERN = /^[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+$/;
const K1 = 1.2;
const B = 0.75;

export interface RankedChunk {
  chunk: ChunkRecord;
  score: number;
}

interface IndexedChunk {
  chunk: ChunkRecord;
  frequencies: Map<string, number>;
  length: number;
}

interface NormalizedText {
  value: string;
  offsets: number[];
}

export function rankChunks(chunks: readonly ChunkRecord[], query: string): RankedChunk[] {
  const queryTerms = [...new Set(tokenizeQuery(query))];
  if (queryTerms.length === 0 || chunks.length === 0) return [];
  const documents = chunks.map(indexChunk).filter(document => document.length > 0);
  if (documents.length === 0) return [];
  const averageLength = documents.reduce((sum, document) => sum + document.length, 0) / documents.length;
  const documentFrequency = frequenciesByDocument(documents, queryTerms);

  return documents
    .map(document => ({
      chunk: document.chunk,
      score: bm25Score(document, queryTerms, documentFrequency, documents.length, averageLength),
    }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score || left.chunk.id.localeCompare(right.chunk.id));
}

export function tokenize(value: string): string[] {
  return tokenGroups(value).flatMap(group => (HAN_PATTERN.test(group) ? hanTokens(group, true) : [group]));
}

export function createSnippet(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const matchIndex = firstMatchIndex(text, query);
  const center = matchIndex < 0 ? 0 : matchIndex;
  const start = Math.max(0, Math.min(text.length - maxChars, center - Math.floor(maxChars / 3)));
  const end = Math.min(text.length, start + maxChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = `…${snippet.slice(1)}`;
  if (end < text.length) snippet = `${snippet.slice(0, -1)}…`;
  return snippet;
}

function tokenizeQuery(value: string): string[] {
  return tokenGroups(value).flatMap(group =>
    HAN_PATTERN.test(group) ? hanTokens(group, group.length === 1) : [group],
  );
}

function tokenGroups(value: string): string[] {
  return normalizeSearchText(value).match(TOKEN_PATTERN) ?? [];
}

function hanTokens(value: string, includeUnigrams: boolean): string[] {
  const characters = [...value];
  const tokens = includeUnigrams ? [...characters] : [];
  for (let index = 0; index < characters.length - 1; index += 1) {
    tokens.push(`${characters[index]}${characters[index + 1]}`);
  }
  return tokens;
}

function indexChunk(chunk: ChunkRecord): IndexedChunk {
  const tokens = tokenize(chunk.text);
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return { chunk, frequencies, length: tokens.length };
}

function frequenciesByDocument(documents: readonly IndexedChunk[], terms: readonly string[]): Map<string, number> {
  return new Map(
    terms.map(term => [term, documents.reduce((count, document) => count + Number(document.frequencies.has(term)), 0)]),
  );
}

function bm25Score(
  document: IndexedChunk,
  terms: readonly string[],
  documentFrequency: ReadonlyMap<string, number>,
  documentCount: number,
  averageLength: number,
): number {
  return terms.reduce((score, term) => {
    const termFrequency = document.frequencies.get(term) ?? 0;
    if (termFrequency === 0) return score;
    const frequency = documentFrequency.get(term) ?? 0;
    const inverseDocumentFrequency = Math.log(1 + (documentCount - frequency + 0.5) / (frequency + 0.5));
    const lengthRatio = document.length / averageLength;
    const saturation = (termFrequency * (K1 + 1)) / (termFrequency + K1 * (1 - B + B * lengthRatio));
    return score + inverseDocumentFrequency * saturation;
  }, 0);
}

function firstMatchIndex(text: string, query: string): number {
  const haystack = normalizeWithOffsets(text);
  const groups = tokenGroups(query);
  const needles = [...new Set([...groups, ...tokenizeQuery(query)])].sort((left, right) => right.length - left.length);
  let first = -1;
  for (const needle of needles) {
    const normalizedIndex = haystack.value.indexOf(needle);
    const originalIndex = haystack.offsets[normalizedIndex];
    if (normalizedIndex >= 0 && originalIndex !== undefined && (first < 0 || originalIndex < first))
      first = originalIndex;
  }
  return first;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeWithOffsets(value: string): NormalizedText {
  let normalized = '';
  const offsets: number[] = [];
  for (let offset = 0; offset < value.length; ) {
    const codePoint = value.codePointAt(offset);
    if (codePoint === undefined) break;
    const character = String.fromCodePoint(codePoint);
    const fragment = normalizeSearchText(character);
    normalized += fragment;
    for (let index = 0; index < fragment.length; index += 1) offsets.push(offset);
    offset += character.length;
  }
  return { value: normalized, offsets };
}
