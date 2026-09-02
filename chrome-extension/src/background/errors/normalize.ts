/**
 * normalizeError — the I1 error-normalization layer.
 *
 * Converts errors from the eight known sources (LangChain, AI SDK,
 * OpenAI-compatible HTTP, chrome.debugger, page evaluate, TargetResolver,
 * Verification, Storage) into a single structured BrowserError from
 * @chijie/browser-protocol, plus a `source` tag and a `debugDetail` field.
 *
 * Contract:
 * - `message` is user-visible-safe: redacted via redactErrorText (secrets)
 *   and HTML-stripped (page dumps). Raw detail never rides along.
 * - `debugDetail` carries the original text for LOCAL debug logs only
 *   (createLogger already masks; this field must never reach the UI or a
 *   receipt).
 * - `retryable` + `origin` come from the protocol's BrowserError, so a
 *   retry policy can decide on the structured `code` alone.
 *   FUTURE WIRING: retry-policy.ts classifyRetry() should be replaced by
 *   normalizeError(...).code / .retryable (see retryHintForCode below);
 *   this layer is NOT yet wired into any production path.
 *
 * ponytail: source-specific detection is substring/shape matching on
 * `unknown` — the ceiling is misclassification of exotic error texts.
 * Upgrade path: throw typed error classes at each source and match on
 * instanceof instead of strings.
 */
import {
  BrowserErrorCodeSchema,
  makeBrowserError,
  mapLegacyErrorToCode,
  type BrowserError,
  type BrowserErrorCode,
} from '@chijie/browser-protocol';
import { errorNameOf, errorTextOf, httpStatusOf, langChainErrorCodeOf, type ErrorSource } from './sources';

export type { ErrorSource } from './sources';
export { ERROR_SOURCES } from './sources';

/** BrowserError plus normalization metadata. */
export interface NormalizedError extends BrowserError {
  /** Which subsystem threw it. */
  source: ErrorSource;
  /**
   * Original error text for local debug logs ONLY (truncated). Never put
   * this in a user-visible message, receipt, or telemetry payload.
   */
  debugDetail: string;
}

/** Cap so a megabyte page dump can't ride into memory via debug logs. */
const MAX_DEBUG_DETAIL_CHARS = 2000;

/** Strip HTML tags; page-evaluate errors often embed markup dumps. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Structured retry hint derived from the code alone — the intended future
 * input for retry-policy.ts (replaces free-text classifyRetry matching).
 * The switch is exhaustive over BrowserErrorCode; adding a code to the
 * protocol makes this a compile error until it's classified here.
 */
export type RetryHint = 'retry' | 'backoff' | 'stop';

export function retryHintForCode(code: BrowserErrorCode): RetryHint {
  switch (code) {
    case 'PROVIDER_RATE_LIMITED':
    case 'PROVIDER_TIMEOUT':
      return 'backoff';
    case 'TARGET_STALE':
    case 'DEBUGGER_DETACHED':
    case 'PAGE_UNAVAILABLE':
    case 'VALIDATION_UNAVAILABLE':
    case 'SERVICE_WORKER_RESTARTED':
      return 'retry';
    case 'PROVIDER_UNAUTHORIZED':
    case 'PROVIDER_BLOCKED':
    case 'TARGET_NOT_FOUND':
    case 'TARGET_AMBIGUOUS':
    case 'ACTION_NO_EFFECT':
    case 'USER_IN_CONTROL':
    case 'INTERNAL_ERROR':
      return 'stop';
    default:
      return assertExhaustive(code);
  }
}

function assertExhaustive(value: never): never {
  throw new Error(`unhandled BrowserErrorCode: ${String(value)}`);
}

/* ------------------------------------------------------------------ *
 * Source-specific detection
 * ------------------------------------------------------------------ * */

/** AbortError / timeout text on any source means "gave up waiting". */
function looksLikeTimeout(text: string): boolean {
  const s = text.toLowerCase();
  return s.includes('timeout') || s.includes('timed out') || s.includes('etimedout') || s.includes('aborted');
}

/** 401/403/429/451/408/404 on an HTTP-capable error → provider codes. */
function codeFromHttpStatus(status: number): BrowserErrorCode | undefined {
  switch (status) {
    case 401:
      return 'PROVIDER_UNAUTHORIZED';
    case 403:
    case 404:
    case 451:
      return 'PROVIDER_BLOCKED';
    case 408:
      return 'PROVIDER_TIMEOUT';
    case 429:
      return 'PROVIDER_RATE_LIMITED';
    default:
      return undefined;
  }
}

/** LangChain's lc_error_code taxonomy → protocol codes. */
const LANGCHAIN_CODE_MAP: Record<string, BrowserErrorCode> = {
  MODEL_AUTHENTICATION: 'PROVIDER_UNAUTHORIZED',
  MODEL_RATE_LIMIT: 'PROVIDER_RATE_LIMITED',
  MODEL_NOT_FOUND: 'PROVIDER_BLOCKED',
  INVALID_PROMPT_INPUT: 'INTERNAL_ERROR',
  INVALID_TOOL_RESULTS: 'INTERNAL_ERROR',
  MESSAGE_COERCION_FAILURE: 'INTERNAL_ERROR',
  OUTPUT_PARSING_FAILURE: 'INTERNAL_ERROR',
};

function codeForLangChain(error: unknown, text: string): BrowserErrorCode {
  const lc = langChainErrorCodeOf(error);
  if (lc && LANGCHAIN_CODE_MAP[lc]) return LANGCHAIN_CODE_MAP[lc];
  const status = httpStatusOf(error);
  if (status !== undefined) {
    const byStatus = codeFromHttpStatus(status);
    if (byStatus) return byStatus;
  }
  return mapLegacyErrorToCode(text);
}

