/**
 * Chijie 0.2 / EPIC D2 — ordered TaskEvent protocol (contract only, not wired
 * into TaskManager yet; D3 does the wiring).
 *
 * The side panel stops re-rendering whole snapshots and instead subscribes to
 * a per-task ordered event stream. Every event carries the full envelope
 * (taskId, roundId, sequence, revision, occurredAt, eventId) so a consumer can
 * apply events with `applyTaskEvents` and remain correct across:
 * - duplicate delivery (dedup by eventId),
 * - out-of-order / replayed delivery (strict sequence check),
 * - Service Worker restart (the producer resumes numbering above the last
 *   persisted `sequence`, so the consumer never sees a regression),
 * - stale producers (an event whose `revision` is older than the snapshot is
 *   rejected instead of clobbering newer state).
 *
 * Privacy: payloads are the minimal redacted shapes. They never carry raw
 * passwords, cookies, form values, or page HTML. Browser-facing fields reuse
 * the sanitized types from @chijie/browser-protocol.
 */
import type { BrowserError, PageTarget } from '@chijie/browser-protocol';
import type { TaskStatus, WaitReason } from '@extension/storage/lib/task';

/* ------------------------------------------------------------------ *
 * Event envelope + discriminated union
 * ------------------------------------------------------------------ */

/** Fields every TaskEvent carries, used for ordering and dedup. */
export interface TaskEventEnvelope {
  /** Unique per event; consumers dedup on this (safe at-least-once delivery). */
  eventId: string;
  taskId: string;
  roundId: string;
  /** Monotonic per-task sequence assigned by the producer (never resets). */
  sequence: number;
  /** Task revision this event was produced against. */
  revision: number;
  /** Epoch ms when the event happened. */
  occurredAt: number;
}

/** Human-readable one-liner for the Activity row; never digests or secrets. */
export interface TaskProgressPayload {
  step: number;
  label: string;
  /** Sanitized page target (query/fragment-free url) when progress is page-bound. */
  page?: Pick<PageTarget, 'tabId' | 'url' | 'title'>;
}

export type TaskEvent =
  | (TaskEventEnvelope & {
      type: 'task.accepted';
      payload: { instructionSummary: string; activeTabId: number };
    })
  | (TaskEventEnvelope & {
      type: 'task.state_changed';
      payload: { from: TaskStatus; to: TaskStatus };
    })
  | (TaskEventEnvelope & {
      type: 'task.progressed';
      payload: TaskProgressPayload;
    })
  | (TaskEventEnvelope & {
      type: 'task.waiting_for_user';
      payload: {
        reason: WaitReason;
        /** UI prompt copy; options are labels only, never selectors or values. */
        ask?: { prompt: string; options: Array<{ label: string; sendText: string }> };
      };
    })
  | (TaskEventEnvelope & {
      type: 'task.candidate_produced';
      payload: {
        summary: string;
        /** Artifact identity only — artifact bodies stay behind the store API. */
        artifactIds: string[];
        artifactTitles: string[];
      };
    })
  | (TaskEventEnvelope & {
      type: 'task.verification_started';
      payload: { criterionIds: string[] };
    })
  | (TaskEventEnvelope & {
      type: 'task.verified';
      payload: { receiptId: string; criterionIds: string[] };
    })
  | (TaskEventEnvelope & {
      type: 'task.failed';
      payload: {
        /** Machine category the UI maps to copy (e.g. llm_failed). */
        category: string;
        /** Redacted error (message must not contain keys/page text/form values). */
        error?: BrowserError;
      };
    })
  | (TaskEventEnvelope & {
      type: 'task.cancelled';
      payload: Record<string, never>;
    });

export type TaskEventType = TaskEvent['type'];

export type TaskEventListener = (event: TaskEvent) => void;

/* ------------------------------------------------------------------ *
 * Redacted UI snapshot (the thing events merge into)
 * ------------------------------------------------------------------ */

/**
 * Minimal privacy-safe projection a subscriber keeps while live (the `snapshot`
 * argument of `applyTaskEvents`). This is NOT the durable TaskSession — the
 * authoritative snapshot type is `TaskSnapshot` in ./handle.ts; this is what
 * the sidebar needs to render, rebuilt from a seed + the ordered event stream.
 */
export interface TaskEventState {
  taskId: string;
  roundId: string;
  status: TaskStatus;
  revision: number;
  /** Last applied event sequence; the next accepted event must exceed it. */
  sequence: number;
  updatedAt: number;
  instructionSummary?: string;
  activeTabId?: number;
  waitReason?: WaitReason;
  lastProgress?: TaskProgressPayload;
  candidate?: { summary: string; artifactIds: string[]; artifactTitles: string[] };
  receiptId?: string;
  failureCategory?: string;
  /**
   * Recent eventIds kept for dedup across reconnects.
   * ponytail: bounded ring; ceiling = dedup window of this many ids, upgrade
   * path is a persisted watermark store if streams ever outgrow it.
   */
  seenEventIds: string[];
}

