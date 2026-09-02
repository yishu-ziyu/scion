/**
 * Protocol version gate (B5).
 *
 * Compatibility rules:
 * - v2 is the current version and parses directly.
 * - v1 is legacy: it may ONLY enter through the Legacy Adapter in ./legacy.
 * - Any version above the current one is rejected as UNSUPPORTED_PROTOCOL_VERSION.
 * - Unknown/extra fields never crash parsing (schemas strip them).
 * - Adding an optional field is backward compatible; removing or changing a
 *   required field requires bumping BROWSER_PROTOCOL_VERSION.
 */

export const BROWSER_PROTOCOL_VERSION = 2 as const;
export const BROWSER_PROTOCOL_VERSION_STRING = '2' as const;
/** The only legacy version accepted through the adapter path. */
export const LEGACY_PROTOCOL_VERSION = 1 as const;

export const UNSUPPORTED_PROTOCOL_VERSION = 'UNSUPPORTED_PROTOCOL_VERSION' as const;
export const LEGACY_PROTOCOL_REQUIRES_ADAPTER = 'LEGACY_PROTOCOL_REQUIRES_ADAPTER' as const;

export type ProtocolGateOk = { ok: true; version: typeof BROWSER_PROTOCOL_VERSION };
export type ProtocolGateError = {
  ok: false;
  code: typeof UNSUPPORTED_PROTOCOL_VERSION | typeof LEGACY_PROTOCOL_REQUIRES_ADAPTER;
  found: string;
};
export type ProtocolGateResult = ProtocolGateOk | ProtocolGateError;

function normalizeVersion(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw)) return String(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

/**
 * Gate a `protocolVersion` field before schema parsing.
 * Returns an error for missing, malformed, legacy, or future versions.
 */
export function checkProtocolVersion(raw: unknown): ProtocolGateResult {
  const found = normalizeVersion(raw);
  if (found === null) {
    return { ok: false, code: UNSUPPORTED_PROTOCOL_VERSION, found: String(raw) };
  }
  const version = Number(found);
  if (version === BROWSER_PROTOCOL_VERSION) return { ok: true, version: BROWSER_PROTOCOL_VERSION };
  if (version === LEGACY_PROTOCOL_VERSION) {
    return { ok: false, code: LEGACY_PROTOCOL_REQUIRES_ADAPTER, found };
  }
  return { ok: false, code: UNSUPPORTED_PROTOCOL_VERSION, found };
}

/** True when a raw message carries the current protocol version. Pure. */
export function isCurrentProtocolMessage(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object') return false;
  return checkProtocolVersion((raw as { protocolVersion?: unknown }).protocolVersion).ok;
}
