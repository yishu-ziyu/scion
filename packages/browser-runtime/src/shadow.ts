/**
 * Shadow Mode comparator (C6).
 *
 * Shadow Mode runs the v2 path *alongside* the legacy path without letting
 * either v2 output reach the browser: legacy still owns execution, v2 only
 * plans. This module is the comparison half of that arrangement and is pure
 * by construction — it takes two already-produced outcomes and returns a
 * report. It never holds an executor, never calls one, and never writes.
 *
 * Three axes are compared (EPIC C6):
 *   1. target      the identity both paths aimed at (backendNodeId / cssPath /
 *                  frameId / tabId / mediaId — never text, label or value)
 *   2. actionKind  the action vocabulary both paths resolved to
 *   3. error       the BrowserErrorCode classification both paths landed on
 *
 * Privacy: divergence details are built from identity/enum summaries only,
 * and the whole report is scrubbed through `redactErrorText` before it is
 * returned, so a raw input_text value can never ride into a persisted report.
 *
 * Real parallel execution (observe twice, plan twice, run once) is the third
 * batch's job; see chrome-extension/.../runtime/shadow-hook.ts for the
 * default-off wiring seam this logic is designed for.
 */
import {
  TRACE_SCHEMA_VERSION,
  mapLegacyErrorToCode,
  redactErrorText,
  type ActionReceipt,
  type BrowserAction,
  type BrowserActionKind,
  type BrowserErrorCode,
  type BrowserTarget,
  type TraceRecord,
} from '@chijie/browser-protocol';
import type { TargetResolution } from './target-resolver';

/** Report format version, independent of the protocol/trace schema versions. */
export const SHADOW_REPORT_VERSION = 1 as const;

/** The compared axes; also the divergence report vocabulary. */
export type ShadowAxis = 'target' | 'actionKind' | 'error';
export const SHADOW_AXES: readonly ShadowAxis[] = ['target', 'actionKind', 'error'];

/* ------------------------------------------------------------------ *
 * Normalized side shapes
 * ------------------------------------------------------------------ */

/**
 * Identity both paths targeted, reduced to comparable stable parts.
 * `none` = the action legitimately carries no target; `unresolved` = the path
 * could not pin a target down (reason is the resolution verdict or the legacy
 * locator that failed).
 */
export type ShadowTarget =
  | { kind: 'element'; backendNodeId?: number; cssPath?: string; frameId?: string }
  | { kind: 'page'; tabId: number }
  | { kind: 'frame'; frameId: string }
  | { kind: 'media'; mediaId: string }
  | { kind: 'none' }
  | { kind: 'unresolved'; reason: string };

/** One path's outcome, already reduced to the three comparable axes. */
export interface ShadowSide {
  target: ShadowTarget;
  actionKind: string;
  error: BrowserErrorCode | null;
}

export interface ShadowComparison {
  kind: 'match' | 'divergence';
  axes: ShadowAxis[];
}

/* ------------------------------------------------------------------ *
 * Deriving sides
 * ------------------------------------------------------------------ */

/** Stable identity summary of a protocol target. Never carries text/value. */
export function shadowTargetOf(target: BrowserTarget): ShadowTarget {
  switch (target.kind) {
    case 'element':
      return {
        kind: 'element',
        ...(target.identity.backendNodeId !== undefined ? { backendNodeId: target.identity.backendNodeId } : {}),
        ...(target.identity.cssPath !== undefined ? { cssPath: target.identity.cssPath } : {}),
        ...(target.identity.frameId !== undefined ? { frameId: target.identity.frameId } : {}),
      };
    case 'page':
      return { kind: 'page', tabId: target.tabId };
    case 'frame':
      return { kind: 'frame', frameId: target.frameId };
    case 'media':
      return { kind: 'media', mediaId: target.mediaId };
  }
}

/** The v2 side: action + its target resolution + the receipt it produced. */
export function v2SideOf(input: {
  action: BrowserAction;
  resolution?: TargetResolution;
  receipt: ActionReceipt;
}): ShadowSide {
  const target: ShadowTarget =
    input.resolution === undefined
      ? input.action.target === null
        ? { kind: 'none' }
        : shadowTargetOf(input.action.target)
      : input.resolution.kind === 'resolved'
        ? shadowTargetOf(input.resolution.target)
        : { kind: 'unresolved', reason: input.resolution.kind };
  return { target, actionKind: input.action.kind, error: input.receipt.error?.code ?? null };
}

