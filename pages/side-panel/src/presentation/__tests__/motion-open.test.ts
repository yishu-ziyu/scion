import { describe, expect, it } from 'vitest';
import { dropdownClassName } from '../motion-open';

describe('dropdown close phase', () => {
  it('keeps is-closing after open is cleared so the close scale can play', () => {
    expect(dropdownClassName({ isOpen: true, isClosing: false })).toBe('t-dropdown is-open');
    expect(dropdownClassName({ isOpen: false, isClosing: true })).toBe('t-dropdown is-closing');
    expect(dropdownClassName({ isOpen: false, isClosing: false })).toBe('t-dropdown');
  });
});
