/**
 * Runtime mode switch (C6).
 *
 * The compatibility-mode gate for the EPIC-C migration:
 * - `legacy`     the pre-protocol path runs alone. This is the default and
 *                stays the default until the third batch; nothing else here
 *                changes production behavior.
 * - `v2-shadow`  the legacy path still owns the browser; the v2 path only
 *                plans, and ShadowComparator (./shadow) records match /
 *                divergence reports. No v2 action ever executes.
 * - `v2-active`  the v2 runtime owns execution (third batch; not wired yet).
 *
 * Hard rule: an illegal/unknown raw value falls back to `legacy`, never
 * throws — a malformed setting must not take the browser down with it.
 * Pure module: no storage, no chrome, no side effects (the storage-backed
 * read lives on the extension side, mirroring generalSettingsStore).
 */

export const RUNTIME_MODES = ['legacy', 'v2-shadow', 'v2-active'] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/** Default mode: the current production behavior. Shadow is opt-in. */
export const DEFAULT_RUNTIME_MODE: RuntimeMode = 'legacy';

/** Parse one raw config value; anything unrecognized falls back to legacy. */
export function parseRuntimeMode(raw: unknown): RuntimeMode {
  return typeof raw === 'string' && (RUNTIME_MODES as readonly string[]).includes(raw)
    ? (raw as RuntimeMode)
    : DEFAULT_RUNTIME_MODE;
}

/**
 * Resolve the effective mode from a config object. Accepts the structural
 * minimum so callers can pass their own settings shape (GeneralSettingsConfig
 * and friends) without this package importing storage. A missing or invalid
 * `runtimeMode` key is legacy.
 */
export function resolveMode(config: { runtimeMode?: unknown } | null | undefined): RuntimeMode {
  return parseRuntimeMode(config?.runtimeMode);
}
