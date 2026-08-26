import type { ContextBundle, ParagraphBlock } from './blocks';

export interface SelectionContextOptions {
  title?: string;
  url?: string;
}

export function createSelectionContext(selection: string, options: SelectionContextOptions = {}): ContextBundle {
  const blocks: ParagraphBlock[] = selection
    .split(/\n\s*\n/)
    .map(text => text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .map(text => ({ type: 'paragraph', text }));

  return {
    sourceType: 'selection',
    title: options.title?.trim() ?? '',
    url: options.url?.trim() ?? '',
    blocks,
    anchors: [],
    trustLevel: 'user-selected',
  };
}
