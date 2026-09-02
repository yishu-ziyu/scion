import { describe, expect, it } from 'vitest';
import { applyTaskEvents, SEEN_EVENT_ID_WINDOW, type TaskEvent, type TaskEventState } from '../task-events';

const TASK = 'task-1';
const ROUND = 'round-1';

function state(overrides: Partial<TaskEventState> = {}): TaskEventState {
  return {
    taskId: TASK,
    roundId: ROUND,
    status: 'running',
    revision: 1,
    sequence: 0,
    updatedAt: 0,
    seenEventIds: [],
    ...overrides,
  };
}

function ev(overrides: Partial<TaskEvent> & { type: TaskEvent['type'] }): TaskEvent {
  const base = {
    eventId: `evt-${Math.random().toString(36).slice(2)}`,
    taskId: TASK,
    roundId: ROUND,
    sequence: 1,
    revision: 1,
    occurredAt: 1000,
  };
  const payload = (
    {
      'task.accepted': { instructionSummary: '查一下', activeTabId: 7 },
      'task.state_changed': { from: 'running', to: 'paused' },
      'task.progressed': { step: 1, label: '打开页面' },
      'task.waiting_for_user': { reason: 'login_required' },
      'task.candidate_produced': { summary: '候选完成', artifactIds: ['art-1'], artifactTitles: ['表格'] },
      'task.verification_started': { criterionIds: ['c1'] },
      'task.verified': { receiptId: 'rcpt-1', criterionIds: ['c1'] },
      'task.failed': { category: 'llm_failed' },
      'task.cancelled': {},
    } as Record<TaskEvent['type'], TaskEvent['payload']>
  )[overrides.type];
  return { ...base, payload, ...overrides } as TaskEvent;
}

describe('D2 applyTaskEvents', () => {
  it('merges a snapshot + ordered delta stream', () => {
    const seed = state({ sequence: 0 });
    const result = applyTaskEvents(seed, [
      ev({ type: 'task.accepted', sequence: 1, occurredAt: 10 }),
      ev({ type: 'task.progressed', sequence: 2, occurredAt: 20, payload: { step: 1, label: '打开页面' } }),
      ev({ type: 'task.waiting_for_user', sequence: 3, occurredAt: 30, payload: { reason: 'captcha_required' } }),
      ev({
        type: 'task.verified',
        sequence: 4,
        occurredAt: 40,
        revision: 2,
        payload: { receiptId: 'r1', criterionIds: ['c1'] },
      }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toHaveLength(4);
    expect(result.snapshot.status).toBe('completed');
    expect(result.snapshot.sequence).toBe(4);
    expect(result.snapshot.revision).toBe(2);
    expect(result.snapshot.updatedAt).toBe(40);
    expect(result.snapshot.waitReason).toBe('captcha_required');
    expect(result.snapshot.receiptId).toBe('r1');
    expect(result.snapshot.lastProgress?.label).toBe('打开页面');
    // input snapshot is never mutated
    expect(seed.sequence).toBe(0);
  });

  it('dedups events by eventId (at-least-once delivery is safe)', () => {
    const dup = ev({ type: 'task.progressed', sequence: 5, eventId: 'same-id' });
    const first = applyTaskEvents(state(), [dup]);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const second = applyTaskEvents(first.snapshot, [dup]);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.applied).toHaveLength(0);
    expect(second.duplicates).toHaveLength(1);
    expect(second.snapshot.sequence).toBe(5);
  });

  it('rejects a sequence regression with a discriminable error', () => {
    const result = applyTaskEvents(state({ sequence: 7 }), [ev({ type: 'task.progressed', sequence: 7 })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('sequence_regression');
    if (result.error.kind === 'sequence_regression') {
      expect(result.error.expectedGreaterThan).toBe(7);
    }
  });

  it('never lets a stale-revision event overwrite newer state', () => {
    const current = state({ revision: 5, sequence: 9, status: 'completed', receiptId: 'new' });
    const result = applyTaskEvents(current, [
      ev({ type: 'task.failed', sequence: 10, revision: 3, payload: { category: 'llm_failed' } }),
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.stale).toHaveLength(1);
    expect(result.applied).toHaveLength(0);
    expect(result.snapshot.status).toBe('completed');
    expect(result.snapshot.failureCategory).toBeUndefined();
    expect(result.snapshot.revision).toBe(5);
  });

  it('continues numbering after an SW restart: lastSeq watermark blocks replayed events', () => {
    // Before restart the consumer saw up to sequence 12.
    const before = applyTaskEvents(state(), [
      ev({ type: 'task.accepted', sequence: 11, eventId: 'pre-1' }),
      ev({ type: 'task.progressed', sequence: 12, eventId: 'pre-2' }),
    ]);
    expect(before.ok).toBe(true);
    if (!before.ok) return;
    // SW restarts; producer resumes numbering above the persisted watermark.
    const after = applyTaskEvents(before.snapshot, [
      // replayed pre-restart event: known eventId → deduped, no regression
      ev({ type: 'task.progressed', sequence: 12, eventId: 'pre-2' }),
      ev({ type: 'task.verified', sequence: 13, eventId: 'post-1' }),
    ]);
    expect(after.ok).toBe(true);
    if (!after.ok) return;
    expect(after.snapshot.sequence).toBe(13);
    expect(after.duplicates).toHaveLength(1);
    // an unknown event reusing an old sequence is a hard error, not a silent skip
    const bad = applyTaskEvents(after.snapshot, [ev({ type: 'task.progressed', sequence: 5 })]);
    expect(bad.ok).toBe(false);
  });

  it('refuses events from a different task', () => {
    const result = applyTaskEvents(state(), [ev({ type: 'task.progressed', taskId: 'other' })]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe('task_mismatch');
  });

  it('caps the dedup window', () => {
    const events = Array.from({ length: SEEN_EVENT_ID_WINDOW + 20 }, (_, i) =>
      ev({ type: 'task.progressed', sequence: i + 1, eventId: `id-${i}` }),
    );
    const result = applyTaskEvents(state(), events);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.seenEventIds.length).toBeLessThanOrEqual(SEEN_EVENT_ID_WINDOW);
  });

  it('covers every event type in the union', () => {
    const types = [
      'task.accepted',
      'task.state_changed',
      'task.progressed',
      'task.waiting_for_user',
      'task.candidate_produced',
      'task.verification_started',
      'task.verified',
      'task.failed',
      'task.cancelled',
    ] as const;
    const events = types.map((type, i) => ev({ type, sequence: i + 1 }));
    const result = applyTaskEvents(state(), events);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.applied).toHaveLength(types.length);
    // last event wins: cancelled
    expect(result.snapshot.status).toBe('cancelled');
  });
});
