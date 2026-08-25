import { MAILBOX_KIND, factHasMailboxKind, userMemoryStore } from '@extension/storage';
import { mailboxHostFromFacts } from './user-memory';
import { normalizeMailboxValue } from './mailbox-open';

const PENDING_MAILBOX_KEY = 'pending-usual-mailbox-v1';
const pendingMailboxByTask = new Map<string, string>();

type PendingMailboxRow = { taskId: string; host: string };

function sessionStore(): chrome.storage.StorageArea | undefined {
  return globalThis.chrome?.storage?.session;
}

export async function listUserMemoryFacts() {
  return (await userMemoryStore.getState()).facts;
}

export async function readUsualMailboxHost(): Promise<string | null> {
  return mailboxHostFromFacts(await listUserMemoryFacts());
}

export async function writeUsualMailboxHost(host: string): Promise<void> {
  const normalized = normalizeMailboxValue(host);
  if (!normalized) return;
  const state = await userMemoryStore.getState();
  const existing = state.facts.find(fact => factHasMailboxKind(fact.kind));
  await userMemoryStore.upsertFact({
    id: existing?.id,
    kind: MAILBOX_KIND,
    value: normalized,
    sourceText: existing?.sourceText,
  });
}

export async function writePendingMailboxHost(taskId: string, host: string): Promise<void> {
  const normalized = normalizeMailboxValue(host);
  if (!taskId || !normalized) return;
  pendingMailboxByTask.set(taskId, normalized);
  const area = sessionStore();
  if (!area?.set) return;
  try {
    const row: PendingMailboxRow = { taskId, host: normalized };
    await area.set({ [PENDING_MAILBOX_KEY]: row });
  } catch {
    // Session storage is optional; in-memory still answers this service worker.
  }
}

export async function readPendingMailboxHost(taskId: string): Promise<string | undefined> {
  if (!taskId) return undefined;
  const fromMemory = pendingMailboxByTask.get(taskId);
  if (fromMemory) return fromMemory;
  const area = sessionStore();
  if (!area?.get) return undefined;
  try {
    const stored = (await area.get(PENDING_MAILBOX_KEY))[PENDING_MAILBOX_KEY] as PendingMailboxRow | undefined;
    if (!stored || stored.taskId !== taskId || !stored.host) return undefined;
    pendingMailboxByTask.set(taskId, stored.host);
    return stored.host;
  } catch {
    return undefined;
  }
}

export async function clearPendingMailboxHost(taskId: string): Promise<void> {
  if (taskId) pendingMailboxByTask.delete(taskId);
  const area = sessionStore();
  if (!area?.remove) return;
  try {
    await area.remove(PENDING_MAILBOX_KEY);
  } catch {
    // In-memory already cleared.
  }
}
