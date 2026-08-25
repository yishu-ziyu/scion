import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFoundSource, sourceMatchesTab } from '../open-found-url';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openFoundSource', () => {
  it('returns to the verified task tab when one is still open', async () => {
    const get = vi.fn(async () => ({ id: 42, url: 'https://example.com/search' }));
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { tabs: { get, update, create } });

    openFoundSource({ url: 'https://example.com/search', tabId: 42 });
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(42, { active: true }));

    expect(get).toHaveBeenCalledWith(42);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not activate a task tab after it navigated somewhere else', async () => {
    const get = vi.fn(async () => ({ id: 42, url: 'https://example.com/other' }));
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { tabs: { get, update, create } });

    openFoundSource({ url: 'https://example.com/search', tabId: 42 });
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'https://example.com/search', active: false }));

    expect(update).not.toHaveBeenCalled();
  });

  it('opens the normalized URL in the background after the task tab is gone', async () => {
    const get = vi.fn(async () => Promise.reject(new Error('tab closed')));
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({}));
    vi.stubGlobal('chrome', { tabs: { get, update, create } });

    openFoundSource({ url: 'https://example.com/search', tabId: 42 });
    await vi.waitFor(() => expect(create).toHaveBeenCalledWith({ url: 'https://example.com/search', active: false }));

    expect(update).not.toHaveBeenCalled();
  });

  it('matches only an exact query-free normalized URL', () => {
    expect(sourceMatchesTab('https://example.com/search', 'https://example.com/search')).toBe(true);
    expect(sourceMatchesTab('https://example.com/search/', 'https://example.com/search')).toBe(true);
    expect(sourceMatchesTab('https://example.com/search?q=red', 'https://example.com/search')).toBe(false);
    expect(sourceMatchesTab('https://example.com/other', 'https://example.com/search')).toBe(false);
  });
});
