import { describe, expect, it } from 'vitest';
import { safePageUrl } from '../src/url';

describe('safePageUrl', () => {
  it('keeps origin and path and drops credentials, query, and fragment', () => {
    expect(safePageUrl('https://user:pass@example.test/reset?token=SECRET#frag')).toBe('https://example.test/reset');
  });

  it('rejects non-http URLs', () => {
    expect(safePageUrl('javascript:alert(1)')).toBe('');
    expect(safePageUrl('not a url')).toBe('');
  });
});
