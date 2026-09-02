/**
 * C6 — runtimeMode parse/resolve acceptance tests.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_RUNTIME_MODE, parseRuntimeMode, resolveMode, RUNTIME_MODES } from './mode';

describe('parseRuntimeMode (C6)', () => {
  it('accepts every declared mode', () => {
    for (const mode of RUNTIME_MODES) {
      expect(parseRuntimeMode(mode)).toBe(mode);
    }
  });

  it('falls back to legacy for illegal values', () => {
    expect(parseRuntimeMode('bogus')).toBe('legacy');
    expect(parseRuntimeMode('')).toBe('legacy');
    expect(parseRuntimeMode('LEGACY')).toBe('legacy');
    expect(parseRuntimeMode(undefined)).toBe('legacy');
    expect(parseRuntimeMode(null)).toBe('legacy');
    expect(parseRuntimeMode(42)).toBe('legacy');
    expect(parseRuntimeMode({ mode: 'v2-shadow' })).toBe('legacy');
  });

  it('defaults to legacy', () => {
    expect(DEFAULT_RUNTIME_MODE).toBe('legacy');
  });
});

describe('resolveMode (C6)', () => {
  it('resolves each mode from a config object', () => {
    expect(resolveMode({ runtimeMode: 'legacy' })).toBe('legacy');
    expect(resolveMode({ runtimeMode: 'v2-shadow' })).toBe('v2-shadow');
    expect(resolveMode({ runtimeMode: 'v2-active' })).toBe('v2-active');
  });

  it('missing or invalid runtimeMode is legacy (instant rollback)', () => {
    expect(resolveMode({})).toBe('legacy');
    expect(resolveMode({ runtimeMode: 'v3-lol' })).toBe('legacy');
    expect(resolveMode(null)).toBe('legacy');
    expect(resolveMode(undefined)).toBe('legacy');
  });
});