/** Minimal structural view of a legacy digest element (identity only). */
export interface LegacyElementLike {
  index?: number;
  backendNodeId?: number;
  cdpFrameId?: string;
  /** Legacy fallback selector, mirrors protocol/legacy.ts. */
  cssPath?: string;
  id?: string;
}

/**
 * Minimal structural view of what the legacy path decided to do. `name` is
 * the legacy action name, `args` its raw input (never copied into a report),
 * `element` the digest element it resolved to, when any.
 */
export interface LegacyPlanLike {
  name: string;
  args?: Record<string, unknown>;
  element?: LegacyElementLike | null;
  /** Legacy error string; absent/`null` = the action reported no error. */
  error?: string | null;
}

/**
 * Legacy action name -> protocol action kind. Mirrors the C2 adapter's
 * KIND_TO_LEGACY_NAME (browser-runtime must not import chrome-extension);
 * keep both tables in sync. Unmapped names pass through verbatim so the
 * divergence report shows what the legacy path actually called.
 */
export const LEGACY_NAME_TO_ACTION_KIND: Readonly<Record<string, BrowserActionKind>> = {
  go_to_url: 'navigate',
  click_element: 'click',
  input_text: 'input_text',
  select_dropdown_option: 'select_option',
  send_keys: 'send_keys',
  open_tab: 'open_tab',
  switch_tab: 'switch_tab',
  close_tab: 'close_tab',
  go_back: 'go_back',
  control_media: 'media_control',
};

/** The legacy side: name + args + resolved element + error string. */
export function legacySideOf(plan: LegacyPlanLike): ShadowSide {
  const element = plan.element;
  let target: ShadowTarget;
  if (element) {
    // cssPath fallback mirrors protocol/legacy.ts: #id, else none.
    const cssPath = element.cssPath ?? (element.id ? `#${element.id}` : undefined);
    target = {
      kind: 'element',
      ...(element.backendNodeId !== undefined ? { backendNodeId: element.backendNodeId } : {}),
      ...(cssPath !== undefined ? { cssPath } : {}),
      ...(element.cdpFrameId !== undefined ? { frameId: element.cdpFrameId } : {}),
    };
  } else if (LEGACY_TARGETLESS_ACTIONS.has(plan.name)) {
    target = { kind: 'none' };
  } else {
    target = { kind: 'unresolved', reason: legacyLocator(plan.args) };
  }
  return {
    target,
    actionKind: LEGACY_NAME_TO_ACTION_KIND[plan.name] ?? plan.name,
    error: plan.error ? mapLegacyErrorToCode(plan.error) : null,
  };
}

/** Legacy actions that legitimately address no element. */
const LEGACY_TARGETLESS_ACTIONS = new Set([
  'go_to_url',
  'send_keys',
  'open_tab',
  'switch_tab',
  'close_tab',
  'go_back',
  'control_media',
]);

/** A legacy locator (index/query) — used only as an `unresolved` reason. */
function legacyLocator(args: Record<string, unknown> | undefined): string {
  if (!args) return 'no-target';
  if (typeof args.index === 'number') return `index:${args.index}`;
  if (typeof args.query === 'string' && args.query) return 'query';
  return 'no-target';
}

/* ------------------------------------------------------------------ *
 * Comparator
 * ------------------------------------------------------------------ */

/**
 * Comparable identity key for one side; null = nothing comparable (two
 * nulls never match — shadow mode exists to surface exactly that gap, not
 * to paper over it). backendNodeId wins; cssPath is the fallback.
 */
function targetKey(target: ShadowTarget): string | null {
  switch (target.kind) {
    case 'none':
      return 'none';
    case 'unresolved':
      return `unresolved:${target.reason}`;
    case 'page':
      return `page:${target.tabId}`;
    case 'frame':
      return `frame:${target.frameId}`;
    case 'media':
      return `media:${target.mediaId}`;
    case 'element':
      if (target.backendNodeId !== undefined) return `element:node=${target.backendNodeId}`;
      if (target.cssPath !== undefined) return `element:css=${target.cssPath}`;
      return null;
  }
}

function targetsMatch(a: ShadowTarget, b: ShadowTarget): boolean {
  const left = targetKey(a);
  return left !== null && left === targetKey(b);
}

