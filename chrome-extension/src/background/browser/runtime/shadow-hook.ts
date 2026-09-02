/**
 * Shadow Mode hook seam (C6). NOT WIRED — no production path imports this
 * file, and the default runtime mode is `legacy`, so current behavior is
 * unchanged. Real parallel execution (observe twice / plan twice / run once,
 * behind the generalSettings storage flag) is the third batch's job: it adds
 * the @chijie/browser-runtime dependency to chrome-extension and passes the
 * pure ShadowComparator + shadowOnce report builder into this factory.
 *
 * Structural mirrors only: chrome-extension must not import the runtime
 * package yet, so the side/comparison shapes below mirror
 * packages/browser-runtime/src/shadow.ts (ShadowSide / ShadowComparison)
 * at the minimum fields the seam needs. Keep them in sync.
 */

export type ShadowModeValue = 'legacy' | 'v2-shadow' | 'v2-active';

/** Mirror of browser-runtime ShadowSide. */
export interface ShadowSideLike {
  target: unknown;
  actionKind: string;
  error: string | null;
}

/** Mirror of browser-runtime ShadowComparison. */
export interface ShadowComparisonLike {
  kind: 'match' | 'divergence';
  axes: string[];
}

export interface ShadowHook<TReport> {
  /** Compare one already-produced legacy outcome against one v2 outcome. */
  onRound(legacy: ShadowSideLike, v2: ShadowSideLike): TReport;
}

export interface ShadowHookDeps<TReport> {
  /** Raw config value (e.g. generalSettings.runtimeMode). Anything but
   *  'v2-shadow' — including 'v2-active' and garbage — disables the hook. */
  runtimeMode: unknown;
  compare(legacy: ShadowSideLike, v2: ShadowSideLike): ShadowComparisonLike;
  buildReport(legacy: ShadowSideLike, v2: ShadowSideLike, comparison: ShadowComparisonLike): TReport;
}

/**
 * Default-off factory: returns a hook only while the mode is exactly
 * 'v2-shadow'; flipping the setting back to 'legacy' (or any invalid value)
 * returns null on the next resolve, which is the instant-rollback guarantee.
 */
export function createShadowHook<TReport>(deps: ShadowHookDeps<TReport>): ShadowHook<TReport> | null {
  if (deps.runtimeMode !== 'v2-shadow') return null;
  return {
    onRound: (legacy, v2) => deps.buildReport(legacy, v2, deps.compare(legacy, v2)),
  };
}
