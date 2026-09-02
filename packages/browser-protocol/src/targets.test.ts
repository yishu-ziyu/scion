import { describe, expect, it } from 'vitest';
import {
  BrowserTargetSchema,
  ElementTargetSchema,
  sanitizeUrl,
  targetPageRevision,
  validateElementTarget,
  type BrowserTarget,
} from './targets';
import { deserializeTarget, serializeTarget } from './serialize';

const pageTarget: BrowserTarget = {
  kind: 'page',
  tabId: 7,
  url: 'https://example.com/docs',
  title: 'Example',
  pageRevision: 'rev-1',
};

const elementTarget: BrowserTarget = {
  kind: 'element',
  identity: { backendNodeId: 4242, frameId: 'frame-iframe-1' },
  pageRevision: 'rev-1',
  index: 3,
  tagName: 'button',
  text: 'Submit',
};

const frameTarget: BrowserTarget = {
  kind: 'frame',
  frameId: 'frame-iframe-1',
  cdpTargetId: 'tgt-1',
  url: 'https://child.example',
  tabId: 7,
  pageRevision: 'rev-1',
};

const mediaTarget: BrowserTarget = {
  kind: 'media',
  mediaId: 'media-9',
  mediaKind: 'video',
  tabId: 7,
  pageRevision: 'rev-1',
  state: 'playing',
};

describe('sanitizeUrl', () => {
  it('strips query and fragment by default', () => {
    expect(sanitizeUrl('https://example.com/p?q=secret#frag')).toBe('https://example.com/p');
  });

  it('keeps query/fragment when explicitly requested', () => {
    expect(sanitizeUrl('https://example.com/p?q=1#f', { keepQuery: true })).toBe('https://example.com/p?q=1');
    expect(sanitizeUrl('https://example.com/p?q=1#f', { keepFragment: true })).toBe('https://example.com/p#f');
  });

  it('removes embedded credentials', () => {
    expect(sanitizeUrl('https://user:pass@example.com/x')).toBe('https://example.com/x');
  });

  it('handles relative paths without throwing', () => {
    expect(sanitizeUrl('/relative/path?token=abc#top')).toBe('/relative/path');
  });
});

describe('ElementTarget identity', () => {
  it('rejects an element whose only identity is the digest index', () => {
    const raw = { kind: 'element', identity: { index: 5 } as never, pageRevision: 'r', index: 5 };
    expect(ElementTargetSchema.safeParse(raw).success).toBe(false);
  });

  it('rejects an element with no backendNodeId and no cssPath', () => {
    const raw = { kind: 'element', identity: { frameId: 'f' }, pageRevision: 'r' };
    expect(ElementTargetSchema.safeParse(raw).success).toBe(false);
  });

  it('accepts cssPath-only identity', () => {
    const raw = { kind: 'element', identity: { cssPath: 'button.submit' }, pageRevision: 'r' };
    expect(ElementTargetSchema.safeParse(raw).success).toBe(true);
  });

  it('carries frame identity for iframe elements', () => {
    const parsed = ElementTargetSchema.parse(elementTarget);
    expect(parsed.identity.frameId).toBe('frame-iframe-1');
    expect(parsed.pageRevision).toBe('rev-1');
  });

  it('never pairs valueRedacted with a real value', () => {
    const raw = {
      kind: 'element',
      identity: { backendNodeId: 1 },
      pageRevision: 'r',
      valueRedacted: true,
      value: 'hunter2',
    };
    expect(ElementTargetSchema.safeParse(raw).success).toBe(true); // shape allows it…
    expect(() => validateElementTarget(raw)).toThrow(/valueRedacted/); // …policy rejects it
  });
});

describe('BrowserTarget discriminated union', () => {
  it.each([
    ['page', pageTarget],
    ['element', elementTarget],
    ['frame', frameTarget],
    ['media', mediaTarget],
  ] as Array<[string, BrowserTarget]>)('round-trips %s targets losslessly through JSON', (_kind, target) => {
    const restored = deserializeTarget(serializeTarget(target));
    expect(restored).toEqual(target);
  });

  it('rejects unknown kinds', () => {
    expect(BrowserTargetSchema.safeParse({ kind: 'widget', pageRevision: 'r' }).success).toBe(false);
  });

  it('exposes pageRevision on every target', () => {
    for (const target of [pageTarget, elementTarget, frameTarget, mediaTarget]) {
      expect(targetPageRevision(target)).toBe('rev-1');
    }
  });
});
