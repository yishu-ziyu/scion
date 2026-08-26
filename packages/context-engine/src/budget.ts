import { contextBlockCharacters, type ContextBlock } from './blocks';

const OMISSION: ContextBlock = { type: 'paragraph', text: '[…]', omitted: true };

export function fitToContext(blocks: readonly ContextBlock[], maxChars: number): ContextBlock[] {
  const limit = Math.max(0, Math.floor(maxChars));
  if (limit === 0 || blocks.length === 0) return [];
  if (totalCharacters(blocks) <= limit) return [...blocks];

  const selected = selectWithinBudget(blocks, limit);
  if (selected.size === 0) return truncateBlock(blocks[0], limit);
  return materialize(blocks, selected);
}

function selectWithinBudget(blocks: readonly ContextBlock[], limit: number): Set<number> {
  const selected = selectHeadings(blocks, limit - contextBlockCharacters(OMISSION));
  const remaining = limit - contextBlockCharacters(OMISSION) - totalSelected(blocks, selected);
  addEdgeBlocks(blocks, selected, remaining);
  return selected;
}

function selectHeadings(blocks: readonly ContextBlock[], budget: number): Set<number> {
  const selected = new Set<number>();
  let remaining = budget;
  blocks.forEach((block, index) => {
    const size = contextBlockCharacters(block);
    if (block.type === 'heading' && size <= remaining) {
      selected.add(index);
      remaining -= size;
    }
  });
  return selected;
}

function addEdgeBlocks(blocks: readonly ContextBlock[], selected: Set<number>, budget: number): void {
  let remaining = budget;
  for (let offset = 0; offset < blocks.length && remaining > 0; offset += 1) {
    const left = offset;
    const right = blocks.length - offset - 1;
    if (left > right) return;
    remaining -= addIfFits(blocks, selected, left, remaining);
    if (right !== left) remaining -= addIfFits(blocks, selected, right, remaining);
  }
}

function addIfFits(blocks: readonly ContextBlock[], selected: Set<number>, index: number, remaining: number): number {
  if (selected.has(index)) return 0;
  const size = contextBlockCharacters(blocks[index]);
  if (size > remaining) return 0;
  selected.add(index);
  return size;
}

function materialize(blocks: readonly ContextBlock[], selected: Set<number>): ContextBlock[] {
  const indexes = [...selected].sort((a, b) => a - b);
  if (indexes.length === blocks.length) return indexes.map(index => blocks[index]);
  const result: ContextBlock[] = [];
  let marked = false;
  let previous = -1;
  for (const index of indexes) {
    if (!marked && index > previous + 1) {
      result.push(OMISSION);
      marked = true;
    }
    result.push(blocks[index]);
    previous = index;
  }
  if (!marked && previous < blocks.length - 1) result.push(OMISSION);
  return result;
}

function truncateBlock(block: ContextBlock, limit: number): ContextBlock[] {
  if (limit <= 0) return [];
  if (block.type === 'list') {
    const text = block.items.join('\n').slice(0, limit).trim();
    return text ? [{ ...block, items: [text] }] : [];
  }
  if (block.type === 'table') {
    const text = block.rows.flat().join(' ').slice(0, limit).trim();
    return text ? [{ type: 'paragraph', text }] : [];
  }
  const text = block.text.slice(0, limit).trim();
  return text ? [{ ...block, text }] : [];
}

function totalSelected(blocks: readonly ContextBlock[], selected: Set<number>): number {
  return [...selected].reduce((sum, index) => sum + contextBlockCharacters(blocks[index]), 0);
}

function totalCharacters(blocks: readonly ContextBlock[]): number {
  return blocks.reduce((sum, block) => sum + contextBlockCharacters(block), 0);
}
