/**
 * ActionReceipt + error taxonomy (B4).
 *
 * Hard rules:
 * - No `isDone` / task-completion field anywhere in this protocol.
 * - TARGET_STALE (identity known, revision gone) is distinct from
 *   TARGET_NOT_FOUND (identity never resolved).
 * - `blocked` (policy refused) is distinct from `unknown` (outcome
 *   indeterminate, e.g. debugger detached mid-action).
 * - Every BrowserError carries `retryable` and `origin`.
 * - Error messages must never contain API keys, full page text, or raw
 *   form values; use the redaction helpers below.
 */
import { z } from 'zod';

export const BrowserErrorCodeSchema = z.enum([
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
]);
export type BrowserErrorCode = z.infer<typeof BrowserErrorCodeSchema>;

export const ErrorOriginSchema = z.enum(['provider', 'runtime', 'page', 'user', 'verifier']);
export type ErrorOrigin = z.infer<typeof ErrorOriginSchema>;

export const BrowserErrorSchema = z.object({
  code: BrowserErrorCodeSchema,
  message: z.string().min(1),
  retryable: z.boolean(),
  origin: ErrorOriginSchema,
});
export type BrowserError = z.infer<typeof BrowserErrorSchema>;

/** Default retryability per code; callers may override at construction time. */
export const RETRYABLE_BY_CODE: Record<BrowserErrorCode, boolean> = {
  PROVIDER_UNAUTHORIZED: false,
  PROVIDER_RATE_LIMITED: true,
  PROVIDER_BLOCKED: false,
  PROVIDER_TIMEOUT: true,
  TARGET_STALE: true,
  TARGET_NOT_FOUND: false,
  TARGET_AMBIGUOUS: false,
  ACTION_NO_EFFECT: false,
  DEBUGGER_DETACHED: true,
  PAGE_UNAVAILABLE: true,
  VALIDATION_UNAVAILABLE: true,
  USER_IN_CONTROL: false,
  SERVICE_WORKER_RESTARTED: true,
  INTERNAL_ERROR: false,
};

const ORIGIN_BY_CODE: Record<BrowserErrorCode, ErrorOrigin> = {
  PROVIDER_UNAUTHORIZED: 'provider',
  PROVIDER_RATE_LIMITED: 'provider',
  PROVIDER_BLOCKED: 'provider',
  PROVIDER_TIMEOUT: 'provider',
  TARGET_STALE: 'runtime',
  TARGET_NOT_FOUND: 'runtime',
  TARGET_AMBIGUOUS: 'runtime',
  ACTION_NO_EFFECT: 'page',
  DEBUGGER_DETACHED: 'runtime',
  PAGE_UNAVAILABLE: 'page',
  VALIDATION_UNAVAILABLE: 'verifier',
  USER_IN_CONTROL: 'user',
  SERVICE_WORKER_RESTARTED: 'runtime',
  INTERNAL_ERROR: 'runtime',
};

/** Build a BrowserError with code-derived defaults for retryable/origin. */
export function makeBrowserError(
  code: BrowserErrorCode,
  message: string,
  overrides?: Partial<Pick<BrowserError, 'retryable' | 'origin'>>,
): BrowserError {
  return {
    code,
    message: redactErrorText(message),
    retryable: overrides?.retryable ?? RETRYABLE_BY_CODE[code],
    origin: overrides?.origin ?? ORIGIN_BY_CODE[code],
  };
}

/* ------------------------------------------------------------------ *
 * Message redaction
 * ------------------------------------------------------------------ */

/** Longest run of text we tolerate inside an error message. */
const MAX_MESSAGE_CHARS = 400;

const BEARER_PATTERN = /\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi;
// Value side eats the rest of the line: for form fields and secrets,
// over-redacting loses debug detail, under-redacting leaks data.
const API_KEY_PATTERN =
  /\b((?:sk|api|key|token|secret|password|passwd|pwd)[-_]?[A-Za-z0-9]*\s*[:=]\s*)("[^"]*"|'[^']*'|[^\r\n]*)/gi;
const OPENAI_STYLE_KEY = /\bsk-[A-Za-z0-9_-]{16,}\b/g;
const URL_CREDENTIALS = /\b([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/\s@]+):([^/\s@]+)@/g;

/**
 * Scrub secrets and oversized content from error text.
 * - Redacts bearer tokens, `key=value` secrets, sk-style keys, URL credentials.
 * - Truncates to a bounded length so page dumps can't ride along.
 */
export function redactErrorText(text: string): string {
  let out = text
    .replace(BEARER_PATTERN, '$1[REDACTED]')
    .replace(OPENAI_STYLE_KEY, '[REDACTED]')
    .replace(API_KEY_PATTERN, '$1[REDACTED]')
    .replace(URL_CREDENTIALS, '$1[REDACTED]@');
  if (out.length > MAX_MESSAGE_CHARS) {
    out = `${out.slice(0, MAX_MESSAGE_CHARS)}…[TRUNCATED]`;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Legacy error-string mapping (explicit, tested)
 * ------------------------------------------------------------------ */

/**
 * Map a legacy free-form kernel/action error string onto the new taxonomy.
 * Matching is case-insensitive substring based; order matters (most specific
 * first). Unknown strings fall back to INTERNAL_ERROR so nothing is lost.
 */
const LEGACY_ERROR_MAP: Array<{ test: (s: string) => boolean; code: BrowserErrorCode }> = [
  { test: s => s.includes('action_target_stale') || s.includes('stale'), code: 'TARGET_STALE' },
  { test: s => s.includes('not found') || s.includes('not_found'), code: 'TARGET_NOT_FOUND' },
  { test: s => s.includes('ambiguous') || s.includes('multiple matches'), code: 'TARGET_AMBIGUOUS' },
  { test: s => s.includes('no_effect') || s.includes('no effect'), code: 'ACTION_NO_EFFECT' },
  { test: s => s.includes('url_not_allowed') || s.includes('blocked'), code: 'PROVIDER_BLOCKED' },
  {
    test: s => s.includes('unauthorized') || s.includes('401') || s.includes('api key'),
    code: 'PROVIDER_UNAUTHORIZED',
  },
  { test: s => s.includes('rate') || s.includes('429'), code: 'PROVIDER_RATE_LIMITED' },
  { test: s => s.includes('timeout') || s.includes('timed out'), code: 'PROVIDER_TIMEOUT' },
  { test: s => s.includes('detached') || s.includes('target closed'), code: 'DEBUGGER_DETACHED' },
  {
    test: s => s.includes('page_unavailable') || s.includes('404') || s.includes('not available'),
    code: 'PAGE_UNAVAILABLE',
  },
  { test: s => s.includes('user_in_control') || s.includes('user took control'), code: 'USER_IN_CONTROL' },
  { test: s => s.includes('service_worker') || s.includes('service worker'), code: 'SERVICE_WORKER_RESTARTED' },
  { test: s => s.includes('validation'), code: 'VALIDATION_UNAVAILABLE' },
];

export function mapLegacyErrorToCode(legacyMessage: string): BrowserErrorCode {
  const s = legacyMessage.toLowerCase();
  for (const entry of LEGACY_ERROR_MAP) {
    if (entry.test(s)) return entry.code;
  }
  return 'INTERNAL_ERROR';
}

/** Convert a legacy error string into a full BrowserError. */
export function legacyErrorToBrowserError(legacyMessage: string): BrowserError {
  const code = mapLegacyErrorToCode(legacyMessage);
  return makeBrowserError(code, `${code}: ${legacyMessage}`);
}
