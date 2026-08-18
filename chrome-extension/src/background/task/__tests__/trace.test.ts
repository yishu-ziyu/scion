import { describe, expect, it } from 'vitest';
import { toRedactedTaskSnapshot } from '../trace';

describe('trace redaction snapshot', () => {
  it('keeps only aggregate counts and safe task metadata', () => {
    const snapshot = toRedactedTaskSnapshot({
      id: 'task-1',
      status: 'completed',
      revision: 3,
      updatedAt: 123,
      activeTabId: 7,
      rounds: [
        {
          attempts: [{ actionName: 'input_text' }, { actionName: 'click_element' }],
          evidence: [{ criterionId: 'c1' }],
          receipt: { id: 'r1' },
          criteria: [{ kind: 'page_text' }],
        },
      ],
    });

    expect(snapshot).toEqual({
      taskId: 'task-1',
      status: 'completed',
      revision: 3,
      updatedAt: 123,
      activeTabId: 7,
      terminalStatus: 'completed',
      roundCount: 1,
      attemptCount: 2,
      failureCategory: undefined,
      evidenceCount: 1,
      receiptCount: 1,
      criteriaCount: 1,
    });
    expect(JSON.stringify(snapshot)).not.toContain('input_text');
    expect(JSON.stringify(snapshot)).not.toContain('click_element');
    expect(JSON.stringify(snapshot)).not.toContain('r1');
  });

  it('does not leak failure category raw values into user-visible trace data', () => {
    const snapshot = toRedactedTaskSnapshot({
      id: 'task-2',
      status: 'failed',
      revision: 2,
      updatedAt: 456,
      activeTabId: 3,
      failureCategory: 'selector_miss',
    });
    expect(snapshot.failureCategory).toBe('selector_miss');
  });
});
