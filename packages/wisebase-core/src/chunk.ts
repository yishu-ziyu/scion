import { type ContextAnchor, type ContextBlock, type ContextBundle } from '@extension/context-engine';
import { normalizeText } from './identity';
import type { ChunkOptions, ChunkRecord } from './types';

const DEFAULT_MAX_CHARS = 1_200;
const BLOCK_SEPARATOR = '\n\n';

interface Unit {
  text: string;
  blockIndex: number;
  anchor?: ContextAnchor;
}

interface DraftChunk {
  parts: string[];
  length: number;
  startBlockIndex: number;
  endBlockIndex: number;
  anchor?: ContextAnchor;
}

export function chunkContextBundle(
  contextBundle: ContextBundle,
  sourceId: string,
  options: ChunkOptions = {},
): ChunkRecord[] {
  const maxChars = positiveInteger(options.maxChars ?? DEFAULT_MAX_CHARS, 'maxChars');
  const chunks: ChunkRecord[] = [];
  let draft: DraftChunk | undefined;

  const flush = () => {
    if (!draft) return;
    const index = chunks.length;
    chunks.push({
      id: `${sourceId}:chunk:${index}`,
      sourceId,
      index,
      text: draft.parts.join(BLOCK_SEPARATOR),
      startBlockIndex: draft.startBlockIndex,
      endBlockIndex: draft.endBlockIndex,
      ...(draft.anchor ? { anchor: { ...draft.anchor } } : {}),
    });
    draft = undefined;
  };

  for (const unit of semanticUnits(contextBundle, maxChars)) {
    const block = contextBundle.blocks[unit.blockIndex];
    if (block.type === 'heading') flush();
    const addedLength = draft ? BLOCK_SEPARATOR.length + unit.text.length : unit.text.length;
    if (draft && draft.length + addedLength > maxChars) flush();
    if (!draft) draft = startDraft(unit);
    else appendUnit(draft, unit);
  }
  flush();
  return chunks;
}

function semanticUnits(contextBundle: ContextBundle, maxChars: number): Unit[] {
  const units: Unit[] = [];
  let sectionAnchor: ContextAnchor | undefined;
  contextBundle.blocks.forEach((block, blockIndex) => {
    if (block.type === 'paragraph' && block.omitted) return;
    const exactAnchors = localAnchors(contextBundle.anchors, blockIndex, contextBundle.blocks.length);
    const pageAnchor = exactAnchors.find(anchor => !anchor.href);
    const structuralAnchor =
      pageAnchor ?? (block.type === 'heading' || contextBundle.sourceType !== 'webpage' ? exactAnchors[0] : undefined);
    if (block.type === 'heading') sectionAnchor = structuralAnchor;
    else if (structuralAnchor) sectionAnchor = structuralAnchor;
    const anchor = sectionAnchor ?? exactAnchors[0];
    const text = blockText(block);
    for (const part of splitOversized(text, maxChars)) {
      units.push({
        text: part,
        blockIndex,
        ...(anchor ? { anchor: { ...anchor } } : {}),
      });
    }
  });
  return units;
}

function localAnchors(anchors: readonly ContextAnchor[], blockIndex: number, blockCount: number): ContextAnchor[] {
  return anchors.filter(anchor => anchor.blockIndex === blockIndex && anchor.blockIndex < blockCount);
}

function blockText(block: ContextBlock): string {
  if (block.type === 'list') return block.items.map(normalizeText).filter(Boolean).join('\n');
  if (block.type === 'table') {
    return block.rows
      .map(row => row.map(normalizeText).filter(Boolean).join('\t'))
      .filter(Boolean)
      .join('\n');
  }
  return normalizeText(block.text);
}

function splitOversized(value: string, maxChars: number): string[] {
  const parts: string[] = [];
  let remaining = value.trim();
  while (remaining.length > maxChars) {
    const cut = readableBreak(remaining, maxChars);
    const part = remaining.slice(0, cut).trim();
    if (part) parts.push(part);
    remaining = remaining.slice(cut).trimStart();
  }
  if (remaining) parts.push(remaining);
  return parts;
}

function readableBreak(value: string, maxChars: number): number {
  const window = value.slice(0, maxChars + 1);
  const minimum = Math.floor(maxChars / 2);
  const sentence = lastMatchEnd(window, /[.!?;。！？；](?:["'”’）】》])?/g);
  if (sentence >= minimum && sentence <= maxChars) return sentence;
  const whitespace = lastMatchStart(window.slice(0, maxChars + 1), /\s+/g);
  return whitespace >= minimum ? whitespace : maxChars;
}

function lastMatchEnd(value: string, pattern: RegExp): number {
  let end = -1;
  for (const match of value.matchAll(pattern)) end = (match.index ?? 0) + match[0].length;
  return end;
}

function lastMatchStart(value: string, pattern: RegExp): number {
  let start = -1;
  for (const match of value.matchAll(pattern)) start = match.index ?? -1;
  return start;
}

function startDraft(unit: Unit): DraftChunk {
  return {
    parts: [unit.text],
    length: unit.text.length,
    startBlockIndex: unit.blockIndex,
    endBlockIndex: unit.blockIndex,
    ...(unit.anchor ? { anchor: { ...unit.anchor } } : {}),
  };
}

function appendUnit(draft: DraftChunk, unit: Unit): void {
  draft.parts.push(unit.text);
  draft.length += BLOCK_SEPARATOR.length + unit.text.length;
  draft.endBlockIndex = unit.blockIndex;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer`);
  return value;
}