/** AI SDK (ai / @ai-sdk/*) errors: APICallError shape + known names. */
function codeForAiSdk(error: unknown, text: string): BrowserErrorCode {
  const name = errorNameOf(error);
  if (name === 'AI_APICallError' || name === 'StreamProviderError') {
    const status = httpStatusOf(error);
    const byStatus = status !== undefined ? codeFromHttpStatus(status) : undefined;
    if (byStatus) return byStatus;
    return mapLegacyErrorToCode(text);
  }
  if (name === 'LoadAPIKeyError' || name === 'NoSuchProviderError' || name === 'NoSuchModelError') {
    return 'PROVIDER_UNAUTHORIZED';
  }
  if (looksLikeTimeout(text)) return 'PROVIDER_TIMEOUT';
  const status = httpStatusOf(error);
  if (status !== undefined) {
    const byStatus = codeFromHttpStatus(status);
    if (byStatus) return byStatus;
  }
  return mapLegacyErrorToCode(text);
}

/** OpenAI-compatible HTTP errors: status first, then text. */
function codeForProviderHttp(error: unknown, text: string): BrowserErrorCode {
  const status = httpStatusOf(error);
  if (status !== undefined) {
    const byStatus = codeFromHttpStatus(status);
    if (byStatus) return byStatus;
  }
  if (looksLikeTimeout(text)) return 'PROVIDER_TIMEOUT';
  const s = text.toLowerCase();
  if (s.includes('451')) return 'PROVIDER_BLOCKED';
  return mapLegacyErrorToCode(text);
}

/**
 * chrome.debugger errors. "Canceled" is what the DevTools prompt throws
 * when the user clicks Cancel on the "extension is debugging this browser"
 * banner — the user took control, so USER_IN_CONTROL, not a detach.
 */
function codeForChromeDebugger(text: string): BrowserErrorCode {
  const s = text.toLowerCase();
  if (s === 'canceled' || s.includes('user cancelled') || s.includes('another debugger')) return 'USER_IN_CONTROL';
  if (s.includes('detached') || s.includes('target closed') || s.includes('cannot access')) return 'DEBUGGER_DETACHED';
  return mapLegacyErrorToCode(text);
}

/** Page evaluate: destroyed execution contexts and stale node handles. */
function codeForPageEvaluate(text: string): BrowserErrorCode {
  const s = text.toLowerCase();
  if (s.includes('execution context was destroyed') || s.includes('cannot find context')) return 'PAGE_UNAVAILABLE';
  if (s.includes('node is detached') || s.includes('not attached')) return 'TARGET_STALE';
  return mapLegacyErrorToCode(text);
}

/** TargetResolver: identity existed, revision/node went away. */
function codeForTargetResolver(text: string): BrowserErrorCode {
  const s = text.toLowerCase();
  if (s.includes('action target is missing') || s.includes('no longer available') || s.includes('stale')) {
    return 'TARGET_STALE';
  }
  return mapLegacyErrorToCode(text);
}

/** Verification engine failures are always the verifier being unusable. */
function codeForVerification(text: string): BrowserErrorCode {
  const s = text.toLowerCase();
  if (s.includes('timeout') || s.includes('timed out')) return 'PROVIDER_TIMEOUT';
  return 'VALIDATION_UNAVAILABLE';
}

/** Storage: quota/serialization are internal; restarts are recoverable. */
function codeForStorage(text: string): BrowserErrorCode {
  const s = text.toLowerCase();
  if (s.includes('service worker') || s.includes('context invalidated')) return 'SERVICE_WORKER_RESTARTED';
  if (s.includes('quota')) return 'INTERNAL_ERROR';
  return mapLegacyErrorToCode(text);
}

function codeForSource(source: ErrorSource, error: unknown, text: string): BrowserErrorCode {
  switch (source) {
    case 'langchain':
      return codeForLangChain(error, text);
    case 'ai-sdk':
      return codeForAiSdk(error, text);
    case 'provider-http':
      return codeForProviderHttp(error, text);
    case 'chrome-debugger':
      return codeForChromeDebugger(text);
    case 'page-evaluate':
      return codeForPageEvaluate(text);
    case 'target-resolver':
      return codeForTargetResolver(text);
    case 'verification':
      return codeForVerification(text);
    case 'storage':
      return codeForStorage(text);
    default:
      return assertExhaustive(source as never);
  }
}

/* ------------------------------------------------------------------ *
 * Public entry point
 * ------------------------------------------------------------------ * */

function isBrowserErrorLike(value: unknown): value is BrowserError {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.message === 'string' &&
    typeof v.retryable === 'boolean' &&
    BrowserErrorCodeSchema.safeParse(v.code).success
  );
}

/**
 * Convert any thrown value from `source` into a structured BrowserError.
 * Already-normalized BrowserErrors pass through (idempotent), keeping
 * their code/retryable/origin and gaining the source tag + debug detail.
 */
export function normalizeError(value: unknown, source: ErrorSource): NormalizedError {
  const rawText = errorTextOf(value);
  const debugDetail =
    rawText.length > MAX_DEBUG_DETAIL_CHARS ? `${rawText.slice(0, MAX_DEBUG_DETAIL_CHARS)}…[TRUNCATED]` : rawText;

  if (isBrowserErrorLike(value)) {
    return { ...value, source, debugDetail };
  }

  const code = codeForSource(source, value, rawText);
  const status = httpStatusOf(value);
  const statusTag = status !== undefined ? ` (HTTP ${status})` : '';
  // User-visible message: code + sanitized one-line text. redactErrorText
  // runs again inside makeBrowserError, so secrets are scrubbed twice.
  const message = `${code}${statusTag}: ${stripHtml(rawText) || 'unknown error'}`;
  return { ...makeBrowserError(code, message), source, debugDetail };
}
