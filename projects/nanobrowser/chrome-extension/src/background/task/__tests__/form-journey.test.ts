import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionCriterion } from '@extension/storage/lib/task';
import { TaskManager, type ExecutorDriver } from '../manager';
import { sha256 } from '../digest';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
}));

vi.mock('@extension/storage/lib/task', () => ({
  getTask: async (id: string) => store.sessions.get(id) ?? null,
  getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
  saveTask: async (task: { id: string }) => {
    store.sessions.set(task.id, structuredClone(task));
  },
}));

describe('verified form journey', () => {
  beforeEach(() => store.sessions.clear());

  it('creates a receipt only from fresh current-round evidence', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'submitted' }),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    let observationCall = 0;
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
      const value = observationCall++ > 0;
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 220,
        source: 'page' as const,
        value,
      }));
    });
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan([
          { kind: 'page_text', operator: 'present', expected: 'Saved successfully', required: true },
        ]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 220,
    });
    const events: string[] = [];
    manager.subscribe(event => events.push(event.type));

    await manager.dispatch({
      type: 'start',
      commandId: 'start-form',
      taskId: 'task-form',
      tabId: 7,
      instruction: 'submit with FIELD_SENTINEL_8472',
      chatSessionId: 'chat-form',
      instructionMessageId: 'message-form',
    });

    await vi.waitFor(async () => {
      expect(await manager.snapshot('task-form')).toMatchObject({
        status: 'completed',
        rounds: [{ receipt: { taskId: 'task-form', criterionIds: [expect.any(String)] } }],
      });
    });
    expect(observeCriteria).toHaveBeenCalledTimes(2);
    expect(events).toContain('task_completed_verified');
    expect(driver.stop).toHaveBeenCalledOnce();
    expect(JSON.stringify(await manager.snapshot('task-form'))).not.toContain('FIELD_SENTINEL_8472');
    expect(JSON.stringify(await manager.snapshot('task-form'))).not.toContain('Saved successfully');
  });

  it('accepts one idempotent dedicated confirmation command', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'needs confirmation' }),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan([{ kind: 'user_confirmed', operator: 'equals', expected: true, required: true }]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 300,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-confirm',
      taskId: 'task-confirm',
      tabId: 7,
      instruction: 'perform an outcome that needs my confirmation',
      chatSessionId: 'chat-confirm',
      instructionMessageId: 'message-confirm',
    });
    await vi.waitFor(async () => expect((await manager.snapshot('task-confirm'))?.status).toBe('waiting_user'));
    const waiting = await manager.snapshot('task-confirm');
    const round = waiting?.rounds.at(-1);
    const criterion = round?.criteria[0];
    if (!waiting || !round || !criterion) throw new Error('Expected a confirmation criterion');
    const command = {
      type: 'confirm_completion' as const,
      commandId: 'confirm-1',
      taskId: 'task-confirm',
      expectedRevision: waiting.revision,
      roundId: round.id,
      criterionId: criterion.id,
    };

    const first = await manager.dispatch(command);
    const completed = await manager.snapshot('task-confirm');
    expect(await manager.dispatch(command)).toEqual(first);
    await expect(manager.snapshot('task-confirm')).resolves.toMatchObject({
      status: 'completed',
      revision: completed?.revision,
      rounds: [
        {
          evidence: [expect.objectContaining({ source: 'user', passed: true })],
          receipt: expect.any(Object),
        },
      ],
    });
    expect(driver.stop).toHaveBeenCalledOnce();
  });

  it('freezes one redacted baseline before execution and ignores later proposals', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn(() => new Promise<never>(() => {})),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) =>
      criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 100,
        source: 'page' as const,
        value: false,
      })),
    );
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan([{ kind: 'page_text', operator: 'present', expected: 'Saved once', required: true }]);
        await hooks.onPlan([{ kind: 'page_text', operator: 'present', expected: 'Replaced later', required: true }]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 100,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-freeze',
      taskId: 'task-freeze',
      tabId: 7,
      instruction: 'submit a form',
      chatSessionId: 'chat-freeze',
      instructionMessageId: 'message-freeze',
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    const snapshot = await manager.snapshot('task-freeze');
    const criterion = snapshot?.rounds[0]?.criteria[0];

    expect(observeCriteria).toHaveBeenCalledOnce();
    expect(criterion).toMatchObject({
      kind: 'page_text',
      expectedDigest: await sha256('Saved once'),
      targetRefId: 'tab-7',
      baseline: false,
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: 10_000,
    });
    expect(JSON.stringify(snapshot)).not.toContain('Saved once');
    expect(JSON.stringify(snapshot)).not.toContain('Replaced later');
  });

  it('replaces a criterion copied from a user field value with dedicated confirmation', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn(() => new Promise<never>(() => {})),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan([
          { kind: 'page_text', operator: 'present', expected: 'FIELD_SENTINEL_8472', required: true },
        ]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 100,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-field-redaction',
      taskId: 'task-field-redaction',
      tabId: 7,
      instruction: 'name=FIELD_SENTINEL_8472',
      chatSessionId: 'chat-field-redaction',
      instructionMessageId: 'message-field-redaction',
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());
    const snapshot = await manager.snapshot('task-field-redaction');

    expect(snapshot?.rounds[0]?.criteria).toEqual([
      expect.objectContaining({ kind: 'user_confirmed', expected: true }),
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('FIELD_SENTINEL_8472');
  });

  it('retries one failed probe without completing early', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'submitted' }),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    let call = 0;
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
      call += 1;
      if (call === 2) throw new Error('probe unavailable');
      return criteria.map(item => ({
        criterionId: item.id,
        roundId: item.roundId,
        targetRefId: item.targetRefId,
        observedAt: 200,
        source: 'page' as const,
        value: call >= 3,
      }));
    });
    const manager = new TaskManager({
      createExecutor: async (_input, hooks) => {
        await hooks.onPlan([{ kind: 'page_text', operator: 'present', expected: 'Saved', required: true }]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 200,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-retry',
      taskId: 'task-retry',
      tabId: 7,
      instruction: 'submit the form',
      chatSessionId: 'chat-retry',
      instructionMessageId: 'message-retry',
    });

    await vi.waitFor(async () => expect((await manager.snapshot('task-retry'))?.status).toBe('completed'));
    expect(driver.run).toHaveBeenCalledTimes(2);
    expect(driver.addFollowUp).toHaveBeenCalledOnce();
    expect(observeCriteria).toHaveBeenCalledTimes(3);
  });
});
