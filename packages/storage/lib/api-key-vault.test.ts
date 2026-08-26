import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// The storage base module captures `globalThis.chrome` at import time,
// so the mock must be installed before the vault module is imported.
const localData: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(keys.filter(key => key in localData).map(key => [key, localData[key]])),
      set: async (items: Record<string, unknown>) => {
        Object.assign(localData, items);
      },
      onChanged: { addListener: () => {} },
    },
  },
};

let vault: typeof import('./api-key-vault');

beforeAll(async () => {
  vault = await import('./api-key-vault');
});

beforeEach(() => {
  for (const key of Object.keys(localData)) {
    delete localData[key];
  }
});

describe('api-key-vault', () => {
  it('stores and returns a key by ref', async () => {
    await vault.putApiKey('ref-a', 'sk-secret-0001');
    expect(await vault.getApiKey('ref-a')).toBe('sk-secret-0001');
    expect(await vault.getApiKey('ref-missing')).toBeUndefined();
  });

  it('rejects empty ref or empty key', async () => {
    await expect(vault.putApiKey('', 'sk-x-1')).rejects.toThrow();
    await expect(vault.putApiKey('ref-a', '')).rejects.toThrow();
  });

  it('deletes a key by ref', async () => {
    await vault.putApiKey('ref-a', 'sk-secret-0001');
    await vault.deleteApiKey('ref-a');
    expect(await vault.getApiKey('ref-a')).toBeUndefined();
    // deleting a missing ref is a no-op
    await vault.deleteApiKey('ref-a');
  });

  it('lists only refs and masked keys, never raw key material', async () => {
    await vault.putApiKey('ref-a', 'sk-secret-0001');
    await vault.putApiKey('ref-b', 'sk-secret-0002');
    const entries = await vault.listKeyRefs();
    expect(entries).toHaveLength(2);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('sk-secret-0001');
    expect(serialized).not.toContain('sk-secret-0002');
    expect(entries.find(e => e.ref === 'ref-a')?.maskedKey).toBe('****0001');
  });

  it('derives a stable 16-hex-char ref from a key', async () => {
    const ref1 = await vault.deriveApiKeyRef('sk-secret-0001');
    const ref2 = await vault.deriveApiKeyRef('sk-secret-0001');
    const other = await vault.deriveApiKeyRef('sk-secret-0002');
    expect(ref1).toBe(ref2);
    expect(ref1).toMatch(/^[0-9a-f]{16}$/);
    expect(ref1).not.toBe(other);
  });
});
