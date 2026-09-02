import { describe, expect, it } from 'vitest';
import { mapLegacyErrorToCode, type BrowserErrorCode } from '@chijie/browser-protocol';
import { normalizeError, retryHintForCode, ERROR_SOURCES } from '../index';
import type { ErrorSource } from '../index';

/** Fake matching ai@7 APICallError's observable shape (verified against the installed package). */
function aiSdkApiCallError(message: string, statusCode: number): Error {
  const e = new Error(message);
  e.name = 'AI_APICallError';
  Object.assign(e, { statusCode, isRetryable: statusCode === 429 || statusCode === 408 });
  return e;
}

/** Fake matching LangChain errors tagged by addLangChainErrorFields. */
function langChainError(message: string, lcErrorCode?: string): Error {
  const e = new Error(message);
  if (lcErrorCode) Object.assign(e, { lc_error_code: lcErrorCode });
  return e;
}

describe('normalizeError — source coverage', () => {
  it('langchain: maps lc_error_code MODEL_AUTHENTICATION to PROVIDER_UNAUTHORIZED', () => {
    const n = normalizeError(langChainError('Error 401: Invalid API key', 'MODEL_AUTHENTICATION'), 'langchain');
    expect(n.code).toBe('PROVIDER_UNAUTHORIZED');
    expect(n.origin).toBe('provider');
    expect(n.retryable).toBe(false);
    expect(n.source).toBe('langchain');
  });

  it('langchain: falls back to status then legacy text when lc_error_code is absent', () => {
    expect(normalizeError(langChainError('429 Too Many Requests'), 'langchain').code).toBe('PROVIDER_RATE_LIMITED');
    expect(normalizeError(langChainError('Rate limit exceeded'), 'langchain').code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('ai-sdk: AI_APICallError statusCode 429 -> PROVIDER_RATE_LIMITED (retryable)', () => {
    const n = normalizeError(aiSdkApiCallError('Too many requests', 429), 'ai-sdk');
    expect(n.code).toBe('PROVIDER_RATE_LIMITED');
    expect(n.retryable).toBe(true);
    expect(n.origin).toBe('provider');
    expect(n.message).toContain('HTTP 429');
  });

  it('ai-sdk: LoadAPIKeyError -> PROVIDER_UNAUTHORIZED', () => {
    const e = new Error('No API key provided');
    e.name = 'LoadAPIKeyError';
    expect(normalizeError(e, 'ai-sdk').code).toBe('PROVIDER_UNAUTHORIZED');
  });

  it('ai-sdk: request timeout text -> PROVIDER_TIMEOUT', () => {
    const e = new Error('Request timed out after 60000ms');
    e.name = 'AI_APICallError';
    expect(normalizeError(e, 'ai-sdk').code).toBe('PROVIDER_TIMEOUT');
  });

  it('provider-http: 401 -> PROVIDER_UNAUTHORIZED', () => {
    const e = Object.assign(new Error('Unauthorized'), { status: 401 });
    const n = normalizeError(e, 'provider-http');
    expect(n.code).toBe('PROVIDER_UNAUTHORIZED');
    expect(n.retryable).toBe(false);
  });

  it('provider-http: 429 -> PROVIDER_RATE_LIMITED', () => {
    const e = Object.assign(new Error('Too Many Requests'), { status: 429 });
    expect(normalizeError(e, 'provider-http').code).toBe('PROVIDER_RATE_LIMITED');
  });

  it('provider-http: 451 -> PROVIDER_BLOCKED', () => {
    const e = Object.assign(new Error('Unavailable For Legal Reasons'), { status: 451 });
    const n = normalizeError(e, 'provider-http');
    expect(n.code).toBe('PROVIDER_BLOCKED');
    expect(n.retryable).toBe(false);
  });

  it('provider-http: request timeout -> PROVIDER_TIMEOUT (retryable)', () => {
    const e = Object.assign(new Error('request timeout'), { name: 'TimeoutError' });
    const n = normalizeError(e, 'provider-http');
    expect(n.code).toBe('PROVIDER_TIMEOUT');
    expect(n.retryable).toBe(true);
  });

  it('provider-http: bare 451 in text without status -> PROVIDER_BLOCKED', () => {
    expect(normalizeError(new Error('HTTP 451 unavailable for legal reasons'), 'provider-http').code).toBe(
      'PROVIDER_BLOCKED',
    );
  });

  it('chrome-debugger: user cancel ("Canceled") -> USER_IN_CONTROL', () => {
    const n = normalizeError(new Error('Canceled'), 'chrome-debugger');
    expect(n.code).toBe('USER_IN_CONTROL');
    expect(n.origin).toBe('user');
    expect(n.retryable).toBe(false);
  });

  it('chrome-debugger: detach/target closed -> DEBUGGER_DETACHED', () => {
    expect(normalizeError(new Error('Cannot access a chrome:// URL'), 'chrome-debugger').code).toBe(
      'DEBUGGER_DETACHED',
    );
    expect(normalizeError(new Error('Target closed'), 'chrome-debugger').code).toBe('DEBUGGER_DETACHED');
  });

  it('page-evaluate: destroyed context -> PAGE_UNAVAILABLE; detached node -> TARGET_STALE', () => {
    expect(
      normalizeError(new Error('Execution context was destroyed, most likely because of a navigation'), 'page-evaluate')
        .code,
    ).toBe('PAGE_UNAVAILABLE');
    expect(normalizeError(new Error('Node is detached from document'), 'page-evaluate').code).toBe('TARGET_STALE');
  });

  it('target-resolver: stale node -> TARGET_STALE (retryable)', () => {
    const n = normalizeError(new Error('Action target is no longer available'), 'target-resolver');
    expect(n.code).toBe('TARGET_STALE');
    expect(n.retryable).toBe(true);
    expect(n.origin).toBe('runtime');
    expect(normalizeError(new Error('Action target is missing'), 'target-resolver').code).toBe('TARGET_STALE');
  });

  it('verification: engine failure -> VALIDATION_UNAVAILABLE (retryable)', () => {
    const n = normalizeError(new Error('completion check threw'), 'verification');
    expect(n.code).toBe('VALIDATION_UNAVAILABLE');
    expect(n.origin).toBe('verifier');
    expect(n.retryable).toBe(true);
  });

  it('storage: context invalidated (SW restart) -> SERVICE_WORKER_RESTARTED; quota -> INTERNAL_ERROR', () => {
    expect(normalizeError(new Error('Extension context invalidated'), 'storage').code).toBe('SERVICE_WORKER_RESTARTED');
    expect(normalizeError(new Error('Quota exceeded'), 'storage').code).toBe('INTERNAL_ERROR');
  });
});

describe('normalizeError — legacy strings reuse mapLegacyErrorToCode', () => {
  it('kernel legacy strings route through the protocol map when no specific rule hits', () => {
    // 'url_not_allowed' is mapped by the protocol package, not re-defined here.
    expect(mapLegacyErrorToCode('url_not_allowed')).toBe('PROVIDER_BLOCKED');
    expect(normalizeError('url_not_allowed', 'target-resolver').code).toBe('PROVIDER_BLOCKED');
    expect(normalizeError('no_effect', 'page-evaluate').code).toBe('ACTION_NO_EFFECT');
    expect(normalizeError('unknown weird failure', 'storage').code).toBe('INTERNAL_ERROR');
  });
});

describe('normalizeError — message safety', () => {
  it('user-visible message redacts API keys/tokens and strips HTML', () => {
    const raw =
      '401 Unauthorized: bad Authorization: Bearer sk-abc123def456ghi789jkl012 ' +
      '<html><body>secret password=hunter2topsecret</body></html>';
    const n = normalizeError(new Error(raw), 'provider-http');
    expect(n.message).not.toContain('sk-abc123');
    expect(n.message).not.toContain('hunter2topsecret');
    expect(n.message).not.toContain('<html>');
    expect(n.message).toContain('PROVIDER_UNAUTHORIZED');
  });

  it('debugDetail keeps the original text for local logs but is bounded', () => {
    const long = new Error('boom ' + 'x'.repeat(5000));
    const n = normalizeError(long, 'page-evaluate');
    expect(n.debugDetail.length).toBeLessThanOrEqual(2100);
    expect(n.debugDetail).toContain('boom');
    expect(n.debugDetail).toContain('[TRUNCATED]');
  });
});

describe('normalizeError — structured retry contract', () => {
  it('result carries retryable + origin so policy never reads free text', () => {
    const n = normalizeError(aiSdkApiCallError('Too many requests', 429), 'ai-sdk');
    expect(typeof n.retryable).toBe('boolean');
    expect(n.origin).toBe('provider');
    // A retry decision is derivable from the code alone:
    expect(retryHintForCode(n.code)).toBe('backoff');
  });

  it('retryHintForCode is exhaustive over every protocol code', () => {
    const allCodes = [
      'PROVIDER_UNAUTHORIZED',
      'PROVIDER_RATE_LIMITED',
      'PROVIDER_BLOCKED',
      'PROVIDER_TIMEOUT',
      'TARGET_STALE',
      'TARGET_NOT_FOUND',
      'TARGET_AMBIGUOUS',
      'ACTION_NO_EFFECT',
      'DEBUGGER_DETACHED',
      'PAGE_UNAVAILABLE',
      'VALIDATION_UNAVAILABLE',
      'USER_IN_CONTROL',
      'SERVICE_WORKER_RESTARTED',
      'INTERNAL_ERROR',
    ] satisfies BrowserErrorCode[];
    for (const code of allCodes) {
      expect(['retry', 'backoff', 'stop']).toContain(retryHintForCode(code));
    }
  });

  it('normalizing an already-normalized error is idempotent on code/retryable/origin', () => {
    const first = normalizeError(new Error('Canceled'), 'chrome-debugger');
    const second = normalizeError(first, 'chrome-debugger');
    expect(second.code).toBe(first.code);
    expect(second.retryable).toBe(first.retryable);
    expect(second.origin).toBe(first.origin);
    expect(second.source).toBe('chrome-debugger');
  });

  it('every declared source produces a valid BrowserError for a generic failure', () => {
    for (const source of ERROR_SOURCES as ErrorSource[]) {
      const n = normalizeError(new Error('something odd happened'), source);
      expect(n.code).toBeTruthy();
      expect(typeof n.retryable).toBe('boolean');
      expect(n.message.length).toBeGreaterThan(0);
      expect(n.source).toBe(source);
    }
  });
});
