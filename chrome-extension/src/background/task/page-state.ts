/**
 * product/007 P0 — immutable observe + act/expect outcomes.
 * stateId/pageRevision binding; stale reject; worked|didnt|unknown.
 * Delivery of an event is not semantic success.
 */

export type ActOutcome = 'worked' | 'didnt' | 'unknown';

export type StaleRejectReason = 'stale_page_revision' | 'stale_target_ref';

export interface PageRevisionParts {
  tabId: number;
  urlOrigin: string;
  /** Digest of page/DOM snapshot or primary bound target for this observation. */
  snapshotDigest: string;
}

/** Stable id for one observe result; refs are only valid against this id. */
export function makePageRevision(parts: PageRevisionParts): string {
  return `${parts.tabId}|${parts.urlOrigin}|${parts.snapshotDigest}`;
}

/**
 * Mutating actions may claim the revision (and optional target digest) they planned against.
 * Mismatch → reject; force re-observe (007 hard rule 1).
 */
export function assertMutableStateBinding(input: {
  claimedRevision?: string | null;
  observedRevision?: string | null;
  claimedTargetDigest?: string | null;
  observedTargetDigest?: string | null;
}): { ok: true } | { ok: false; reason: StaleRejectReason; message: string } {
  if (input.claimedRevision) {
    if (!input.observedRevision) {
      return {
        ok: false,
        reason: 'stale_page_revision',
        message: 'Claimed pageRevision but observation has no revision; re-observe required',
      };
    }
    if (input.claimedRevision !== input.observedRevision) {
      return {
        ok: false,
        reason: 'stale_page_revision',
        message: 'Action pageRevision does not match current observation',
      };
    }
  }

  if (
    input.claimedTargetDigest &&
    input.observedTargetDigest &&
    input.claimedTargetDigest !== input.observedTargetDigest
  ) {
    return {
      ok: false,
      reason: 'stale_target_ref',
      message: 'Target ref is not valid for current observation',
    };
  }

  return { ok: true };
}

export function classifyActOutcome(input: {
  actionError?: string | null;
  effect: 'read' | 'reversible' | 'external_commit';
  /** Post-condition evidence from after-observe / expect. */
  expectEvidence: Array<{ passed: boolean; reason?: string }>;
  /** True when caller supplied expect or after-observe produced criterion evidence. */
  hasExpect: boolean;
  /** Transport throw / commit path marked uncertain. */
  uncertain?: boolean;
}): ActOutcome {
  if (input.uncertain) return 'unknown';

  if (input.actionError) {
    if (/unknown|uncertain|timeout|timed.?out/i.test(input.actionError)) return 'unknown';
    return 'didnt';
  }

  if (input.hasExpect) {
    if (input.expectEvidence.length === 0) return 'unknown';
    if (input.expectEvidence.every(e => e.passed)) return 'worked';
    if (input.expectEvidence.some(e => e.reason === 'timed_out' || e.reason === 'stale')) {
      return 'unknown';
    }
    return 'didnt';
  }

  // No expect: event delivery ≠ business success for external commit (007).
  if (input.effect === 'external_commit') return 'unknown';
  return 'worked';
}

/**
 * 007: expect fail or unknown must not mark task completed.
 * Verified complete requires completion criteria pass (page evidence), not model done alone.
 */
export function allowsVerifiedComplete(input: {
  completionPassed: boolean;
  hasRequiredCriteria: boolean;
  /** Optional: last act outcomes that still lack page proof (unused when criteria prove). */
  blockingOutcomes?: ActOutcome[];
}): boolean {
  if (!input.hasRequiredCriteria) return false;
  if (!input.completionPassed) return false;
  const blockers = input.blockingOutcomes ?? [];
  // If caller still tracks unresolved acts, unknown/didnt block until criteria replace them.
  // When criteria already passed, treat them as the expect proof and allow.
  if (input.completionPassed) return true;
  return !blockers.some(o => o === 'unknown' || o === 'didnt');
}

/** Extract claimed state fields from model/action args (snake or camel). */
export function readClaimedState(rawArgs: unknown): {
  pageRevision?: string;
  targetDigest?: string;
  hasExpectFlag: boolean;
} {
  if (!rawArgs || typeof rawArgs !== 'object' || Array.isArray(rawArgs)) {
    return { hasExpectFlag: false };
  }
  const args = rawArgs as Record<string, unknown>;
  const pageRevision =
    (typeof args.pageRevision === 'string' && args.pageRevision) ||
    (typeof args.page_revision === 'string' && args.page_revision) ||
    (typeof args.stateId === 'string' && args.stateId) ||
    (typeof args.state_id === 'string' && args.state_id) ||
    undefined;
  const targetDigest =
    (typeof args.targetDigest === 'string' && args.targetDigest) ||
    (typeof args.target_digest === 'string' && args.target_digest) ||
    undefined;
  const hasExpectFlag =
    args.expect != null ||
    args.expect_ui != null ||
    (Array.isArray(args.completion_criteria) && args.completion_criteria.length > 0);
  return { pageRevision: pageRevision || undefined, targetDigest: targetDigest || undefined, hasExpectFlag };
}
