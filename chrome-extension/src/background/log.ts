/// <reference types="vite/client" />

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warning: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  group: (label: string) => void;
  groupEnd: () => void;
}

// Fields whose string values are masked wholesale, regardless of content.
const SECRET_FIELD_NAME =
  /^(api[-_]?key|authorization|proxy-authorization|x-api-key|access[-_]?token|refresh[-_]?token|secret)$/i;
// Key-shaped values inside free text: sk-... keys and Bearer tokens.
const KEY_VALUE_PATTERN = /sk-[A-Za-z0-9_-]{4,}|Bearer\s+[A-Za-z0-9._~+/=-]{8,}/g;

const maskToken = (token: string): string => (token.length <= 4 ? '***' : `***${token.slice(-4)}`);

/**
 * Redact API keys before they reach the console. Strings are scanned for
 * key-shaped values; plain objects get sensitive fields masked and nested
 * values scanned (depth-limited, cycle-safe).
 */
const redactValue = (value: unknown, seen: WeakSet<object>, depth: number): unknown => {
  if (typeof value === 'string') {
    return value.replace(KEY_VALUE_PATTERN, match => maskToken(match));
  }
  if (!value || typeof value !== 'object' || depth > 6) {
    return value;
  }
  if (seen.has(value)) {
    return '[circular]';
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map(item => redactValue(item, seen, depth + 1));
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    // Class instance (Error, LangChain objects, ...): only scrub its message.
    if (value instanceof Error) {
      return redactValue(value.message, seen, depth + 1);
    }
    return value;
  }
  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    redacted[key] =
      SECRET_FIELD_NAME.test(key) && typeof fieldValue === 'string' && fieldValue
        ? maskToken(fieldValue)
        : redactValue(fieldValue, seen, depth + 1);
  }
  return redacted;
};

const redactArgs = (args: unknown[]): unknown[] => args.map(arg => redactValue(arg, new WeakSet(), 0));

const createLogger = (namespace: string): Logger => {
  const prefix = `[${namespace}]`;

  // Bind console methods so output keeps the console prefix; arguments are
  // redacted before printing so API keys never reach the logs.
  const boundDebug = console.debug.bind(console, prefix);
  const boundInfo = console.info.bind(console, prefix);
  const boundWarn = console.warn.bind(console, prefix);
  const boundError = console.error.bind(console, prefix);
  const boundGroup = console.group.bind(console);
  const boundGroupEnd = console.groupEnd.bind(console);

  return {
    debug: import.meta.env.DEV ? (...args: unknown[]) => boundDebug(...redactArgs(args)) : () => {},
    info: (...args: unknown[]) => boundInfo(...redactArgs(args)),
    warning: (...args: unknown[]) => boundWarn(...redactArgs(args)),
    error: (...args: unknown[]) => boundError(...redactArgs(args)),
    group: (label: string) => boundGroup(`${prefix} ${label}`),
    groupEnd: boundGroupEnd,
  };
};

// Create default logger
const logger = createLogger('Agent');

export type { Logger, LogLevel };
export { createLogger, logger };
