import type { ContextAnchor, ContextBlock, ContextBundle, TrustLevel } from '@extension/context-engine';
import { cleanCueText, slug, uniqueAnchor } from './text';

export interface YouTubeCue {
  /** Cue start in seconds. */
  start: number;
  /** Cue end in seconds, when known. */
  end?: number;
  text: string;
}

export interface YouTubeChapter {
  title: string;
  /** Chapter start in seconds. */
  start: number;
}

export interface YouTubeMetadata {
  title?: string;
  url?: string;
  videoId?: string;
  chapters?: readonly YouTubeChapter[];
  trustLevel?: TrustLevel;
}

export interface YouTubeTranscriptOptions {
  /** Merge short cues until a paragraph reaches this many characters. */
  minParagraphChars?: number;
  /** Hard ceiling: a new paragraph starts before exceeding this. */
  maxParagraphChars?: number;
  /** Pause in seconds that breaks a running paragraph. */
  gapSeconds?: number;
  /** Absolute pause in seconds that always breaks, even below min. */
  longGapSeconds?: number;
}

interface ParagraphGroup {
  start: number;
  end: number;
  text: string;
}

const DEFAULT_MIN_PARAGRAPH = 120;
const DEFAULT_MAX_PARAGRAPH = 300;
const DEFAULT_GAP_SECONDS = 2;
const DEFAULT_LONG_GAP_SECONDS = 5;
const SNIPPET_CHARS = 48;

/**
 * Convert YouTube caption cues into a ContextBundle.
 * Consecutive short cues merge into paragraph blocks; the paragraph anchor
 * carries the start timestamp. Chapters become heading blocks with time links.
 */
export function parseYouTubeTranscript(
  cues: readonly YouTubeCue[],
  metadata: YouTubeMetadata = {},
  options: YouTubeTranscriptOptions = {},
): ContextBundle {
  const min = options.minParagraphChars ?? DEFAULT_MIN_PARAGRAPH;
  const max = options.maxParagraphChars ?? DEFAULT_MAX_PARAGRAPH;
  const gap = options.gapSeconds ?? DEFAULT_GAP_SECONDS;
  const longGap = options.longGapSeconds ?? DEFAULT_LONG_GAP_SECONDS;
  const chapters = [...(metadata.chapters ?? [])].sort((a, b) => a.start - b.start);
  const clean = cleanCues(cues);
  const groups = groupCues(clean, chapters, min, max, gap, longGap);

  const blocks: ContextBlock[] = [];
  const anchors: ContextAnchor[] = [];
  const usedIds = new Set<string>();

  const pushChapter = (chapter: YouTubeChapter) => {
    const blockIndex = blocks.length;
    blocks.push({ type: 'heading', level: 2, text: chapter.title });
    anchors.push({
      id: uniqueAnchor(slug(chapter.title), usedIds),
      blockIndex,
      text: chapter.title,
      href: timestampHref(metadata, chapter.start),
    });
  };

  const pushGroup = (group: ParagraphGroup) => {
    const blockIndex = blocks.length;
    blocks.push({ type: 'paragraph', text: group.text });
    anchors.push({
      id: uniqueAnchor(`t-${Math.round(group.start * 1000)}`, usedIds),
      blockIndex,
      text: group.text.slice(0, SNIPPET_CHARS),
      href: timestampHref(metadata, group.start),
    });
  };

  let chapterCursor = 0;
  for (const group of groups) {
    while (chapterCursor < chapters.length && chapters[chapterCursor].start <= group.start) {
      pushChapter(chapters[chapterCursor]);
      chapterCursor += 1;
    }
    pushGroup(group);
  }
  for (let i = chapterCursor; i < chapters.length; i += 1) pushChapter(chapters[i]);

  return {
    sourceType: 'text',
    title: metadata.title?.trim() ?? '',
    url: metadata.url?.trim() ?? '',
    blocks,
    anchors,
    trustLevel: metadata.trustLevel ?? 'untrusted',
  };
}

/**
 * Normalize raw YouTube timedtext: XML (`<text start= dur=>`) or JSON
 * (`{"events":[{"tStartMs","segs":[{"utf8"}]}]}` or a plain cue array).
 * Decodes entities, drops empty cues, removes duplicate cues, sorts by start.
 */