/** Comparable, non-sensitive summary of one axis value. */
function axisSummary(side: ShadowSide, axis: ShadowAxis): string {
  if (axis === 'actionKind') return side.actionKind;
  if (axis === 'error') return side.error ?? 'ok';
  const target = side.target;
  switch (target.kind) {
    case 'element':
      return `element(${target.backendNodeId !== undefined ? `node=${target.backendNodeId}` : `css=${target.cssPath}`}${target.frameId ? `@${target.frameId}` : ''})`;
    case 'page':
      return `page(tab=${target.tabId})`;
    case 'frame':
      return `frame(${target.frameId})`;
    case 'media':
      return `media(${target.mediaId})`;
    case 'none':
      return 'none';
    case 'unresolved':
      return `unresolved(${target.reason})`;
  }
}

/** Pure three-axis comparison. */
export function compareShadowSides(legacy: ShadowSide, v2: ShadowSide): ShadowComparison {
  const axes = SHADOW_AXES.filter(axis => {
    if (axis === 'actionKind') return legacy.actionKind !== v2.actionKind;
    if (axis === 'error') return legacy.error !== v2.error;
    return !targetsMatch(legacy.target, v2.target);
  });
  return axes.length === 0 ? { kind: 'match', axes: [] } : { kind: 'divergence', axes };
}

/**
 * ShadowComparator: the comparison seam the third batch hands both paths'
 * outcomes to. Stateless and side-effect free — constructing it takes no
 * executor, so "shadow never acts" is structural, not a convention.
 */
export class ShadowComparator {
  compare(input: { legacy: ShadowSide; v2: ShadowSide }): ShadowComparison {
    return compareShadowSides(input.legacy, input.v2);
  }
}

/* ------------------------------------------------------------------ *
 * Report
 * ------------------------------------------------------------------ */

export interface ShadowDivergenceAxis {
  axis: ShadowAxis;
  legacy: string;
  v2: string;
}

export interface ShadowReport {
  version: typeof SHADOW_REPORT_VERSION;
  /** Always `shadow`; distinguishes these records in any sink. */
  kind: 'shadow';
  outcome: 'match' | 'divergence';
  taskId: string;
  roundId: string;
  /** Build revision; left empty by callers that do not know it. */
  gitSha: string;
  at: number;
  axes: ShadowDivergenceAxis[];
}

export interface ShadowReportOptions {
  taskId: string;
  roundId: string;
  at: number;
  gitSha?: string;
  comparator?: ShadowComparator;
}

/** Scrub every string in a value through the protocol error redactor. */
function scrub<T>(value: T): T {
  if (typeof value === 'string') return redactErrorText(value) as T;
  if (Array.isArray(value)) return value.map(scrub) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) out[key] = scrub(entry);
    return out as T;
  }
  return value;
}

/**
 * Compare one legacy outcome against one v2 outcome and produce a serializable
 * report. Pure: it takes results that already exist and never executes them.
 */
export function shadowOnce(
  legacyPlan: LegacyPlanLike,
  v2Plan: { action: BrowserAction; resolution?: TargetResolution; receipt: ActionReceipt },
  options: ShadowReportOptions,
): ShadowReport {
  const comparator = options.comparator ?? new ShadowComparator();
  const legacy = legacySideOf(legacyPlan);
  const v2 = v2SideOf(v2Plan);
  const comparison = comparator.compare({ legacy, v2 });
  const axes: ShadowDivergenceAxis[] =
    comparison.kind === 'match'
      ? []
      : comparison.axes.map(axis => ({ axis, legacy: axisSummary(legacy, axis), v2: axisSummary(v2, axis) }));
  return scrub({
    version: SHADOW_REPORT_VERSION,
    kind: 'shadow' as const,
    outcome: comparison.kind,
    taskId: options.taskId,
    roundId: options.roundId,
    gitSha: options.gitSha ?? '',
    at: options.at,
    axes,
  });
}

/* ------------------------------------------------------------------ *
 * H1 Replay Trace compatibility
 * ------------------------------------------------------------------ */

/**
 * Map a shadow report onto the H1 trace envelope as a `task_event` record,
 * so shadow findings ride the same persistence pipeline as every other trace
 * record instead of inventing a format. `event` names the outcome; the
 * already-scrubbed axes ride in `detail`.
 */
export function shadowReportToTraceRecord(
  report: ShadowReport,
  envelope: { seq: number; recordedAt: number },
): TraceRecord {
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    seq: envelope.seq,
    taskId: report.taskId,
    roundId: report.roundId,
    recordedAt: envelope.recordedAt,
    type: 'task_event',
    event: `shadow.${report.outcome}`,
    detail: { version: report.version, gitSha: report.gitSha, at: report.at, axes: report.axes },
  };
}