/** Cap on how many eventIds a snapshot remembers for dedup. */
export const SEEN_EVENT_ID_WINDOW = 256;

/* ------------------------------------------------------------------ *
 * applyTaskEvents — pure merge with ordering / dedup / revision guards
 * ------------------------------------------------------------------ */

/** Discriminable failure: the stream itself is inconsistent (never guessed). */
export type TaskEventApplyError =
  | { kind: 'sequence_regression'; event: TaskEvent; expectedGreaterThan: number }
  | { kind: 'task_mismatch'; event: TaskEvent; expectedTaskId: string };

export type ApplyTaskEventsResult =
  | {
      ok: true;
      snapshot: TaskEventState;
      /** Events actually merged, in application order. */
      applied: TaskEvent[];
      /** Skipped because eventId was already seen. */
      duplicates: TaskEvent[];
      /** Skipped because event.revision < snapshot.revision (old producer). */
      stale: TaskEvent[];
    }
  | { ok: false; error: TaskEventApplyError };

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function applyOne(snapshot: TaskEventState, event: TaskEvent): TaskEventState {
  const base: TaskEventState = {
    ...snapshot,
    roundId: event.roundId,
    revision: Math.max(snapshot.revision, event.revision),
    sequence: event.sequence,
    updatedAt: Math.max(snapshot.updatedAt, event.occurredAt),
  };
  switch (event.type) {
    case 'task.accepted':
      return {
        ...base,
        status: 'running',
        instructionSummary: event.payload.instructionSummary,
        activeTabId: event.payload.activeTabId,
      };
    case 'task.state_changed':
      return { ...base, status: event.payload.to };
    case 'task.progressed':
      return { ...base, lastProgress: event.payload };
    case 'task.waiting_for_user':
      return { ...base, status: 'waiting_user', waitReason: event.payload.reason };
    case 'task.candidate_produced':
      return { ...base, candidate: event.payload };
    case 'task.verification_started':
      return base;
    case 'task.verified':
      return { ...base, status: 'completed', receiptId: event.payload.receiptId };
    case 'task.failed':
      return { ...base, status: 'failed', failureCategory: event.payload.category };
    case 'task.cancelled':
      return { ...base, status: 'cancelled' };
  }
}

/**
 * Merge an ordered batch of events into a snapshot. Pure; returns a new
 * snapshot, never mutates the input.
 *
 * Semantics:
 * - Events must arrive with strictly increasing `sequence` greater than
 *   `snapshot.sequence` (the lastSeq watermark). A smaller/equal sequence that
 *   is not a known duplicate is a `sequence_regression` error — this is what
 *   makes SW-restart continuation safe: the producer resumes numbering above
 *   the persisted watermark, so replayed pre-restart events are either deduped
 *   (known eventId) or rejected, and numbering never rolls backwards.
 * - Known eventIds are skipped (duplicates), so at-least-once delivery is safe.
 * - Events whose `revision` is below the snapshot's are skipped (stale); they
 *   never overwrite newer state.
 * - Any sequence/task error aborts the whole batch (all-or-nothing) so a
 *   consumer never ends up half-applied on a corrupt stream.
 */
export function applyTaskEvents(snapshot: TaskEventState, events: readonly TaskEvent[]): ApplyTaskEventsResult {
  assert(Number.isInteger(snapshot.sequence) && snapshot.sequence >= 0, 'snapshot.sequence must be a non-negative int');
  let current = snapshot;
  const applied: TaskEvent[] = [];
  const duplicates: TaskEvent[] = [];
  const stale: TaskEvent[] = [];
  const seen = new Set(snapshot.seenEventIds);

  for (const event of events) {
    if (event.taskId !== snapshot.taskId) {
      return { ok: false, error: { kind: 'task_mismatch', event, expectedTaskId: snapshot.taskId } };
    }
    if (seen.has(event.eventId)) {
      duplicates.push(event);
      continue;
    }
    if (event.sequence <= current.sequence) {
      return {
        ok: false,
        error: { kind: 'sequence_regression', event, expectedGreaterThan: current.sequence },
      };
    }
    if (event.revision < current.revision) {
      stale.push(event);
      continue;
    }
    current = applyOne(current, event);
    seen.add(event.eventId);
    current = {
      ...current,
      seenEventIds: [...seen].slice(-SEEN_EVENT_ID_WINDOW),
    };
    applied.push(event);
  }

  return { ok: true, snapshot: current, applied, duplicates, stale };
}
