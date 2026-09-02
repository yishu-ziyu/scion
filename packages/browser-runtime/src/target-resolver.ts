/**
 * Unified TargetResolver (C4).
 *
 * Resolves a stored target reference (or a text query) against the current
 * observation. Checks, in order:
 *   1. target revision still valid   2. backendNodeId still present
 *   3. frame still accessible        4. query/identity unique
 *   5. safe re-binding possible      6. otherwise re-observation required
 *
 * Hard rules (EPIC C4):
 * - Ambiguity never auto-picks the first candidate; it returns `ambiguous`
 *   with the full candidate list.
 * - Resolution failures are structured values, never thrown exceptions
 *   (an unmounted iframe yields `missing`/`stale`, not an Error).
 * - A failed resolution never consumes the action — an external_commit
 *   must not fire against a target we could not pin down.
 * - Re-binding an old target to the same identity in a newer revision
 *   emits a `target.rebound` trace event.
 *
 * Semantics mirror the legacy code paths (kernel/resolve-intent.ts,
 * agent/backends/queued-action-target.ts, page.ts observeActionTarget)
 * without importing them.
 */
import {
  makeBrowserError,
  targetPageRevision,
  type ActionReceipt,
  type BrowserAction,
  type BrowserObservation,
  type BrowserTarget,
  type ElementTarget,
} from '@chijie/browser-protocol';
import type { ClockPort, RuntimeTracePort } from './ports';

/** A text query resolved against the observation's interactive elements. */
export interface QueryTargetRef {
  kind: 'query';
  query: string;
}

/** Anything resolveTarget accepts: a stored protocol target or a text query. */
export type TargetRef = BrowserTarget | QueryTargetRef;

export type TargetResolution =
  | { kind: 'resolved'; target: BrowserTarget }
  /** Identity was known but the revision it belonged to is gone → re-observe. */
  | { kind: 'stale' }
  /** Identity never resolved in the current revision. */
  | { kind: 'missing' }
  /** Multiple candidates; the first is deliberately NOT auto-picked. */
  | { kind: 'ambiguous'; candidates: ElementTarget[] };

export interface TargetResolverDeps {
  trace?: RuntimeTracePort;
  clock?: ClockPort;
}

function isQueryRef(ref: TargetRef): ref is QueryTargetRef {
  return ref.kind === 'query';
}

function isFrameInaccessible(observation: BrowserObservation, frameId: string): boolean {
  return (observation.inaccessibleFrames ?? []).some(frame => frame.frameId === frameId);
}

/**
 * Stable-identity match (mirrors queued-action-target): backendNodeId wins;
 * cssPath is the fallback; an explicit frameId must match. `index` is never
 * part of identity.
 */
export function identityMatches(ref: ElementTarget, element: ElementTarget): boolean {
  if (ref.identity.frameId !== undefined && element.identity.frameId !== ref.identity.frameId) {
    return false;
  }
  if (ref.identity.backendNodeId !== undefined) {
    return element.identity.backendNodeId === ref.identity.backendNodeId;
  }
  return ref.identity.cssPath !== undefined && element.identity.cssPath === ref.identity.cssPath;
}

