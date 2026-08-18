/**
 * Filter InteractiveElementDigest lists by a user/model query.
 * Empty query returns the original list and order.
 */
import type { InteractiveElementDigest } from './types';

export function filterInteractiveElements(
  elements: InteractiveElementDigest[],
  query?: string,
): InteractiveElementDigest[] {
  const q = query?.trim() ?? '';
  if (!q) return elements;

  const scored = elements
    .map(element => ({ element, score: scoreInteractiveElement(element, q) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score || a.element.index - b.element.index);

  return scored.map(row => row.element);
}

export function filterElementsTextByIndexes(elementsText: string, indexes: Set<number>): string {
  if (!elementsText) return '';
  return elementsText
    .split('\n')
    .filter(line => {
      const match = line.match(/\[(\d+)\]/);
      return match ? indexes.has(Number(match[1])) : false;
    })
    .join('\n');
}

export function formatInteractiveDigest(element: InteractiveElementDigest): string {
  const tag = (element.tagName || 'el').toLowerCase();
  const bits = [
    element.type ? `type=${element.type}` : '',
    element.role ? `role=${element.role}` : '',
    element.text ? `"${element.text}"` : '',
    element.label && element.label !== element.text ? `label=${element.label}` : '',
    element.value && element.value !== element.text ? `value=${element.value}` : '',
  ].filter(Boolean);
  return `[${element.index}] <${tag}${bits.length ? ` ${bits.join(' ')}` : ''} />`;
}

export function formatInteractiveList(elements: InteractiveElementDigest[]): string {
  if (!elements.length) return 'empty interactive list';
  return elements.map(formatInteractiveDigest).join('\n');
}

export function isSubmitIntentQuery(query: string): boolean {
  const trimmed = query.trim().toLowerCase();
  return trimmed === '提交' || trimmed === 'submit';
}

export function matchesSubmitKeepRule(element: InteractiveElementDigest): boolean {
  if (isSubmitType(element)) return true;
  return isButtonLike(element) && textLooksLikeSubmit(element);
}

export function scoreInteractiveElement(element: InteractiveElementDigest, query: string): number {
  if (isSubmitIntentQuery(query)) {
    const visible = visibleCopy(element).toLowerCase();
    if ((isSubmitType(element) || isButtonLike(element)) && (visible === '提交' || visible === 'submit')) {
      return 100;
    }
    if (isButtonLike(element) && textLooksLikeSubmit(element)) return 80;
    if (isSubmitType(element)) return 70;
    return 0;
  }

  const hay = searchableCopy(element);
  const q = query.trim();
  const qLower = q.toLowerCase();
  if (!hay) return 0;

  if ((element.type || '').toLowerCase() === qLower || (element.role || '').toLowerCase() === qLower) {
    return 85;
  }
  if (visibleCopy(element).toLowerCase() === qLower) return 80;
  if (containsQuery(hay, q)) {
    if (visibleCopy(element).toLowerCase().startsWith(qLower)) return 60;
    return 40;
  }
  return 0;
}

function isSubmitType(element: InteractiveElementDigest): boolean {
  return (element.type || '').toLowerCase() === 'submit';
}

function isButtonLike(element: InteractiveElementDigest): boolean {
  const tag = (element.tagName || '').toLowerCase();
  const role = (element.role || '').toLowerCase();
  return tag === 'button' || role === 'button';
}

function textLooksLikeSubmit(element: InteractiveElementDigest): boolean {
  return visibleFields(element).some(field => {
    if (/提交/.test(field)) return true;
    return /(?:^|[^a-z])submit(?:[^a-z]|$)/i.test(field);
  });
}

function visibleFields(element: InteractiveElementDigest): string[] {
  return [element.text, element.label, element.value, element.placeholder].filter((part): part is string =>
    Boolean(part && part.trim()),
  );
}

function visibleCopy(element: InteractiveElementDigest): string {
  return visibleFields(element).join(' ').replace(/\s+/g, ' ').trim();
}

function searchableCopy(element: InteractiveElementDigest): string {
  return [visibleCopy(element), element.name, element.id, element.type, element.role, element.tagName]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsQuery(haystack: string, query: string): boolean {
  const hay = haystack.toLowerCase();
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (/[\u3400-\u9fff]/.test(query) && hay.includes(q)) return true;
  const tokens = q.match(/[a-z0-9]+/g) ?? [];
  if (!tokens.length) return hay.includes(q);
  return tokens.every(token => new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(token)}(?:[^a-z0-9]|$)`, 'i').test(haystack));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
