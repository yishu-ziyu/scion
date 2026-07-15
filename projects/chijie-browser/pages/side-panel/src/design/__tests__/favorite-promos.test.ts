import { describe, expect, it } from 'vitest';
import { isLegacyDefaultFavoritePrompt } from '@extension/storage/lib/prompt/favorites';

describe('legacy Nanobrowser prompt cleanup', () => {
  it('matches only an exact upstream default and preserves user-authored prompts', () => {
    expect(
      isLegacyDefaultFavoritePrompt({
        id: 2,
        title: '🐦 Follow us on X/Twitter!',
        content: 'Follow us at https://x.com/nanobrowser_ai to stay updated on the latest news and features!',
      }),
    ).toBe(true);

    expect(
      isLegacyDefaultFavoritePrompt({
        id: 1,
        title: '🐦 Follow us on X/Twitter!',
        content: 'Follow us at https://x.com/nanobrowser_ai to stay updated on the latest news and features!',
      }),
    ).toBe(false);

    expect(
      isLegacyDefaultFavoritePrompt({
        id: 2,
        title: 'Explore AI Papers',
        content: 'My own weekly research workflow.',
      }),
    ).toBe(false);
    expect(
      isLegacyDefaultFavoritePrompt({
        id: 3,
        title: 'Compare browser agents',
        content: 'Compare Nanobrowser with my local fork.',
      }),
    ).toBe(false);
  });
});
