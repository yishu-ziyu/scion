import { describe, expect, it } from 'vitest';
import { createSelectionContext } from '../src/selection';

describe('createSelectionContext', () => {
  it('turns paragraphs in a user selection into a bundle', () => {
    expect(
      createSelectionContext(' First paragraph.\n\nSecond paragraph. ', {
        title: 'Selected notes',
        url: 'https://example.com/page#part',
      }),
    ).toEqual({
      sourceType: 'selection',
      title: 'Selected notes',
      url: 'https://example.com/page#part',
      blocks: [
        { type: 'paragraph', text: 'First paragraph.' },
        { type: 'paragraph', text: 'Second paragraph.' },
      ],
      anchors: [],
      trustLevel: 'user-selected',
    });
  });

  it('returns no blocks for whitespace', () => {
    expect(createSelectionContext('  \n ').blocks).toEqual([]);
  });
});
