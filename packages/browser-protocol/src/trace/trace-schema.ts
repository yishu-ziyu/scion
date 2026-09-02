/**
 * Replay Trace Schema (H1).
 *
 * Local persistence format for a replayable trace bundle, mirroring the
 * future on-disk layout under traces/<id>/:
 *
 *   trace.json          → TraceMetaRecord
 *   environment.json    → EnvironmentRecord
 *   task-events.jsonl   → TaskEventRecord
 *   model-calls.jsonl   → ModelCallRecord
 *   observations.jsonl  → ObservationRecord   (embeds BrowserObservation)
 *   actions.jsonl       → ActionRecord        (embeds BrowserAction)
 *   receipts.jsonl      → ReceiptRecord       (embeds ActionReceipt)
 *   verdict.json        → VerdictRecord
 *
 * Invariants (enforced by the envelope on every record):
 * - `seq` is a strictly monotonic per-trace sequence number.
 * - `taskId` and `roundId` are present on every record.
 * - action ↔ receipt correlate through `actionId`
 *   (ActionRecord.action.actionId === ReceiptRecord.receipt.actionId).
 * - observation ↔ target correlate through `pageRevision`
 *   (ObservationRecord.observation.pageRevision === target.pageRevision).
 *
 * Versioning: `schemaVersion` is the TRACE format version, deliberately
 * separate from BROWSER_PROTOCOL_VERSION. The protocol version gates wire
 * messages (the embedded BrowserAction/BrowserObservation/ActionReceipt
 * carry their own protocolVersion); the trace version gates the local
 * persistence envelope. They evolve independently — bumping one does not
 * force bumping the other. Unknown trace schemaVersion is rejected by
 * parseTraceRecord().
 *
 * Privacy (hook point only in H1, not full redaction):
 * - ActionRecord may embed input_text raw form values — MUST be redacted
 *   before persistence via the TraceRedactionHook seam below.
 * - ObservationRecord.visibleText may carry page text — prefer omitting it
 *   in trace bundles.
 * - ModelCallRecord stores refs/token counts, never prompt/response bodies.
 * - Evidence payloads ride as refs (EvidenceRef), never inline content.
 */
import { z } from 'zod';
import { BrowserActionSchema } from '../action';
import { ActionReceiptSchema } from '../receipt';
import { BrowserErrorSchema } from '../errors';
import { BrowserObservationSchema } from '../observation';

export const TRACE_SCHEMA_VERSION = 1 as const;
export const UNSUPPORTED_TRACE_SCHEMA_VERSION = 'UNSUPPORTED_TRACE_SCHEMA_VERSION' as const;
export const INVALID_TRACE_RECORD = 'INVALID_TRACE_RECORD' as const;

/* ------------------------------------------------------------------ *
 * Envelope — shared by every trace record
 * ------------------------------------------------------------------ */

const traceEnvelope = {
  schemaVersion: z.literal(TRACE_SCHEMA_VERSION),
  /** Strictly increasing per-trace sequence number. */
  seq: z.number().int().nonnegative(),
  taskId: z.string().min(1),
  roundId: z.string().min(1),
  /** Wall-clock time the record was appended (epoch ms). */
  recordedAt: z.number().int().nonnegative(),
};

/* ------------------------------------------------------------------ *
 * Record types (one per future file in traces/<id>/)
 * ------------------------------------------------------------------ */

export const TraceMetaRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('trace_meta'),
  traceId: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  agentVersion: z.string().optional(),
  taskSummary: z.string().optional(),
});

export const EnvironmentRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('environment'),
  platform: z.string().optional(),
  browser: z.string().optional(),
  extensionVersion: z.string().optional(),
  userAgent: z.string().optional(),
  extra: z.record(z.unknown()).optional(),
});

export const TaskEventRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('task_event'),
  event: z.string().min(1),
  detail: z.unknown().optional(),
});

export const ModelCallRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('model_call'),
  callId: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  startedAt: z.number().int().nonnegative(),
  endedAt: z.number().int().nonnegative().optional(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  /** Evidence-store refs; prompt/response bodies must never be inlined. */
  promptRef: z.string().optional(),
  responseRef: z.string().optional(),
  error: BrowserErrorSchema.optional(),
});

export const ObservationRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('observation'),
  /** References the protocol type; never redefines it. */
  observation: BrowserObservationSchema,
});

export const ActionRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('action'),
  action: BrowserActionSchema,
});

export const ReceiptRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('receipt'),
  receipt: ActionReceiptSchema,
});

export const VerdictRecordSchema = z.object({
  ...traceEnvelope,
  type: z.literal('verdict'),
  verdict: z.enum(['success', 'failure', 'partial', 'aborted']),
  rationale: z.string().min(1),
  decidedAt: z.number().int().nonnegative(),
});

export const TraceRecordSchema = z.discriminatedUnion('type', [
  TraceMetaRecordSchema,
  EnvironmentRecordSchema,
  TaskEventRecordSchema,
  ModelCallRecordSchema,
  ObservationRecordSchema,
  ActionRecordSchema,
  ReceiptRecordSchema,
  VerdictRecordSchema,
]);

