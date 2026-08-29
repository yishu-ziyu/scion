import { describe, expect, it } from 'vitest';
import { splitModelThink } from '../model-think';

describe('splitModelThink', () => {
  it('moves closed think blocks out of the visible answer', () => {
    const split = splitModelThink('<think>The user is asking about the page.</think>\n\n这一页讲候鸟迁徙。');
    expect(split.thinking).toBe('The user is asking about the page.');
    expect(split.visible).toBe('这一页讲候鸟迁徙。');
    expect(split.open).toBe(false);
    expect(split.visible).not.toContain('<think>');
  });

  it('hides an unclosed think tag while the model is still writing', () => {
    const split = splitModelThink('<think>Need the current page');
    expect(split.thinking).toBe('Need the current page');
    expect(split.visible).toBe('');
    expect(split.open).toBe(true);
  });

  it('keeps ordinary answers unchanged', () => {
    expect(splitModelThink('候鸟迁徙')).toEqual({ thinking: '', visible: '候鸟迁徙', open: false });
  });
});
