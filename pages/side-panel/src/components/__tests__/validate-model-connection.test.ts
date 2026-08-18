import { describe, expect, it, vi, afterEach } from 'vitest';
import { resolveBaseUrl, validateModelConnection } from '../validate-model-connection';

describe('validateModelConnection', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolveBaseUrl uses defaults for openai', () => {
    expect(resolveBaseUrl('openai', '')).toBe('https://api.openai.com/v1');
    expect(resolveBaseUrl('custom_openai', 'https://api.minimaxi.com/v1/')).toBe('https://api.minimaxi.com/v1');
  });

  it('rejects empty model', async () => {
    const r = await validateModelConnection({
      providerType: 'openai',
      apiKey: 'sk-test',
      model: '  ',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/模型/);
  });

  it('maps 401 to invalid key message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Incorrect API key' } }),
      })),
    );
    const r = await validateModelConnection({
      providerType: 'openai',
      apiKey: 'sk-bad',
      model: 'gpt-4.1-mini',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/API Key/);
  });

  it('returns ok on successful chat/completions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => '',
      })),
    );
    const r = await validateModelConnection({
      providerType: 'custom_openai',
      apiKey: 'sk-ok',
      baseUrl: 'https://api.minimaxi.com/v1',
      model: 'MiniMax-M3',
    });
    expect(r.ok).toBe(true);
  });
});

describe('FirstRunSetup source contract', () => {
  it('SidePanel uses FirstRunSetup when models missing', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const here = dirname(fileURLToPath(import.meta.url));
    const sidePanel = readFileSync(resolve(here, '../../SidePanel.tsx'), 'utf8');
    expect(sidePanel).toContain('FirstRunSetup');
    expect(sidePanel).toContain('hasConfiguredModels === false');
    expect(sidePanel).not.toMatch(/welcome_openSettings/);
  });
});
