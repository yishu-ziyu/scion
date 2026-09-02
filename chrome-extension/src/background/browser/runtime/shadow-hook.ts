/**
 * Shadow Mode hook seam (C6) — WIRED. The default runtime mode is `legacy`,
 * so current behavior is unchanged: this module only composes the pure
 * @chijie/browser-runtime comparator + report builder behind the
 * generalSettings runtimeMode flag. Structural mirrors are gone — the side /
 * comparison / report shapes below are the real runtime types.
 *
 * The hook stays plan-level: callers hand it the legacy outcome digest plus
 * the v2 side's *planned* (never executed) action, and the factory reduces
 * them via legacySideOf / v2SideOf before comparing.
 */
import type { ActionReceipt, BrowserAction } from '@chijie/browser-protocol';
import {
  legacySideOf,
  v2SideOf,
  type LegacyPlanLike,
  type ShadowComparison,
  type ShadowReport,
  type ShadowSide,
  type TargetResolution,
} from '@chijie/browser-runtime';

/** The v2 side of one round: a planned action plus its target resolution and
 *  its (synthetic, error-free) receipt. Plans only — never executed. */
export interface ShadowV2Plan {
  action: BrowserAction;
  resolution?: TargetResolution;
  receipt: ActionReceipt;
}

export interface ShadowHook {
  /** Compare one already-produced legacy outcome against one v2 plan. */
  onRound(legacy: LegacyPlanLike, v2: ShadowV2Plan): ShadowReport;
}

export interface ShadowHookDeps {
  /** Raw config value (e.g. generalSettings.runtimeMode). Anything but
   *  'v2-shadow' — including 'v2-active' and garbage — disables the hook. */
  runtimeMode: unknown;
  /** Real comparator: ShadowComparator#compare from @chijie/browser-runtime. */
  compare(legacy: ShadowSide, v2: ShadowSide): ShadowComparison;
  /** Real report builder: shadowOnce from @chijie/browser-runtime (it re-derives
   *  the same comparison internally and scrubs the report before returning). */
  buildReport(legacy: LegacyPlanLike, v2: ShadowV2Plan, comparison: ShadowComparison): ShadowReport;
}

/**
 * Default-off factory: returns a hook only while the mode is exactly
 * 'v2-shadow'; flipping the setting back to 'legacy' (or any invalid value)
 * returns null on the next resolve, which is the instant-rollback guarantee.
 */
export function createShadowHook(deps: ShadowHookDeps): ShadowHook | null {
  if (deps.runtimeMode !== 'v2-shadow') return null;
  return {
    onRound: (legacy, v2) => deps.buildReport(legacy, v2, deps.compare(legacySideOf(legacy), v2SideOf(v2))),
  };
}