export function normalizeYouTubeTimedText(input: string): YouTubeCue[] {
  const raw = input.trim();
  if (!raw) return [];
  const parsed = raw.startsWith('<')
    ? parseTimedTextXml(raw)
    : raw.startsWith('{') || raw.startsWith('[')
      ? parseTimedTextJson(raw)
      : [];
  return dedupeCues([...parsed].sort((a, b) => a.start - b.start));
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(rest).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function cleanCues(cues: readonly YouTubeCue[]): YouTubeCue[] {
  const cleaned = cues
    .map(cue => ({ start: Number.isFinite(cue.start) ? cue.start : 0, end: cue.end, text: cleanCueText(cue.text) }))
    .filter(cue => cue.text.length > 0)
    .sort((a, b) => a.start - b.start);
  return dedupeCues(cleaned);
}

function groupCues(
  cues: YouTubeCue[],
  chapters: YouTubeChapter[],
  min: number,
  max: number,
  gap: number,
  longGap: number,
): ParagraphGroup[] {
  const groups: ParagraphGroup[] = [];
  let current: ParagraphGroup | null = null;
  for (const cue of cues) {
    if (!current) {
      current = { start: cue.start, end: cue.end ?? cue.start, text: cue.text };
      continue;
    }
    const joinedLength = current.text.length + 1 + cue.text.length;
    const crossesChapter = chapters.some(ch => ch.start > current!.start && ch.start <= cue.start);
    const silence = cue.start - current.end;
    const closeAfterPause = silence > longGap || (silence > gap && current.text.length >= min);
    if (crossesChapter || joinedLength > max || closeAfterPause) {
      groups.push(current);
      current = { start: cue.start, end: cue.end ?? cue.start, text: cue.text };
      continue;
    }
    current.text = `${current.text} ${cue.text}`;
    current.end = cue.end ?? cue.start;
  }
  if (current) groups.push(current);
  return groups.map(group => ({ ...group, text: cleanCueText(group.text) }));
}

function dedupeCues(cues: YouTubeCue[]): YouTubeCue[] {
  const result: YouTubeCue[] = [];
  for (const cue of cues) {
    const previous = result.at(-1);
    if (previous && previous.text === cue.text && Math.abs(previous.start - cue.start) < 0.4) continue;
    result.push(cue);
  }
  return result;
}

function timestampHref(metadata: YouTubeMetadata, start: number): string {
  const t = Math.max(0, Math.floor(start));
  const id = metadata.videoId?.trim();
  if (id) return `https://www.youtube.com/watch?v=${id}&t=${t}`;
  const url = metadata.url?.trim();
  if (url) {
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      parsed.searchParams.set('t', String(t));
      return parsed.href;
    } catch {
      return `${url}#t=${t}`;
    }
  }
  return `#t=${t}`;
}

function parseIntoSegments(raw: string, tagPattern: RegExp): YouTubeCue[] {
  const cues: YouTubeCue[] = [];
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(raw)) !== null) {
    const attributes = match[2] ?? '';
    const body = match[3] ?? '';
    const text = cleanCueText(body.replace(/<[^>]*>/g, ''));
    if (!text) continue;
    const start = xmlNumber(attributes, ['start', 't']) ?? 0;
    const dur = xmlNumber(attributes, ['dur', 'd']);
    cues.push({ start, end: dur != null ? start + dur : undefined, text });
  }
  return cues;
}

function parseTimedTextXml(raw: string): YouTubeCue[] {
  return parseIntoSegments(raw, /<(text|p)\b([^>]*)>([\s\S]*?)<\/(?:text|p)>/g);
}

function xmlNumber(attributes: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const match = attributes.match(new RegExp(`\\b${key}="([^"]*)"`));
    if (!match) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) return value;
  }
  return undefined;
}

type RawDict = Record<string, unknown>;

function parseTimedTextJson(raw: string): YouTubeCue[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (Array.isArray(value)) return value.flatMap(jsonCue);
  if (value && typeof value === 'object') {
    const events = (value as RawDict).events;
    if (Array.isArray(events)) return events.flatMap(eventCue);
    return jsonCue(value);
  }
  return [];
}

function eventCue(event: unknown): YouTubeCue[] {
  if (!event || typeof event !== 'object') return [];
  const dict = event as RawDict;
  const segs = Array.isArray(dict.segs) ? dict.segs : [];
  const text = segs.length
    ? segs
        .map(segment => (segment && typeof segment === 'object' ? String((segment as RawDict).utf8 ?? '') : ''))
        .join('')
    : String(dict.utf8 ?? dict.text ?? '');
  const start = pickNumber(dict, ['tStartMs', 'startMs'], ['start', 't']) ?? 0;
  const end = endFrom(dict, start);
  return text.trim() ? [{ start, end, text: cleanCueText(text) }] : [];
}

function jsonCue(item: unknown): YouTubeCue[] {
  if (!item || typeof item !== 'object') return [];
  const dict = item as RawDict;
  const text = String(dict.text ?? dict.utf8 ?? '');
  const start = pickNumber(dict, ['tStartMs', 'startMs'], ['start', 't']) ?? 0;
  const end = endFrom(dict, start);
  return text.trim() ? [{ start, end, text: cleanCueText(text) }] : [];
}

function endFrom(dict: RawDict, start: number): number | undefined {
  const absolute = pickNumber(dict, [], ['end']);
  if (absolute != null) return absolute;
  const duration = pickNumber(dict, ['dDurationMs', 'durationMs'], ['dur']);
  return duration != null ? start + duration : undefined;
}

function pickNumber(dict: RawDict, msKeys: string[], secondKeys: string[]): number | undefined {
  for (const key of msKeys) {
    const value = toFinite(dict[key]);
    if (value != null) return value / 1000;
  }
  for (const key of secondKeys) {
    const value = toFinite(dict[key]);
    if (value != null) return value;
  }
  return undefined;
}

function toFinite(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}
