import { StorageEnum } from './base/enums';
import { createStorage } from './base/base';

/**
 * API key vault: the only place where raw key material is persisted.
 * Everything else (provider profiles, logs, UI) holds an opaque `apiKeyRef`.
 * Never export a function that returns the whole ref -> key map.
 */

const VAULT_STORAGE_KEY = 'api-key-vault';

interface ApiKeyVaultRecord {
  keys: Record<string, string>;
}

const storage = createStorage<ApiKeyVaultRecord>(
  VAULT_STORAGE_KEY,
  { keys: {} },
  {
    storageEnum: StorageEnum.Local,
  },
);

export interface ApiKeyRefEntry {
  ref: string;
  maskedKey: string;
}

/** Mask a key for display: only the last 4 characters survive. */
export function maskApiKey(apiKey: string): string {
  if (!apiKey) return '';
  return `****${apiKey.slice(-4)}`;
}

/** Stable ref for a key: first 16 hex chars of its SHA-256. */
export async function deriveApiKeyRef(apiKey: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export async function getApiKey(ref: string): Promise<string | undefined> {
  if (!ref) return undefined;
  const data = await storage.get();
  return data.keys[ref];
}

export async function putApiKey(ref: string, apiKey: string): Promise<void> {
  if (!ref) {
    throw new Error('api-key-vault: ref must not be empty');
  }
  if (!apiKey) {
    throw new Error('api-key-vault: apiKey must not be empty');
  }
  const current = await storage.get();
  await storage.set({ keys: { ...current.keys, [ref]: apiKey } });
}

export async function deleteApiKey(ref: string): Promise<void> {
  const current = await storage.get();
  if (!(ref in current.keys)) return;
  const keys = { ...current.keys };
  delete keys[ref];
  await storage.set({ keys });
}

/** List stored refs with masked keys only; raw key material never leaves this module in bulk. */
export async function listKeyRefs(): Promise<ApiKeyRefEntry[]> {
  const data = await storage.get();
  return Object.entries(data.keys).map(([ref, apiKey]) => ({ ref, maskedKey: maskApiKey(apiKey) }));
}
