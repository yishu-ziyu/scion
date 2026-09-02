/**
 * Error-source discriminators for normalizeError (I1).
 *
 * All checks are structural duck-typing on `unknown` — no imports from
 * `ai` / `@langchain/*` here, so the layer stays cheap to load in the
 * service worker and testable with plain fakes that mimic the real shapes
 * (verified against ai@7.0.83: `name === 'AI_APICallError'` with a numeric
 * `statusCode`; @langchain/core@0.3.79: errors carry `lc_error_code`).
 */

/** The eight origins normalizeError knows how to interpret. */
export type ErrorSource =
  | 'langchain'
  | 'ai-sdk'
  | 'provider-http'
  | 'chrome-debugger'
  | 'page-evaluate'
  | 'target-resolver'
  | 'verification'
  | 'storage';

export const ERROR_SOURCES: readonly ErrorSource[] = [
  'langchain',
  'ai-sdk',
  'provider-http',
  'chrome-debugger',
  'page-evaluate',
  'target-resolver',
  'verification',
  'storage',
];

/** Flattened text of any thrown value (Error message, or String()). */
export function errorTextOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === 'string') return value;
  try {
    return String(value ?? '');
  } catch {
    return '[unprintable]';
  }
}

/** Error.name for branching on known error classes without importing them. */
export function errorNameOf(value: unknown): string {
  if (value instanceof Error) return value.name;
  return '';
}

/** HTTP status carried by AI SDK / fetch / provider errors, if any. */
export function httpStatusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { statusCode?: unknown; status?: unknown };
  if (typeof v.statusCode === 'number') return v.statusCode;
  if (typeof v.status === 'number') return v.status;
  return undefined;
}

/** LangChain `lc_error_code` marker (set by addLangChainErrorFields). */
export function langChainErrorCodeOf(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const code = (value as { lc_error_code?: unknown }).lc_error_code;
  return typeof code === 'string' ? code : undefined;
}
