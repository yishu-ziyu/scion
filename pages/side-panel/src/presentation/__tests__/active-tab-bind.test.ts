import { describe, expect, it } from 'vitest';
import {
  bindTabForTask,
  formatBindChip,
  instructionPointsAtCurrentPage,
  isUsableContentTabUrl,
  pickActiveContentTab,
  tabHost,
  taskBoundContentTab,
} from '../active-tab-bind';

describe('active-tab-bind', () => {
  it('rejects chrome and extension urls', () => {
    expect(isUsableContentTabUrl('chrome://settings')).toBe(false);
    expect(isUsableContentTabUrl('chrome-extension://abc/side.html')).toBe(false);
    expect(isUsableContentTabUrl('about:blank')).toBe(false);
    expect(isUsableContentTabUrl('https://www.bilibili.com/video/1')).toBe(true);
  });

  it('picks active usable tab over unusable active', () => {
    const bound = pickActiveContentTab([
      { id: 1, url: 'chrome://newtab/', title: 'New Tab', active: true },
      { id: 2, url: 'https://www.bilibili.com/video/BV1', title: '进球集锦', active: false },
    ]);
    expect(bound?.tabId).toBe(2);
    expect(bound?.host).toBe('bilibili.com');
    expect(bound?.title).toContain('进球');
  });

  it('does not steal a background http tab from chrome:// new tab', () => {
    expect(
      bindTabForTask([
        { id: 1, url: 'chrome://newtab/', title: 'New Tab', active: true },
        { id: 2, url: 'https://www.bilibili.com/video/BV1', title: '进球集锦', active: false },
      ]),
    ).toBeNull();
  });

  it('still binds a window content tab when the side panel tab itself is active', () => {
    expect(
      bindTabForTask([
        { id: 1, url: 'chrome-extension://abc/side-panel/index.html', title: '持节', active: true },
        { id: 2, url: 'https://example.com/', title: 'Example', active: false },
      ])?.tabId,
    ).toBe(2);
  });

  it('recognizes 这个页面 as pointing at the current tab', () => {
    expect(instructionPointsAtCurrentPage('这个页面讲什么')).toBe(true);
    expect(instructionPointsAtCurrentPage('搜一下北京天气')).toBe(false);
  });

  it('never borrows a background content tab when active-only binding is required', () => {
    const tabs = [
      { id: 1, url: 'chrome-extension://abc/side.html', title: 'Side panel', active: true },
      { id: 2, url: 'https://example.com/', title: 'Background page', active: false },
    ];
    expect(pickActiveContentTab(tabs, { requireActive: true })).toBeNull();
    expect(pickActiveContentTab(tabs)?.tabId).toBe(2);
  });

  it('prefers active usable when multiple', () => {
    const bound = pickActiveContentTab([
      { id: 1, url: 'https://chatgpt.com/', title: 'ChatGPT', active: false },
      { id: 2, url: 'https://www.bilibili.com/', title: '哔哩哔哩', active: true },
    ]);
    expect(bound?.tabId).toBe(2);
  });

  it('returns null when nothing usable', () => {
    expect(pickActiveContentTab([{ id: 1, url: 'chrome://extensions', active: true }])).toBeNull();
  });

  it('formats chip with host and title', () => {
    const chip = formatBindChip(
      {
        tabId: 9,
        url: 'https://www.bilibili.com/video/x',
        title: '美加墨盛夏！2026世界杯25大进球',
        host: 'bilibili.com',
      },
      '无页面',
    );
    expect(chip).toContain('bilibili.com');
    expect(chip).toContain('美加墨');
  });

  it('tabHost strips www', () => {
    expect(tabHost('https://www.example.com/a')).toBe('example.com');
  });

  it('keeps a live task chip on its bound tab after the user activates another page', () => {
    const fallback = {
      tabId: 2,
      url: 'https://other.test/',
      title: 'Other page',
      host: 'other.test',
    };
    const bound = taskBoundContentTab(
      {
        activeTabId: 1,
        targetRefs: [
          {
            kind: 'page',
            tabId: 1,
            urlOrigin: 'https://task.test',
            normalizedUrl: 'https://task.test/work',
            label: 'Task page',
          },
        ],
      },
      fallback,
    );

    expect(bound).toEqual({
      tabId: 1,
      url: 'https://task.test/work',
      title: 'Task page',
      host: 'task.test',
    });
  });

  it('does not show a different active tab while the task target is not yet persisted', () => {
    expect(
      taskBoundContentTab(
        { activeTabId: 1, targetRefs: [] },
        { tabId: 2, url: 'https://other.test/', title: 'Other page', host: 'other.test' },
      ),
    ).toBeNull();
  });
});
