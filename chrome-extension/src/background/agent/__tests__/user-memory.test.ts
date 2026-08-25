import { describe, expect, it } from 'vitest';
import {
  MAILBOX_KIND,
  looksLikeSecretMemory,
  migrateLegacyMailbox,
  redactMemorySourceText,
  replaceOrInsertFact,
  type UserMemoryFact,
} from '@extension/storage';
import {
  canonicalMemoryKind,
  formatUserMemoryForPrompt,
  isRejectedMemoryFact,
  mailboxHostFromFacts,
  mergeUserMemoryFacts,
  parseStructuredMemoryFacts,
} from '../user-memory';
import { normalizeMailboxValue } from '../mailbox-open';
import { clearPendingMailboxHost, readPendingMailboxHost, writePendingMailboxHost } from '../user-memory-store';

describe('parseStructuredMemoryFacts', () => {
  it('extracts mailbox host from a facts object', () => {
    const facts = parseStructuredMemoryFacts('{"facts":[{"kind":"常用邮箱","value":"谷歌"}]}', 1, '我常用谷歌邮箱');
    expect(facts).toEqual([
      {
        id: 'extracted-1',
        kind: MAILBOX_KIND,
        value: 'mail.google.com',
        updatedAt: 1,
        sourceText: '我常用谷歌邮箱',
      },
    ]);
  });

  it('accepts a top-level array and drops passwords', () => {
    const facts = parseStructuredMemoryFacts(
      '[{"kind":"常用搜索","value":"Google"},{"kind":"密码","value":"hunter2"}]',
      2,
    );
    expect(facts.map(fact => fact.kind)).toEqual(['常用搜索']);
    expect(facts[0]?.value).toBe('Google');
  });
});

describe('mergeUserMemoryFacts', () => {
  it('updates the same kind in place so a user edit is what later tasks read', () => {
    const existing: UserMemoryFact[] = [{ id: 'a', kind: '常用邮箱', value: 'mail.google.com', updatedAt: 1 }];
    const merged = mergeUserMemoryFacts(
      existing,
      [{ id: 'ignored', kind: 'usual mailbox', value: '微软', updatedAt: 2 }],
      3,
    );
    expect(merged).toEqual([{ id: 'a', kind: MAILBOX_KIND, value: 'outlook.live.com', updatedAt: 3 }]);
  });
});

describe('replaceOrInsertFact', () => {
  it('collapses two mailbox kinds into the earlier row', () => {
    const existing: UserMemoryFact[] = [{ id: 'a', kind: MAILBOX_KIND, value: 'mail.google.com', updatedAt: 1 }];
    const merged = replaceOrInsertFact(existing, {
      id: 'b',
      kind: 'usual mailbox',
      value: 'outlook.live.com',
      updatedAt: 2,
    });
    expect(merged).toEqual([{ id: 'a', kind: MAILBOX_KIND, value: 'outlook.live.com', updatedAt: 2 }]);
  });
});

describe('mailboxHostFromFacts', () => {
  it('reads the mailbox row after migration from the old single key', () => {
    const facts = migrateLegacyMailbox([], 'mail.google.com', 1);
    expect(mailboxHostFromFacts(facts)).toBe('mail.google.com');
    expect(canonicalMemoryKind('usual mailbox')).toBe(MAILBOX_KIND);
  });
});

describe('formatUserMemoryForPrompt', () => {
  it('lists facts and never includes raw notes or secrets', () => {
    const text = formatUserMemoryForPrompt([
      { id: '1', kind: '常用邮箱', value: 'mail.google.com', sourceText: '我常用谷歌邮箱', updatedAt: 1 },
      { id: '2', kind: 'password', value: 'secret', updatedAt: 1 },
    ]);
    expect(text).toContain('- 常用邮箱: mail.google.com');
    expect(text).not.toContain('我常用谷歌邮箱');
    expect(text).not.toContain('secret');
    expect(isRejectedMemoryFact('密码', 'abc')).toBe(true);
    expect(looksLikeSecretMemory('password', 'hunter2')).toBe(true);
    expect(redactMemorySourceText('我常用谷歌邮箱\n密码: hunter2')).toBe('我常用谷歌邮箱');
  });
});

describe('pending mailbox host', () => {
  it('keeps the host for this task until cleared', async () => {
    await writePendingMailboxHost('task-a', 'mail.google.com');
    expect(await readPendingMailboxHost('task-a')).toBe('mail.google.com');
    expect(await readPendingMailboxHost('task-b')).toBeUndefined();
    await clearPendingMailboxHost('task-a');
    expect(await readPendingMailboxHost('task-a')).toBeUndefined();
  });
});

describe('normalizeMailboxValue', () => {
  it('maps 谷歌 and gmail to the Google webmail host', () => {
    expect(normalizeMailboxValue('谷歌')).toBe('mail.google.com');
    expect(normalizeMailboxValue('https://mail.google.com/mail/u/0/')).toBe('mail.google.com');
    expect(normalizeMailboxValue('Microsoft')).toBe('outlook.live.com');
  });
});
