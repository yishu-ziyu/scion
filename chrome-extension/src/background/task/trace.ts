/**
 * Minimal structured trace store for eval/observability (plan 019 Wave 1).
 *
 * Traces are deliberately coarse and privacy-safe: they store task lifecycle,
 * phase names, redacted detail strings, and aggregate counts. They never store
 * raw instructions, form values, cookies, or full page text.
 */
import { createLogger } from '../log';

const TRACE_STORAGE_KEY = 'eval-traces-v1';

export type TraceSpanKind =
  | 'task'
  | 'plan'
  | 'observe'
  | 'decide'
  | 'act'
  | 'reobserve'
  | 'verify'
  | 'llm'
  | 'kernel'
  | 'skill'
  | 'artifact'
  | 'diff';

export interface TraceSpan {
  id: string;
  taskId: string;
  roundId?: string;
  kind: TraceSpanKind;
  name: string;
  startedAt: number;
  endedAt?: number;
  status?: 'running' | 'ok' | 'fail';
  detail?: string;
  /** Redacted, aggregate-only metadata. */
  data?: Record<string, string | number | boolean>;
}

export interface EvalTrace {
  taskId: string;
  createdAt: number;
  updatedAt: number;
  terminalStatus?: 'completed' | 'failed' | 'cancelled';
  failureCategory?: string;
  spans: TraceSpan[];
}

export interface RedactedTaskSnapshot {
  taskId: string;
  status: string;
  revision: number;
  updatedAt: number;
  activeTabId: number;
  terminalStatus?: 'completed' | 'failed' | 'cancelled';
  roundCount: number;
  attemptCount: number;
  evidenceCount: number;
  receiptCount: number;
  criteriaCount: number;
  failureCategory?: string;
}

const logger = createLogger('TraceStore');

function storageAvailable(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

async function readAll(): Promise<Record<string, EvalTrace>> {
  if (!storageAvailable()) return {};
  try {
    const stored = await chrome.storage.local.get([TRACE_STORAGE_KEY]);
    return (stored?.[TRACE_STORAGE_KEY] as Record<string, EvalTrace> | undefined) ?? {};
  } catch (error) {
    logger.error('failed to read eval traces', error);
    return {};
  }
}

async function writeAll(traces: Record<string, EvalTrace>): Promise<void> {
  if (!storageAvailable()) return;
  try {
    await chrome.storage.local.set({ [TRACE_STORAGE_KEY]: traces });
  } catch (error) {
    logger.error('failed to write eval traces', error);
  }
}

function newTrace(taskId: string, now = Date.now()): EvalTrace {
  return {
    taskId,
    createdAt: now,
    updatedAt: now,
    spans: [],
  };
}

export class TraceStore {
  private readonly traces = new Map<string, EvalTrace>();
  private loaded = false;

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    const all = await readAll();
    for (const [id, trace] of Object.entries(all)) {
      if (trace?.taskId) this.traces.set(id, trace);
    }
    this.loaded = true;
  }

  async appendSpan(span: TraceSpan): Promise<void> {
    await this.ensureLoaded();
    const trace = this.traces.get(span.taskId) ?? newTrace(span.taskId, span.startedAt);
    trace.spans.push(span);
    trace.updatedAt = span.startedAt;
    this.traces.set(span.taskId, trace);
    await writeAll(Object.fromEntries(this.traces));
  }

  async beginSpan(input: Omit<TraceSpan, 'id' | 'status'>): Promise<TraceSpan> {
    const span: TraceSpan = {
      ...input,
      id: crypto.randomUUID(),
      status: 'running',
    };
    await this.appendSpan(span);
    return span;
  }

  async finishSpan(span: TraceSpan, status: 'ok' | 'fail', detail?: string): Promise<void> {
    const ended: TraceSpan = {
      ...span,
      status,
      endedAt: Date.now(),
      ...(detail ? { detail } : {}),
    };
    await this.ensureLoaded();
    const trace = this.traces.get(span.taskId);
    if (!trace) return;
    const index = trace.spans.findIndex(item => item.id === span.id);
    if (index >= 0) trace.spans[index] = ended;
    trace.updatedAt = ended.endedAt ?? Date.now();
    this.traces.set(span.taskId, trace);
    await writeAll(Object.fromEntries(this.traces));
  }

  async recordTaskSnapshot(snapshot: RedactedTaskSnapshot): Promise<void> {
    await this.ensureLoaded();
    const trace = this.traces.get(snapshot.taskId) ?? newTrace(snapshot.taskId, snapshot.updatedAt);
    trace.updatedAt = snapshot.updatedAt;
    if (snapshot.terminalStatus) trace.terminalStatus = snapshot.terminalStatus;
    if (snapshot.failureCategory) trace.failureCategory = snapshot.failureCategory;
    trace.spans.push({
      id: crypto.randomUUID(),
      taskId: snapshot.taskId,
      kind: 'task',
      name: 'task_snapshot',
      startedAt: snapshot.updatedAt,
      status: 'ok',
      data: {
        revision: snapshot.revision,
        roundCount: snapshot.roundCount,
        attemptCount: snapshot.attemptCount,
        evidenceCount: snapshot.evidenceCount,
        receiptCount: snapshot.receiptCount,
        criteriaCount: snapshot.criteriaCount,
      },
    });
    this.traces.set(snapshot.taskId, trace);
    await writeAll(Object.fromEntries(this.traces));
  }

  async getTrace(taskId: string): Promise<EvalTrace | null> {
    await this.ensureLoaded();
    return this.traces.get(taskId) ?? null;
  }
}

export const traceStore = new TraceStore();

/** Convert a TaskManager-shaped task object to a privacy-safe snapshot. */
export function toRedactedTaskSnapshot(task: {
  id: string;
  status: string;
  revision: number;
  updatedAt: number;
  activeTabId: number;
  currentRoundId?: string;
  rounds?: Array<{
    id?: string;
    status?: string;
    attempts?: unknown[];
    evidence?: unknown[];
    receipt?: unknown;
    criteria?: unknown[];
    failureCategory?: string;
  }>;
  failureCategory?: string;
}): RedactedTaskSnapshot {
  const rounds = task.rounds ?? [];
  const current = rounds.find(round => round.status) ?? rounds[0];
  const failureCategory =
    task.failureCategory ?? rounds.find(round => round.id === task.currentRoundId)?.failureCategory;
  const terminalStatus = ['completed', 'failed', 'cancelled'].includes(task.status)
    ? (task.status as 'completed' | 'failed' | 'cancelled')
    : undefined;
  return {
    taskId: task.id,
    status: task.status,
    revision: task.revision,
    updatedAt: task.updatedAt,
    activeTabId: task.activeTabId,
    terminalStatus,
    roundCount: rounds.length,
    attemptCount: current?.attempts?.length ?? 0,
    evidenceCount: current?.evidence?.length ?? 0,
    receiptCount: current?.receipt ? 1 : 0,
    criteriaCount: current?.criteria?.length ?? 0,
    failureCategory,
  };
}
