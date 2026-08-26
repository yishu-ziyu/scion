export type ContextSourceType = 'webpage' | 'selection' | 'document' | 'text';
export type TrustLevel = 'untrusted' | 'user-selected' | 'trusted';

interface TextBlock {
  text: string;
}

export interface HeadingBlock extends TextBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface ParagraphBlock extends TextBlock {
  type: 'paragraph';
  omitted?: true;
}

export interface ListBlock {
  type: 'list';
  ordered: boolean;
  items: string[];
}

export interface TableBlock {
  type: 'table';
  rows: string[][];
}

export interface LinkBlock extends TextBlock {
  type: 'link';
  href: string;
}

export type ContextBlock = HeadingBlock | ParagraphBlock | ListBlock | TableBlock | LinkBlock;

export interface ContextAnchor {
  id: string;
  blockIndex: number;
  text: string;
  href?: string;
}

export interface ContextBundle {
  sourceType: ContextSourceType;
  title: string;
  url: string;
  blocks: ContextBlock[];
  anchors: ContextAnchor[];
  trustLevel: TrustLevel;
}

export function contextBlockText(block: ContextBlock): string {
  if (block.type === 'list') return block.items.join('\n');
  if (block.type === 'table') return block.rows.map(row => row.join('\t')).join('\n');
  return block.text;
}

export function contextBlockCharacters(block: ContextBlock): number {
  return contextBlockText(block).length;
}
