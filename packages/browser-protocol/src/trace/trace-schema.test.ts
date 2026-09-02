import { describe, expect, it } from 'vitest';
import {
  firstSequenceViolation,
  isMonotonicSequence,
  INVALID_TRACE_RECORD,
  parseTraceRecord,
  TRACE_SCHEMA_VERSION,
  TraceRecordSchema,
  UNSUPPORTED_TRACE_SCHEMA_VERSION,
  validateTraceBundle,
  type TraceRecord,
} from './trace-schema';
import { targetPageRevision } from '../targets';
import type { ActionReceipt } from '../receipt';
import type { BrowserAction } from '../action';
import type { BrowserObservation } from '../observation';

const envelope = {
  schemaVersion: TRACE_SCHEMA_VERSION,
  taskId: 'task-1',
  roundId: 'round-1',
  recordedAt: 1700000000000,
};

const observation: BrowserObservation = {
  protocolVersion: '2',
  observationId: 'obs-1',
  observedAt: 1700000000000,
  page: { kind: 'page', tabId: 1, url: 'https://example.com', title: 't', pageRevision: 'r1' },
  pageRevision: 'r1',
  interactiveElements: [{ kind: 'element', identity: { backendNodeId: 7 }, pageRevision: 'r1', tagName: 'button' }],
  signals: [],
};

const action: BrowserAction = {
  protocolVersion: '2',
  actionId: 'act-1',
  kind: 'click',
  effect: 'reversible_write',
  requestedAt: 1700000000001,
  target: { kind: 'element', identity: { backendNodeId: 7 }, pageRevision: 'r1' },
  input: {},
};

const receipt: ActionReceipt = {
  actionId: 'act-1',
  status: 'applied',
  beforeRevision: 'r1',
  afterRevision: 'r2',
  evidence: [],
};

const meta: TraceRecord = { ...envelope, seq: 0, type: 'trace_meta', traceId: 'tr-1', startedAt: 1700000000000 };
const environment: TraceRecord = {
  ...envelope,
  seq: 1,
  type: 'environment',
  platform: 'darwin',
  extensionVersion: '0.2.0',
};
const observationRecord: TraceRecord = { ...envelope, seq: 2, type: 'observation', observation };
const actionRecord: TraceRecord = { ...envelope, seq: 3, type: 'action', action };
const receiptRecord: TraceRecord = { ...envelope, seq: 4, type: 'receipt', receipt };
const verdict: TraceRecord = {
  ...envelope,
  seq: 5,
  type: 'verdict',
  verdict: 'success',
  rationale: 'done',
  decidedAt: 1700000000002,
};

const fullBundle: TraceRecord[] = [meta, environment, observationRecord, actionRecord, receiptRecord, verdict];

describe('trace record schema', () => {
  it.each(fullBundle.map(r => [r.type, r] as const))('round-trips %s through JSON', (_type, record) => {
    const raw = JSON.parse(JSON.stringify(record));
    const result = parseTraceRecord(raw);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.record).toEqual(record);
  });

  it('carries seq + taskId + roundId on every record type', () => {
    for (const record of fullBundle) {
      expect(typeof record.seq).toBe('number');
      expect(record.taskId).toBe('task-1');
      expect(record.roundId).toBe('round-1');
    }
  });

  it('rejects malformed records with INVALID_TRACE_RECORD', () => {
    const result = parseTraceRecord({ ...envelope, seq: 0, type: 'verdict' }); // missing verdict fields
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(INVALID_TRACE_RECORD);
  });
});

