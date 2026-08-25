import { MAILBOX_KIND, factHasMailboxKind, looksLikeSecretMemory, type UserMemoryFact } from '@extension/storage';
import { extractFirstJsonSubstring, removeThinkTags } from './messages/utils';
import { jsonrepair } from 'jsonrepair';
import { normalizeMailboxValue } from './mailbox-open';

const MAX_FACTS_IN_PROMPT = 40;

export function canonicalMemoryKind(kind: string): string {
  const trimmed = kind.trim();
  if (!trimmed) return '';
  if (factHasMailboxKind(trimmed)) return MAILBOX_KIND;
  return trimmed;
}

export function isRejectedMemoryFact(kind: string, value: string): boolean {
  return looksLikeSecretMemory(kind, value);
}

export function mailboxHostFromFacts(facts: UserMemoryFact[]): string | null {
  const mailbox = [...facts].reverse().find(fact => factHasMailboxKind(fact.kind) && fact.value.trim());
  if (!mailbox) return null;
  const host = normalizeMailboxValue(mailbox.value);
  return host || null;
}

export function parseStructuredMemoryFacts(raw: string, now = Date.now(), sourceText?: string): UserMemoryFact[] {
  if (!raw || !String(raw).trim()) return [];
  const cleaned = removeThinkTags(String(raw)).trim();
  const jsonText = extractFirstJsonSubstring(cleaned) ?? cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(jsonText));
    } catch {
      return [];
    }
  }

  const rows = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { facts?: unknown }).facts)
      ? (parsed as { facts: unknown[] }).facts
      : [];

  const facts: UserMemoryFact[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const kindRaw = record.kind ?? record.label ?? record.name;
    const valueRaw = record.value ?? record.host ?? record.text;
    if (typeof kindRaw !== 'string' || typeof valueRaw !== 'string') continue;
    const kind = canonicalMemoryKind(kindRaw);
    const value = kind === MAILBOX_KIND ? normalizeMailboxValue(valueRaw) : valueRaw.trim();
    if (!kind || !value || isRejectedMemoryFact(kind, value)) continue;
    facts.push({
      id: typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `extracted-${facts.length + 1}`,
      kind,
      value,
      updatedAt: now,
      ...(sourceText?.trim() ? { sourceText: sourceText.trim() } : {}),
    });
  }
  return facts;
}

export function mergeUserMemoryFacts(
  existing: UserMemoryFact[],
  incoming: UserMemoryFact[],
  now = Date.now(),
): UserMemoryFact[] {
  const result = [...existing];
  for (const next of incoming) {
    const kind = canonicalMemoryKind(next.kind);
    const value = kind === MAILBOX_KIND ? normalizeMailboxValue(next.value) : next.value.trim();
    if (!kind || !value || isRejectedMemoryFact(kind, value)) continue;
    const index = result.findIndex(fact => canonicalMemoryKind(fact.kind) === kind);
    const sourceText = next.sourceText ?? (index >= 0 ? result[index].sourceText : undefined);
    const merged: UserMemoryFact = {
      id: index >= 0 ? result[index].id : next.id,
      kind,
      value,
      updatedAt: now,
      ...(sourceText ? { sourceText } : {}),
    };
    if (index >= 0) result[index] = merged;
    else result.push(merged);
  }
  return result;
}

export function formatUserMemoryForPrompt(facts: UserMemoryFact[]): string {
  const usable = facts
    .filter(fact => fact.kind.trim() && fact.value.trim() && !isRejectedMemoryFact(fact.kind, fact.value))
    .slice(0, MAX_FACTS_IN_PROMPT);
  if (usable.length === 0) return '';
  return [
    'User-established facts (authoritative; do not re-ask; do not read the raw memory note):',
    ...usable.map(fact => `- ${fact.kind}: ${fact.value}`),
  ].join('\n');
}
