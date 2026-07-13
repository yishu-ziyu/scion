import { describe, expect, it, vi } from 'vitest';

const localStorage = vi.hoisted(() => {
  const values: Record<string, unknown> = {};
  return {
    values,
    get: vi.fn(async (keys: string[]) =>
      Object.fromEntries(keys.filter(key => key in values).map(key => [key, values[key]])),
    ),
    set: vi.fn(async (next: Record<string, unknown>) => {
      Object.assign(values, next);
    }),
    onChanged: { addListener: vi.fn() },
  };
});

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { storage: { local: localStorage } },
  });
});

import { getTask, saveTask, type TaskSession } from '@extension/storage/lib/task';
import { TaskManager } from '../manager';

describe('concrete task store recovery', () => {
  it('persists an executing commit as uncertain without constructing an executor', async () => {
    const task: TaskSession = {
      id: 'task-1',
      goalSummary: 'User task',
      status: 'running',
      revision: 1,
      activeTabId: 7,
      currentRoundId: 'round-1',
      targetRefs: [],
      createdAt: 1,
      updatedAt: 1,
      rounds: [
        {
          id: 'round-1',
          instructionSummary: 'User instruction',
          status: 'running',
          commandAcks: {},
          criteria: [],
          attempts: [
            {
              id: 'attempt-1',
              roundId: 'round-1',
              actionName: 'click_element',
              effect: 'external_commit',
              argsDigest: 'digest',
              state: 'executing',
              proposedAt: 1,
            },
          ],
          approvals: [],
          evidence: [],
        },
      ],
    };
    await saveTask(task);
    const createExecutor = vi.fn();
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });

    await manager.recover();

    expect(createExecutor).not.toHaveBeenCalled();
    await expect(getTask(task.id)).resolves.toMatchObject({
      status: 'waiting_user',
      rounds: [{ waitReason: 'commit_outcome_uncertain', attempts: [{ state: 'uncertain' }] }],
    });
  });
});