export type TraceRecordType = TraceRecord['type'];
export type TraceRecord =
  | z.infer<typeof TraceMetaRecordSchema>
  | z.infer<typeof EnvironmentRecordSchema>
  | z.infer<typeof TaskEventRecordSchema>
  | z.infer<typeof ModelCallRecordSchema>
  | z.infer<typeof ObservationRecordSchema>
  | z.infer<typeof ActionRecordSchema>
  | z.infer<typeof ReceiptRecordSchema>
  | z.infer<typeof VerdictRecordSchema>;

/* ------------------------------------------------------------------ *
 * Privacy redaction seam (H1: type-level only, not implemented)
 * ------------------------------------------------------------------ */

/**
 * Hook applied to a record before serialization to a trace bundle.
 * Implementations must scrub raw form values (e.g. input_text payloads),
 * cookies and full page HTML; the schema keeps the fields untyped-scrubbed
 * so this is the single enforced choke point for persistence writers.
 */
export type TraceRedactionHook = (record: TraceRecord) => TraceRecord;

/* ------------------------------------------------------------------ *
 * Version-gated parsing
 * ------------------------------------------------------------------ */

export type ParseTraceRecordResult =
  | { ok: true; record: TraceRecord }
  | { ok: false; code: typeof UNSUPPORTED_TRACE_SCHEMA_VERSION | typeof INVALID_TRACE_RECORD; message: string };

/**
 * Parse one raw trace record. Unknown/missing `schemaVersion` is rejected
 * with UNSUPPORTED_TRACE_SCHEMA_VERSION before any shape validation, so a
 * future format never half-parses. Shape failures report concrete issues.
 */
export function parseTraceRecord(raw: unknown): ParseTraceRecordResult {
  const found =
    raw !== null && typeof raw === 'object' ? (raw as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (found !== TRACE_SCHEMA_VERSION) {
    return {
      ok: false,
      code: UNSUPPORTED_TRACE_SCHEMA_VERSION,
      message: `expected schemaVersion ${TRACE_SCHEMA_VERSION}, found ${String(found)}`,
    };
  }
  const parsed = TraceRecordSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    return { ok: false, code: INVALID_TRACE_RECORD, message: issues };
  }
  return { ok: true, record: parsed.data };
}

/* ------------------------------------------------------------------ *
 * Monotonic sequence check
 * ------------------------------------------------------------------ */

export interface SequenceViolation {
  index: number;
  message: string;
}

/** First index where `seq` is not strictly increasing, or null. Pure. */
export function firstSequenceViolation(records: readonly { seq: number }[]): SequenceViolation | null {
  for (let i = 1; i < records.length; i++) {
    if (records[i].seq <= records[i - 1].seq) {
      return {
        index: i,
        message: `seq ${records[i].seq} at index ${i} does not follow ${records[i - 1].seq}`,
      };
    }
  }
  return null;
}

export function isMonotonicSequence(records: readonly { seq: number }[]): boolean {
  return firstSequenceViolation(records) === null;
}

/* ------------------------------------------------------------------ *
 * Bundle validation — concrete diagnostics for missing/corrupt streams
 * ------------------------------------------------------------------ */

export interface TraceDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
}

/**
 * Validate a parsed trace bundle (all records of one trace, in seq order).
 * Reports concrete missing pieces rather than a generic "invalid": e.g. a
 * receipt whose action never appears, an action with no receipt, receipts
 * recorded while the observation stream is empty, or a taskId mismatch.
 */
export function validateTraceBundle(records: readonly TraceRecord[]): TraceDiagnostic[] {
  const diagnostics: TraceDiagnostic[] = [];
  const error = (code: string, message: string) => diagnostics.push({ severity: 'error', code, message });

  const metas = records.filter(r => r.type === 'trace_meta');
  if (metas.length === 0) error('MISSING_TRACE_META', 'trace.json record is missing');
  if (metas.length > 1) error('MULTIPLE_TRACE_META', `expected 1 trace_meta record, found ${metas.length}`);
  if (!records.some(r => r.type === 'environment')) error('MISSING_ENVIRONMENT', 'environment.json record is missing');
  if (!records.some(r => r.type === 'verdict')) {
    diagnostics.push({ severity: 'warning', code: 'MISSING_VERDICT', message: 'verdict.json record is missing' });
  }

  const taskIds = [...new Set(records.map(r => r.taskId))];
  if (taskIds.length > 1) error('TASK_ID_MISMATCH', `records span multiple taskIds: ${taskIds.join(', ')}`);

  const violation = firstSequenceViolation(records);
  if (violation) error('NON_MONOTONIC_SEQUENCE', violation.message);

  const actionIds = new Set(records.flatMap(r => (r.type === 'action' ? [r.action.actionId] : [])));
  const receiptedIds = new Set(records.flatMap(r => (r.type === 'receipt' ? [r.receipt.actionId] : [])));
  const observations = records.filter(r => r.type === 'observation');

  for (const r of records) {
    if (r.type === 'receipt' && !actionIds.has(r.receipt.actionId)) {
      error('ORPHAN_RECEIPT', `receipt for actionId '${r.receipt.actionId}' has no matching action record`);
    }
    if (r.type === 'action' && !receiptedIds.has(r.action.actionId)) {
      error('MISSING_RECEIPT', `action '${r.action.actionId}' has no matching receipt record`);
    }
  }
  if (receiptedIds.size > 0 && observations.length === 0) {
    error('MISSING_OBSERVATION', `${receiptedIds.size} receipt(s) recorded but the observation stream is empty`);
  }
  return diagnostics;
}