describe('trace schema version gate', () => {
  it('rejects an unknown schemaVersion', () => {
    const result = parseTraceRecord({ ...meta, schemaVersion: 999 });
    expect(result).toEqual({
      ok: false,
      code: UNSUPPORTED_TRACE_SCHEMA_VERSION,
      message: 'expected schemaVersion 1, found 999',
    });
  });

  it('rejects a missing schemaVersion', () => {
    const { schemaVersion: _omit, ...rest } = meta;
    const result = parseTraceRecord(rest);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(UNSUPPORTED_TRACE_SCHEMA_VERSION);
  });

  it('keeps the trace version independent from the protocol version', () => {
    // Embedded protocol objects still gate on protocolVersion, not schemaVersion.
    const result = parseTraceRecord({
      ...envelope,
      schemaVersion: 99,
      seq: 2,
      type: 'observation',
      observation,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe(UNSUPPORTED_TRACE_SCHEMA_VERSION);
    expect(TRACE_SCHEMA_VERSION).not.toBe(2);
  });
});

describe('monotonic sequence', () => {
  it('accepts strictly increasing seq', () => {
    expect(isMonotonicSequence(fullBundle)).toBe(true);
    expect(firstSequenceViolation(fullBundle)).toBeNull();
  });

  it('rejects duplicate seq with the offending index', () => {
    const dup = [...fullBundle];
    dup[3] = { ...dup[3], seq: 2 };
    const violation = firstSequenceViolation(dup);
    expect(violation).not.toBeNull();
    expect(violation?.index).toBe(3);
    expect(violation?.message).toContain('seq 2 at index 3');
  });

  it('rejects decreasing seq', () => {
    expect(isMonotonicSequence([{ seq: 2 }, { seq: 1 }])).toBe(false);
  });

  it('treats empty and single-record streams as monotonic', () => {
    expect(isMonotonicSequence([])).toBe(true);
    expect(isMonotonicSequence([{ seq: 0 }])).toBe(true);
  });
});

describe('action ↔ receipt correlation', () => {
  it('links a receipt to its action through actionId', () => {
    expect(actionRecord.action.actionId).toBe(receiptRecord.receipt.actionId);
    expect(validateTraceBundle(fullBundle).filter(d => d.severity === 'error')).toEqual([]);
  });

  it('reports an orphan receipt whose action is missing', () => {
    const bundle = [meta, environment, observationRecord, receiptRecord, verdict];
    const codes = validateTraceBundle(bundle).map(d => d.code);
    expect(codes).toContain('ORPHAN_RECEIPT');
  });

  it('reports an action whose receipt is missing', () => {
    const bundle = fullBundle.filter(r => r.type !== 'receipt');
    const codes = validateTraceBundle(bundle).map(d => d.code);
    expect(codes).toContain('MISSING_RECEIPT');
  });
});

describe('observation ↔ target correlation', () => {
  it('links an observation to its action target through pageRevision', () => {
    expect(action.target).not.toBeNull();
    expect(targetPageRevision(action.target!)).toBe(observation.pageRevision);
    expect(targetPageRevision(observation.page)).toBe(observation.pageRevision);
  });

  it('a stale target revision breaks the link', () => {
    const staleAction: BrowserAction = {
      ...action,
      actionId: 'act-2',
      target: { kind: 'element', identity: { backendNodeId: 7 }, pageRevision: 'r0' },
    };
    expect(targetPageRevision(staleAction.target!)).not.toBe(observation.pageRevision);
  });
});

describe('validateTraceBundle diagnostics', () => {
  it('reports receipts recorded with an empty observation stream', () => {
    const bundle = [meta, environment, actionRecord, receiptRecord, verdict];
    const codes = validateTraceBundle(bundle).map(d => d.code);
    expect(codes).toContain('MISSING_OBSERVATION');
  });

  it('reports missing trace.json and environment.json records', () => {
    const codes = validateTraceBundle([observationRecord, actionRecord, receiptRecord]).map(d => d.code);
    expect(codes).toContain('MISSING_TRACE_META');
    expect(codes).toContain('MISSING_ENVIRONMENT');
  });

  it('warns (not errors) when the verdict is missing', () => {
    const bundle = fullBundle.filter(r => r.type !== 'verdict');
    const missing = validateTraceBundle(bundle).find(d => d.code === 'MISSING_VERDICT');
    expect(missing?.severity).toBe('warning');
  });

  it('reports non-monotonic and cross-task records concretely', () => {
    const broken = [...fullBundle, { ...verdict, seq: 1, taskId: 'task-2' }];
    const codes = validateTraceBundle(broken).map(d => d.code);
    expect(codes).toContain('NON_MONOTONIC_SEQUENCE');
    expect(codes).toContain('TASK_ID_MISMATCH');
  });

  it('parses every bundle record through the union schema', () => {
    for (const record of fullBundle) {
      expect(TraceRecordSchema.safeParse(record).success).toBe(true);
    }
  });
});
