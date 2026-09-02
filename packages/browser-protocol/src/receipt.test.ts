import { describe, expect, it } from 'vitest';
import { ActionReceiptSchema, validateReceipt, type ActionReceipt } from './receipt';
import {
  BrowserErrorCodeSchema,
  legacyErrorToBrowserError,
  makeBrowserError,
  mapLegacyErrorToCode,
  redactErrorText,
  RETRYABLE_BY_CODE,
} from './errors';
import { deserializeReceipt, serializeReceipt } from './serialize';

const receipt: ActionReceipt = {
  actionId: 'act-1',
  status: 'applied',
  beforeRevision: 'rev-1',
  afterRevision: 'rev-2',
  evidence: [{ kind: 'screenshot', ref: 'evidence/shots/act-1.png', capturedAt: 1700000000001 }],
};

describe('ActionReceipt', () => {
  it('has no isDone field', () => {
    expect(Object.keys(receipt)).not.toContain('isDone');
    expect(ActionReceiptSchema.safeParse({ ...receipt, isDone: true }).success).toBe(true); // stripped
    expect(ActionReceiptSchema.parse({ ...receipt, isDone: true })).not.toHaveProperty('isDone');
  });

  it('round-trips through JSON', () => {
    expect(deserializeReceipt(serializeReceipt(receipt))).toEqual(receipt);
  });

  it('distinguishes blocked from unknown', () => {
    const blocked: ActionReceipt = {
      ...receipt,
      status: 'blocked',
      error: makeBrowserError('USER_IN_CONTROL', 'user took over'),
    };
    const unknown: ActionReceipt = {
      ...receipt,
      status: 'unknown',
      error: makeBrowserError('DEBUGGER_DETACHED', 'detached mid-action'),
    };
    expect(blocked.status).not.toBe(unknown.status);
    expect(validateReceipt(blocked)).toBe(blocked);
    expect(validateReceipt(unknown)).toBe(unknown);
  });

  it('requires an error on blocked/unknown receipts', () => {
    expect(() => validateReceipt({ ...receipt, status: 'blocked' })).toThrow(/requires an error/);
    expect(() => validateReceipt({ ...receipt, status: 'unknown' })).toThrow(/requires an error/);
  });
});

describe('BrowserError taxonomy', () => {
  const ALL_CODES = BrowserErrorCodeSchema.options;

  it('declares every required code', () => {
    for (const code of [
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
    ]) {
      expect(ALL_CODES).toContain(code);
    }
  });

  it('every error carries retryable and origin', () => {
    for (const code of ALL_CODES) {
      const error = makeBrowserError(code, `test ${code}`);
      expect(typeof error.retryable).toBe('boolean');
      expect(error.retryable).toBe(RETRYABLE_BY_CODE[code]);
      expect(['provider', 'runtime', 'page', 'user', 'verifier']).toContain(error.origin);
    }
  });

  it('TARGET_STALE and TARGET_NOT_FOUND are distinct codes', () => {
    expect(makeBrowserError('TARGET_STALE', 'x').code).not.toBe(makeBrowserError('TARGET_NOT_FOUND', 'x').code);
  });
});

describe('error message redaction', () => {
  it('scrubs API keys and bearer tokens from messages', () => {
    const raw = 'provider rejected: Authorization: Bearer sk-proj-abcdefghijklmnop1234 api_key=supersecretvalue';
    const scrubbed = redactErrorText(raw);
    expect(scrubbed).not.toContain('sk-proj-abcdefghijklmnop1234');
    expect(scrubbed).not.toContain('supersecretvalue');
    expect(scrubbed).toContain('[REDACTED]');
  });

  it('makeBrowserError never leaks a raw key in message', () => {
    const error = makeBrowserError('PROVIDER_UNAUTHORIZED', 'bad key sk-abcdefghijklmnopqrstuvwx used');
    expect(error.message).not.toContain('sk-abcdefghijklmnopqrstuvwx');
  });

  it('truncates page dumps', () => {
    const long = 'x'.repeat(5000);
    const out = redactErrorText(long);
    expect(out.length).toBeLessThanOrEqual(420);
    expect(out).toContain('[TRUNCATED]');
  });

  it('redacts form raw values assigned via key=value patterns', () => {
    const out = redactErrorText('fill failed password=correct horse battery');
    expect(out).not.toContain('correct horse battery');
  });
});

describe('legacy error string mapping', () => {
  const cases: Array<[string, string]> = [
    ['action_target_stale', 'TARGET_STALE'],
    ['Element: 3 not found', 'TARGET_NOT_FOUND'],
    ['Element not found or puppeteer is not connected', 'TARGET_NOT_FOUND'],
    ['multiple matches for selector', 'TARGET_AMBIGUOUS'],
    ['url_not_allowed', 'PROVIDER_BLOCKED'],
    ['401 unauthorized', 'PROVIDER_UNAUTHORIZED'],
    ['429 Too Many Requests', 'PROVIDER_RATE_LIMITED'],
    ['request timed out', 'PROVIDER_TIMEOUT'],
    ['Target closed', 'DEBUGGER_DETACHED'],
    ['debugger detached', 'DEBUGGER_DETACHED'],
    ['page 404 not available', 'PAGE_UNAVAILABLE'],
    ['user took control of the tab', 'USER_IN_CONTROL'],
    ['service worker restarted mid-run', 'SERVICE_WORKER_RESTARTED'],
    ['totally unknown failure', 'INTERNAL_ERROR'],
  ];

  it.each(cases)('maps %p to %p', (legacy, code) => {
    expect(mapLegacyErrorToCode(legacy)).toBe(code);
  });

  it('produces full BrowserErrors from legacy strings', () => {
    const error = legacyErrorToBrowserError('action_target_stale');
    expect(error.code).toBe('TARGET_STALE');
    expect(error.retryable).toBe(true);
    expect(error.origin).toBe('runtime');
  });
});
