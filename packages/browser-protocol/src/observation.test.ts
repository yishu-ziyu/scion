import { describe, expect, it } from 'vitest';
import { sanitizeObservationUrls, type BrowserObservation } from './observation';
import { deserializeObservation, serializeObservation } from './serialize';
import { adaptLegacyObservation, type LegacyObservationFrame } from './legacy';

const observation: BrowserObservation = {
  protocolVersion: '2',
  observationId: 'obs-1',
  observedAt: 1735689600000,
  page: {
    kind: 'page',
    tabId: 7,
    url: 'https://example.com/feed',
    title: 'Example Feed',
    pageRevision: 'rev-9',
  },
  pageRevision: 'rev-9',
  interactiveElements: [
    {
      kind: 'element',
      identity: { backendNodeId: 111 },
      pageRevision: 'rev-9',
      index: 0,
      tagName: 'a',
      text: 'Home',
    },
    {
      kind: 'element',
      identity: { backendNodeId: 222, frameId: 'frame-embed' },
      pageRevision: 'rev-9',
      index: 1,
      tagName: 'input',
      type: 'password',
      valueRedacted: true,
    },
  ],
  visibleText: 'Welcome to the example feed.',
  viewport: { scrollY: 120, viewportHeight: 800, documentHeight: 4000 },
  media: { kind: 'bound', state: 'playing', candidateCount: 1 },
  inaccessibleFrames: [{ frameId: 'frame-pay', url: 'https://pay.example', reason: 'Target closed' }],
  signals: [{ kind: 'material_change' }, { kind: 'enrichment', label: 'site', detail: 'feed page' }],
};

describe('BrowserObservation', () => {
  it('round-trips losslessly through JSON', () => {
    const restored = deserializeObservation(serializeObservation(observation));
    expect(restored).toEqual(observation);
  });

  it('strips query and fragment from persisted URLs', () => {
    const dirty = sanitizeObservationUrls({
      ...observation,
      page: { ...observation.page, url: 'https://example.com/feed?token=abc#section' },
      inaccessibleFrames: [{ frameId: 'f', url: 'https://pay.example/x?k=1', reason: 'boom' }],
    });
    expect(dirty.page.url).toBe('https://example.com/feed');
    expect(dirty.inaccessibleFrames?.[0].url).toBe('https://pay.example/x');
  });

  it('has no task-completion field', () => {
    const keys = Object.keys(observation);
    expect(keys).not.toContain('isDone');
    expect(keys).not.toContain('done');
    expect(keys).not.toContain('taskComplete');
  });

  it('locks the stable JSON shape (protocol changes must bump version)', () => {
    expect(JSON.parse(serializeObservation(observation))).toMatchSnapshot();
  });
});

describe('legacy ObservationFrame adapter', () => {
  const legacy: LegacyObservationFrame = {
    frameId: 'frame-root',
    observedAt: 1735689600000,
    tab: { id: 7, url: 'https://example.com/page?secret=1#top', title: 'Old Page' },
    pageRevision: 'rev-4',
    targetCount: 2,
    interactiveElements: [
      { index: 0, tagName: 'button', text: 'OK', backendNodeId: 501 },
      { index: 1, tagName: 'input', type: 'password', valueRedacted: true, cdpFrameId: 'frame-inner' },
    ],
    text: 'compact prompt text',
    signals: [{ kind: 'navigation' }],
    inaccessibleIframes: [{ targetId: 'frame-inner', url: 'https://inner.example?k=2', error: 'Target closed' }],
  };

  it('converts a legacy frame into a valid v2 observation', () => {
    const adapted = adaptLegacyObservation(legacy);
    expect(adapted.protocolVersion).toBe('2');
    expect(adapted.observationId).toBe('frame-root');
    expect(adapted.page.url).toBe('https://example.com/page');
    expect(adapted.interactiveElements[0].identity.backendNodeId).toBe(501);
    expect(adapted.interactiveElements[1].identity.frameId).toBe('frame-inner');
    expect(adapted.interactiveElements[1].valueRedacted).toBe(true);
    expect(adapted.interactiveElements[1].value).toBeUndefined();
    // URL spec normalizes an empty path to "/".
    expect(adapted.inaccessibleFrames?.[0].url).toBe('https://inner.example/');
    expect(adapted.signals).toEqual([{ kind: 'navigation' }]);
  });

  it('gives every adapted element a stable identity and pageRevision', () => {
    const adapted = adaptLegacyObservation(legacy);
    for (const element of adapted.interactiveElements) {
      expect(element.pageRevision).toBe('rev-4');
      expect(element.identity.backendNodeId ?? element.identity.cssPath).toBeDefined();
    }
  });

  it('round-trips the adapted observation losslessly', () => {
    const adapted = adaptLegacyObservation(legacy);
    expect(deserializeObservation(serializeObservation(adapted))).toEqual(adapted);
  });
});
