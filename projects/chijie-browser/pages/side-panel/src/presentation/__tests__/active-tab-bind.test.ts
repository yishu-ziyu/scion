import { describe, expect, it } from 'vitest';
import {
  formatBindChip,
  isUsableContentTabUrl,
  pickActiveContentTab,
  tabHost,
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
});
