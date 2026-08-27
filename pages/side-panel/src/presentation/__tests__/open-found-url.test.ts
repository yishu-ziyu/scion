import { afterEach, describe, expect, it, vi } from 'vitest';
import { openFoundSource, openFoundUrl, sourceMatchesTab } from '../open-found-url';

const blockedFoundUrls = [
  { label: 'literal javascript', url: 'javascript:alert(1)' },
  { label: 'javascript with TAB', url: 'java\tscript:alert(1)' },
  { label: 'javascript with LF', url: 'java\nscript:alert(1)' },
  { label: 'javascript with CR', url: 'java\rscript:alert(1)' },
  { label: 'literal data', url: 'data:text/html,unsafe' },
  { label: 'data with TAB', url: 'da\tta:text/html,unsafe' },
  { label: 'data with LF', url: 'da\nta:text/html,unsafe' },
  { label: 'data with CR', url: 'da\rta:text/html,unsafe' },
  { label: 'literal file', url: 'file:///etc/passwd' },
  { label: 'file with TAB', url: 'fi\tle:///etc/passwd' },
  { label: 'file with LF', url: 'fi\nle:///etc/passwd' },
  { label: 'file with CR', url: 'fi\rle:///etc/passwd' },
] as const;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openFoundUrl', () => {
  it.each(blockedFoundUrls)('rejects $label before either URL sink', ({ url }) => {
    const create = vi.fn(async () => ({}));
    const onOpenUrl = vi.fn();
    vi.stubGlobal('chrome', { tabs: { create } });

    openFoundUrl(url, onOpenUrl);
    openFoundUrl(url);

    expect(onOpenUrl).toHaveBeenCalledTimes(0);
    expect(create).toHaveBeenCalledTimes(0);
  });

  it('keeps HTTPS URLs working through both URL sinks', () => {
    const create = vi.fn(async () => ({}));
    const onOpenUrl = vi.fn();
    vi.stubGlobal('chrome', { tabs: { create } });

    openFoundUrl('https://example.com/result', onOpenUrl);
    openFoundUrl('https://example.com/result');

    expect(onOpenUrl).toHaveBeenCalledWith('https://example.com/result');
    expect(create).toHaveBeenCalledWith({ url: 'https://example.com/result', active: false });
  });
});

describe('openFoundSource', () => {
  it('rejects a dangerous source before reading a tab or calling either URL sink', () => {
    const get = vi.fn(async () => ({ id: 42, url: 'https://example.com/search' }));
    const update = vi.fn(async () => ({}));
    const create = vi.fn(async () => ({}));
    const onOpenUrl = vi.fn();
    vi.stubGlobal('chrome', { tabs: { get, update, create } });
    const source = { url: 'java\nscript:alert(1)', tabId: 42 };

    openFoundSource(source, onOpenUrl);
    openFoundSource(source);

    expect(get).toHaveBeenCalledTimes(0);
    expect(update).toHaveBeenCalledTimes(0);
    expect(create).toHaveBeenCalledTimes(0);
    expect(onOpenUrl).toHaveBeenCalledTimes(0);
  });

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