/** Same label binding as legacy resolve-intent: text → label → placeholder. */
function bindLabel(element: ElementTarget): string {
  return (element.text ?? element.label ?? element.placeholder ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function uniqueVerdict(matches: ElementTarget[], sameRevision: boolean, staleOnMiss: boolean): TargetResolution | null {
  if (matches.length === 1) return null; // caller continues with matches[0]
  if (matches.length > 1) return { kind: 'ambiguous', candidates: matches };
  return staleOnMiss && !sameRevision ? { kind: 'stale' } : { kind: 'missing' };
}

async function resolveElement(
  observation: BrowserObservation,
  ref: ElementTarget,
  deps: TargetResolverDeps,
): Promise<TargetResolution> {
  // 3) frame must still be reachable — an unmounted iframe can never
  //    contain the node, and this is a structured verdict, not a throw.
  if (ref.identity.frameId !== undefined && isFrameInaccessible(observation, ref.identity.frameId)) {
    // 1)+6) same revision → gone for good (missing); newer revision → re-observe.
    return ref.pageRevision === observation.pageRevision ? { kind: 'missing' } : { kind: 'stale' };
  }

  // 2)+4) identity lookup; >1 match is ambiguous, never first-picked.
  const matches = observation.interactiveElements.filter(element => identityMatches(ref, element));
  const sameRevision = ref.pageRevision === observation.pageRevision;
  const verdict = uniqueVerdict(matches, sameRevision, true);
  if (verdict) return verdict;
  const found = matches[0]!;

  if (sameRevision) {
    return { kind: 'resolved', target: { ...ref, index: found.index } };
  }

  // 5) safe re-binding: same stable identity in a newer revision (e.g. only
  //    the digest index moved). Update revision + index and leave a trace.
  const rebound: ElementTarget = { ...ref, pageRevision: observation.pageRevision, index: found.index };
  if (deps.trace) {
    await deps.trace.emit({
      kind: 'target.rebound',
      fromRevision: ref.pageRevision,
      toRevision: observation.pageRevision,
      backendNodeId: ref.identity.backendNodeId,
      cssPath: ref.identity.cssPath,
      at: deps.clock?.now() ?? observation.observedAt,
    });
  }
  return { kind: 'resolved', target: rebound };
}

function resolveQuery(observation: BrowserObservation, query: string): TargetResolution {
  const needle = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!needle) return { kind: 'missing' };
  const matches = observation.interactiveElements.filter(element => bindLabel(element).includes(needle));
  const verdict = uniqueVerdict(matches, true, false);
  if (verdict) return verdict;
  return { kind: 'resolved', target: matches[0]! };
}

/**
 * Non-element kinds: existence in the current observation plus revision
 * validity. A newer revision always yields `stale` (re-observe) because the
 * identity could not be re-verified across document changes.
 */
function resolveByPresence(observation: BrowserObservation, ref: BrowserTarget, present: boolean): TargetResolution {
  const sameRevision = targetPageRevision(ref) === observation.pageRevision;
  if (present && sameRevision) return { kind: 'resolved', target: ref };
  if (present && !sameRevision) return { kind: 'stale' };
  return sameRevision ? { kind: 'missing' } : { kind: 'stale' };
}

export async function resolveTarget(
  observation: BrowserObservation,
  ref: TargetRef,
  deps: TargetResolverDeps = {},
): Promise<TargetResolution> {
  if (isQueryRef(ref)) return resolveQuery(observation, ref.query);
  switch (ref.kind) {
    case 'element':
      return resolveElement(observation, ref, deps);
    case 'page':
      return resolveByPresence(observation, ref, ref.tabId === observation.page.tabId);
    case 'frame':
      return resolveByPresence(observation, ref, !isFrameInaccessible(observation, ref.frameId));
    case 'media':
      return resolveByPresence(observation, ref, observation.media !== undefined && observation.media.kind !== 'none');
  }
}

/**
 * Receipt for a resolution failure. Deterministic refusal before execution,
 * so the status is `blocked` with the matching TARGET_* error code.
 */
export function targetFailureReceipt(
  action: BrowserAction,
  resolution: Exclude<TargetResolution, { kind: 'resolved' }>,
  beforeRevision: string,
): ActionReceipt {
  const error =
    resolution.kind === 'stale'
      ? makeBrowserError('TARGET_STALE', `target revision is gone; re-observe before retrying ${action.kind}`)
      : resolution.kind === 'missing'
        ? makeBrowserError('TARGET_NOT_FOUND', `target never resolved in the current page; ${action.kind} did not act`)
        : makeBrowserError(
            'TARGET_AMBIGUOUS',
            `target matched ${resolution.candidates.length} elements; ${action.kind} did not act`,
          );
  return {
    actionId: action.actionId,
    status: 'blocked',
    beforeRevision,
    evidence: [],
    error,
  };
}

export interface TargetedExecutionDeps extends TargetResolverDeps {
  snapshot: { observe(): Promise<BrowserObservation> };
  executor: { execute(action: BrowserAction): Promise<ActionReceipt> };
}

/**
 * Observe → resolve → execute glue. On `stale`/`missing`/`ambiguous` the
 * executor is NEVER called, so an external_commit action cannot consume its
 * one-shot effect on a target we could not pin down.
 */
export async function executeWithTargetResolution(
  deps: TargetedExecutionDeps,
  action: BrowserAction,
): Promise<{ resolution?: TargetResolution; receipt: ActionReceipt }> {
  const observation = await deps.snapshot.observe();
  if (action.target === null) {
    return { receipt: await deps.executor.execute(action) };
  }
  const resolution = await resolveTarget(observation, action.target, deps);
  if (resolution.kind !== 'resolved') {
    return {
      resolution,
      receipt: targetFailureReceipt(action, resolution, observation.pageRevision),
    };
  }
  const receipt = await deps.executor.execute({ ...action, target: resolution.target });
  return { resolution, receipt };
}
