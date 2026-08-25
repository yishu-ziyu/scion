import { StorageEnum } from '../base/enums';
import { createStorage } from '../base/base';
import type { BaseStorage } from '../base/types';

export const USER_MEMORY_STORAGE_KEY = 'user-memory-v1';
export const LEGACY_USUAL_MAILBOX_KEY = 'usual-mailbox-v1';
export const MAILBOX_KIND = '常用邮箱';

export interface UserMemoryFact {
  id: string;
  kind: string;
  value: string;
  sourceText?: string;
  updatedAt: number;
}

export interface UserMemoryState {
  facts: UserMemoryFact[];
  sourceText: string;
}

export const DEFAULT_USER_MEMORY: UserMemoryState = {
  facts: [],
  sourceText: '',
};

export type UserMemoryStorage = BaseStorage<UserMemoryState> & {
  getState: () => Promise<UserMemoryState>;
  setState: (state: UserMemoryState) => Promise<void>;
  upsertFact: (
    fact: Omit<UserMemoryFact, 'id' | 'updatedAt'> & { id?: string; updatedAt?: number },
  ) => Promise<UserMemoryFact>;
  removeFact: (id: string) => Promise<void>;
  setSourceText: (sourceText: string) => Promise<void>;
};

const storage = createStorage<UserMemoryState>(USER_MEMORY_STORAGE_KEY, DEFAULT_USER_MEMORY, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

async function readLegacyMailboxHost(): Promise<string | null> {
  const chromeApi = (
    globalThis as { chrome?: { storage?: { local?: { get: (keys: string[]) => Promise<Record<string, unknown>> } } } }
  ).chrome;
  if (!chromeApi?.storage?.local?.get) return null;
  const stored = await chromeApi.storage.local.get([LEGACY_USUAL_MAILBOX_KEY]);
  const row = stored[LEGACY_USUAL_MAILBOX_KEY] as { host?: string } | undefined;
  return typeof row?.host === 'string' && row.host.trim() ? row.host.trim() : null;
}

export function factHasMailboxKind(kind: string): boolean {
  const trimmed = kind.trim();
  return /^(常用)?(邮箱|mailbox|webmail)$/i.test(trimmed) || /^usual\s*mailbox$/i.test(trimmed);
}

const SECRET_KIND = /密码|口令|password|passwd|secret|token|api[_-]?key|cookie/i;
const SECRET_VALUE = /password\s*[:=]|sk-[a-zA-Z0-9]|api[_-]?key\s*[:=]/i;

export function looksLikeSecretMemory(kind: string, value: string): boolean {
  return SECRET_KIND.test(kind) || SECRET_KIND.test(value) || SECRET_VALUE.test(value);
}

export function redactMemorySourceText(text: string): string {
  return text
    .split('\n')
    .filter(line => !looksLikeSecretMemory('', line.trim()))
    .join('\n');
}

function kindsMatch(left: string, right: string): boolean {
  const a = left.trim();
  const b = right.trim();
  if (!a || !b) return false;
  if (factHasMailboxKind(a) && factHasMailboxKind(b)) return true;
  return a === b;
}

export function replaceOrInsertFact(facts: UserMemoryFact[], next: UserMemoryFact): UserMemoryFact[] {
  const kind = factHasMailboxKind(next.kind) ? MAILBOX_KIND : next.kind.trim();
  const row: UserMemoryFact = { ...next, kind };
  if (!kind) {
    const index = facts.findIndex(fact => fact.id === row.id);
    if (index >= 0) {
      const copy = [...facts];
      copy[index] = row;
      return copy;
    }
    return [...facts, row];
  }
  const withoutSelf = facts.filter(fact => fact.id !== row.id);
  const sameKindIndex = withoutSelf.findIndex(fact => kindsMatch(fact.kind, kind));
  if (sameKindIndex >= 0) {
    const keptId = withoutSelf[sameKindIndex].id;
    return withoutSelf.map((fact, index) => (index === sameKindIndex ? { ...row, id: keptId } : fact));
  }
  const index = facts.findIndex(fact => fact.id === row.id);
  if (index >= 0) {
    const copy = [...facts];
    copy[index] = row;
    return copy;
  }
  return [...facts, row];
}

export function migrateLegacyMailbox(
  facts: UserMemoryFact[],
  legacyHost: string | null,
  now: number,
): UserMemoryFact[] {
  if (!legacyHost) return facts;
  if (facts.some(fact => factHasMailboxKind(fact.kind) && fact.value.trim())) return facts;
  return [
    ...facts,
    {
      id: 'migrated-mailbox',
      kind: MAILBOX_KIND,
      value: legacyHost,
      updatedAt: now,
    },
  ];
}

function cloneState(state: UserMemoryState | null | undefined): UserMemoryState {
  const facts = Array.isArray(state?.facts) ? state.facts.filter(isStoredFact) : [];
  let collapsed: UserMemoryFact[] = [];
  for (const fact of facts) {
    if (looksLikeSecretMemory(fact.kind, fact.value)) continue;
    collapsed = replaceOrInsertFact(collapsed, fact);
  }
  return {
    facts: collapsed,
    sourceText: typeof state?.sourceText === 'string' ? redactMemorySourceText(state.sourceText) : '',
  };
}

function isStoredFact(value: unknown): value is UserMemoryFact {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<UserMemoryFact>;
  return (
    typeof row.id === 'string' &&
    row.id.length > 0 &&
    typeof row.kind === 'string' &&
    typeof row.value === 'string' &&
    typeof row.updatedAt === 'number'
  );
}

const userMemoryStore: UserMemoryStorage = {
  ...storage,

  async getState() {
    const current = cloneState(await storage.get());
    if (current.facts.some(fact => factHasMailboxKind(fact.kind) && fact.value.trim())) {
      return current;
    }
    const migrated = migrateLegacyMailbox(current.facts, await readLegacyMailboxHost(), Date.now());
    if (migrated === current.facts) return current;
    const next = { ...current, facts: migrated };
    await storage.set(next);
    return next;
  },

  async setState(state) {
    const cloned = cloneState(state);
    await storage.set({
      sourceText: redactMemorySourceText(cloned.sourceText),
      facts: cloned.facts.filter(fact => !looksLikeSecretMemory(fact.kind, fact.value)),
    });
  },

  async upsertFact(input) {
    const current = await this.getState();
    const now = input.updatedAt ?? Date.now();
    const id = input.id ?? crypto.randomUUID();
    const nextFact: UserMemoryFact = {
      id,
      kind: input.kind.trim(),
      value: input.value.trim(),
      updatedAt: now,
      ...(typeof input.sourceText === 'string' && input.sourceText.trim()
        ? { sourceText: redactMemorySourceText(input.sourceText.trim()) }
        : {}),
    };
    if (looksLikeSecretMemory(nextFact.kind, nextFact.value)) {
      throw new Error('secret_not_stored');
    }
    const facts = replaceOrInsertFact(current.facts, nextFact);
    const stored =
      facts.find(fact => fact.id === nextFact.id) ?? facts.find(fact => kindsMatch(fact.kind, nextFact.kind));
    await storage.set({ ...current, facts });
    return stored ?? nextFact;
  },

  async removeFact(id) {
    const current = await this.getState();
    await storage.set({
      ...current,
      facts: current.facts.filter(fact => fact.id !== id),
    });
  },

  async setSourceText(sourceText) {
    const current = await this.getState();
    await storage.set({ ...current, sourceText: redactMemorySourceText(sourceText) });
  },
};

export { userMemoryStore };
