import { describe, expect, it } from 'vitest';
import {
  looksLikeMailboxConfirmation,
  normalizeMailboxValue,
  parseUsualMailboxConfirmation,
  resolveMailboxOpen,
} from '../mailbox-open';

describe('resolveMailboxOpen', () => {
  it('asks which webmail when the instruction is reply-mail with no URL, name, or confirmed host', () => {
    const result = resolveMailboxOpen({
      instruction: '回这封邮件',
      currentUrl: 'https://example.com/',
      confirmedHost: null,
      openWebmailHosts: [],
    });
    expect(result).toEqual({
      kind: 'ask',
      userVisibleText: '要打开的是哪家网页邮箱？谷歌还是微软？',
    });
  });

  it('does not default to Gmail when a Google mail tab is merely already open', () => {
    const result = resolveMailboxOpen({
      instruction: '回这封邮件',
      currentUrl: 'https://example.com/',
      confirmedHost: null,
      openWebmailHosts: ['mail.google.com'],
    });
    expect(result.kind).toBe('ask');
    if (result.kind === 'ask') {
      expect(result.userVisibleText).toContain('谷歌是不是你常用的邮箱');
      expect(result.pendingHost).toBe('mail.google.com');
    }
  });

  it('opens Gmail only when the user named it', () => {
    const result = resolveMailboxOpen({
      instruction: '打开谷歌邮箱',
      currentUrl: 'https://example.com/',
      confirmedHost: null,
      openWebmailHosts: [],
    });
    expect(result).toEqual({ kind: 'open', url: 'https://mail.google.com/' });
  });

  it('opens the confirmed usual host on a later reply-mail instruction', () => {
    const result = resolveMailboxOpen({
      instruction: '打开邮箱',
      currentUrl: 'https://example.com/',
      confirmedHost: 'mail.google.com',
      openWebmailHosts: [],
    });
    expect(result).toEqual({ kind: 'open', url: 'https://mail.google.com/' });
  });

  it('treats 请打开我的邮箱 as opening mail, and asks only when no usual host is stored', () => {
    expect(
      resolveMailboxOpen({
        instruction: '请打开我的邮箱',
        currentUrl: 'https://example.com/',
        confirmedHost: null,
        openWebmailHosts: [],
      }),
    ).toEqual({
      kind: 'ask',
      userVisibleText: '要打开的是哪家网页邮箱？谷歌还是微软？',
    });
    expect(
      resolveMailboxOpen({
        instruction: '请打开我的邮箱',
        currentUrl: 'https://example.com/',
        confirmedHost: 'mail.google.com',
        openWebmailHosts: [],
      }),
    ).toEqual({ kind: 'open', url: 'https://mail.google.com/' });
  });

  it('does nothing when the current tab is already webmail or the instruction already has a URL', () => {
    expect(
      resolveMailboxOpen({
        instruction: '回这封邮件',
        currentUrl: 'https://mail.google.com/mail/u/0/',
        confirmedHost: null,
        openWebmailHosts: ['mail.google.com'],
      }).kind,
    ).toBe('none');
    expect(
      resolveMailboxOpen({
        instruction: '打开 https://mail.google.com 回信',
        currentUrl: 'https://example.com/',
        confirmedHost: null,
        openWebmailHosts: [],
      }).kind,
    ).toBe('none');
  });
});

describe('normalizeMailboxValue', () => {
  it('maps a spoken Google name to the webmail host', () => {
    expect(normalizeMailboxValue('谷歌')).toBe('mail.google.com');
  });

  it('maps Microsoft to the Outlook webmail host', () => {
    expect(normalizeMailboxValue('Microsoft')).toBe('outlook.live.com');
  });
});

describe('parseUsualMailboxConfirmation', () => {
  it('treats an explicit yes as confirmation of the pending host', () => {
    expect(parseUsualMailboxConfirmation('是', 'mail.google.com')).toEqual({
      confirmed: true,
      host: 'mail.google.com',
    });
    expect(parseUsualMailboxConfirmation('不是', 'mail.google.com')).toEqual({ confirmed: false });
  });

  it('treats a full confirmation sentence as a named host without pendingHost', () => {
    expect(parseUsualMailboxConfirmation('是，谷歌是我常用邮箱')).toEqual({
      confirmed: true,
      host: 'mail.google.com',
    });
    expect(parseUsualMailboxConfirmation('yes, Google is my usual mail')).toEqual({
      confirmed: true,
      host: 'mail.google.com',
    });
    expect(parseUsualMailboxConfirmation('是，微软是我常用邮箱')).toEqual({
      confirmed: true,
      host: 'outlook.live.com',
    });
  });

  it('does not treat a one-off named open as establishing a usual mailbox', () => {
    expect(parseUsualMailboxConfirmation('打开谷歌邮箱')).toEqual({ confirmed: false });
    expect(parseUsualMailboxConfirmation('打开 Microsoft 文档')).toEqual({ confirmed: false });
    expect(parseUsualMailboxConfirmation('是')).toEqual({ confirmed: false });
  });

  it('treats a bare provider name as the answer to which-house', () => {
    expect(parseUsualMailboxConfirmation('谷歌')).toEqual({ confirmed: true, host: 'mail.google.com' });
    expect(parseUsualMailboxConfirmation('微软')).toEqual({ confirmed: true, host: 'outlook.live.com' });
  });

  it('looksLikeMailboxConfirmation is only yes, a provider, or an establish sentence', () => {
    expect(looksLikeMailboxConfirmation('是')).toBe(true);
    expect(looksLikeMailboxConfirmation('你好')).toBe(false);
    expect(looksLikeMailboxConfirmation('打开谷歌邮箱')).toBe(false);
  });
});
