import { describe, expect, it } from 'vitest';
import type { ObservationFrame } from '../../../browser/kernel';
import { captureQueuedActionTarget, resolveQueuedActionIndex } from '../queued-action-target';

function frame(elements: ObservationFrame['interactiveElements']): ObservationFrame {
  return {
    frameId: 'frame-1',
    observedAt: 1,
    tab: { id: 7, url: 'https://example.test/form', title: 'Form' },
    pageRevision: 'revision-1',
    targetCount: elements.length,
    interactiveElements: elements,
    text: 'form',
    signals: [],
  };
}

describe('queued action target identity', () => {
  it('finds the same CDP node after its index changes', () => {
    const before = frame([{ index: 1, tagName: 'input', backendNodeId: 21, cdpFrameId: 'main', tabId: 7 }]);
    const target = captureQueuedActionTarget(before, { index: 1, text: 'Ada' });
    const after = frame([
      { index: 4, tagName: 'input', backendNodeId: 21, cdpFrameId: 'main', tabId: 7, value: 'Ada' },
    ]);

    expect(target).not.toBeNull();
    expect(resolveQueuedActionIndex(target!, after)).toBe(4);
  });

  it('rejects a replacement node at the old index', () => {
    const before = frame([{ index: 1, tagName: 'input', backendNodeId: 21, cdpFrameId: 'main', tabId: 7 }]);
    const target = captureQueuedActionTarget(before, { index: 1 });
    const after = frame([{ index: 1, tagName: 'input', backendNodeId: 99, cdpFrameId: 'main', tabId: 7 }]);

    expect(resolveQueuedActionIndex(target!, after)).toBeNull();
  });

  it('uses a unique semantic identity when CDP identity is unavailable', () => {
    const before = frame([{ index: 2, tagName: 'input', name: 'email', label: 'Email', type: 'email' }]);
    const target = captureQueuedActionTarget(before, { index: 2 });
    const after = frame([
      { index: 3, tagName: 'input', name: 'name', label: 'Name', type: 'text' },
      { index: 8, tagName: 'input', name: 'email', label: 'Email', type: 'email', value: 'a@example.test' },
    ]);

    expect(resolveQueuedActionIndex(target!, after)).toBe(8);
  });

  it('rejects an ambiguous semantic identity', () => {
    const before = frame([{ index: 2, tagName: 'input', name: 'tag', label: 'Tag', type: 'text' }]);
    const target = captureQueuedActionTarget(before, { index: 2 });
    const after = frame([
      { index: 2, tagName: 'input', name: 'tag', label: 'Tag', type: 'text' },
      { index: 5, tagName: 'input', name: 'tag', label: 'Tag', type: 'text' },
    ]);

    expect(resolveQueuedActionIndex(target!, after)).toBeNull();
  });
});
