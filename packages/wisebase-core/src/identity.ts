import type { ContextBlock, ContextBundle, ContextSourceType } from '@extension/context-engine';

export function canonicalizeSourceUrl(value: string): string {
  const input = value.trim();
  if (!input) return '';
  try {
    const url = new URL(input);
    url.hash = '';
    return url.toString();
  } catch {
    return input.split('#', 1)[0].trim();
  }
}

export function normalizedSourceContent(contextBundle: ContextBundle): string {
  const blocks = contextBundle.blocks.flatMap(block => normalizedBlock(block));
  return blocks.length === 0 ? '' : JSON.stringify(blocks);
}

export async function sourceContentHash(contextBundle: ContextBundle): Promise<string> {
  return `sha256:${await hashText(normalizedSourceContent(contextBundle))}`;
}

export async function sourceFingerprint(
  sourceType: ContextSourceType,
  canonicalUrl: string,
  contentHash: string,
): Promise<string> {
  return `wisebase:${await hashText(JSON.stringify([sourceType, canonicalUrl, contentHash]))}`;
}

export async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function normalizedBlock(block: ContextBlock): unknown[] {
  if (block.type === 'paragraph' && block.omitted) return [];
  if (block.type === 'list') {
    const items = block.items.map(normalizeText).filter(Boolean);
    return items.length ? [['list', block.ordered, items]] : [];
  }
  if (block.type === 'table') {
    const rows = block.rows.map(row => row.map(normalizeText).filter(Boolean)).filter(row => row.length > 0);
    return rows.length ? [['table', rows]] : [];
  }
  const text = normalizeText(block.text);
  if (!text) return [];
  if (block.type === 'heading') return [['heading', block.level, text]];
  if (block.type === 'link') return [['link', text, canonicalizeSourceUrl(block.href)]];
  return [['paragraph', text]];
}
