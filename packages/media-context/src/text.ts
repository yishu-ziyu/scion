/**
 * Shared text helpers for media sources: XML/HTML entity decoding, whitespace
 * cleanup, CJK spacing, and stable anchor id derivation.
 */

/** CJK ideographs, kana, hangul, CJK punctuation, and fullwidth forms. */
const CJKISH = /[\u3000-\u303f\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uff00-\uffef]/;

export function decodeXmlEntities(text: string): string {
  const named = (value: string): string =>
    value
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(Number(dec)))
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&');
  // Two passes: plain input decodes once, double-encoded ("&amp;lt;") still lands.
  return named(named(text));
}

function safeFromCodePoint(code: number): string {
  return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

export function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Decode entities, join lines, drop spaces around CJK characters. */
export function cleanCueText(text: string): string {
  return stripCjkSpacing(collapseWhitespace(decodeXmlEntities(text).replace(/\r\n?/g, ' ')));
}

export function stripCjkSpacing(text: string): string {
  const re = new RegExp('(' + CJKISH.source + ')\\s+(' + CJKISH.source + ')', 'g');
  let current = text.replace(re, '$1$2');
  // A gap between two matches keeps one space (e.g. "你 好 世 界"); iterate to no-op.
  while (current !== text) {
    text = current;
    current = text.replace(re, '$1$2');
  }
  return current;
}

export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\u3400-\u9fff]+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

export function uniqueAnchor(preferred: string, used: Set<string>): string {
  let candidate = preferred || 'anchor';
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${preferred}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}
