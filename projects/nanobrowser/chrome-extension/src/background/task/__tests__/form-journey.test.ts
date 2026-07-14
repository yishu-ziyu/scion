import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompletionCriterion } from '@extension/storage/lib/task';
import { TaskManager, type ExecutorDriver } from '../manager';
import type { ProbeObservation } from '../contracts';
import { sha256 } from '../digest';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
}));

vi.mock('@extension/storage/lib/task', () => {
  const skillSave = new Map<string, { templates: unknown[]; unsafe: boolean }>();
  return {
    getTask: async (id: string) => store.sessions.get(id) ?? null,
    getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
    saveTask: async (task: { id: string }) => {
      store.sessions.set(task.id, structuredClone(task));
    },
    putSkillSaveMeta: async (
      taskId: string,
      roundId: string,
      meta: { templates: unknown[]; unsafe: boolean },
    ) => {
      skillSave.set(`${taskId}:${roundId}`, structuredClone(meta));
    },
    getSkillSaveMeta: async (taskId: string, roundId: string) =>
      structuredClone(skillSave.get(`${taskId}:${roundId}`) ?? null),
    clearSkillSaveMetaForTask: async (taskId: string) => {
      for (const key of [...skillSave.keys()]) {
        if (key.startsWith(`${taskId}:`)) skillSave.delete(key);
      }
    },
  };
});

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
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
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
    expect(driver.stop).not.toHaveBeenCalled();
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
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
        ]);
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
    expect(driver.stop).not.toHaveBeenCalled();
  });

  it('reuses completed executor memory for the next follow-up round', async () => {
    const driver: ExecutorDriver = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ kind: 'candidate_complete', summary: 'finished first round' })
        .mockImplementation(() => new Promise<never>(() => {})),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    let observationCall = 0;
    const createExecutor = vi.fn(async (input, hooks) => {
      await hooks.onPlan(input.roundId, [
        { kind: 'url', operator: 'equals', expected: 'https://example.test/done', required: true },
      ]);
      return driver;
    });
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: CompletionCriterion[]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 350,
          source: 'page' as const,
          value: observationCall++ === 0 ? 'https://example.test/start' : 'https://example.test/done',
        })),
      ),
      now: () => 350,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-memory',
      taskId: 'task-memory',
      tabId: 7,
      instruction: 'finish the first round',
      chatSessionId: 'chat-memory',
      instructionMessageId: 'message-memory-1',
    });
    await vi.waitFor(async () => expect((await manager.snapshot('task-memory'))?.status).toBe('completed'));
    const completed = await manager.snapshot('task-memory');
    if (!completed) throw new Error('Expected completed first round');

    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-memory',
      taskId: completed.id,
      expectedRevision: completed.revision,
      instruction: 'continue with the same context',
      chatSessionId: 'chat-memory',
      instructionMessageId: 'message-memory-2',
    });

    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    const followedUp = await manager.snapshot('task-memory');
    expect(createExecutor).toHaveBeenCalledOnce();
    expect(driver.stop).not.toHaveBeenCalled();
    expect(driver.addFollowUp).toHaveBeenCalledWith('continue with the same context');
    expect(driver.run).toHaveBeenNthCalledWith(2, followedUp?.currentRoundId);
  });

  it('hands a follow-up to the same runner when the old completion probe is pending', async () => {
    let finishProbe!: (observations: ProbeObservation[]) => void;
    const driver: ExecutorDriver = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ kind: 'candidate_complete', summary: 'candidate from old round' })
        .mockImplementation(() => new Promise<never>(() => {})),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    let probeCall = 0;
    const observeCriteria = vi.fn(async (criteria: CompletionCriterion[]) => {
      probeCall += 1;
      if (probeCall === 1) {
        return criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: item.targetRefId,
          observedAt: 360,
          source: 'page' as const,
          value: 'https://example.test/start',
        }));
      }
      return new Promise<ProbeObservation[]>(resolve => (finishProbe = resolve));
    });
    const createExecutor = vi.fn(async (input, hooks) => {
      await hooks.onPlan(input.roundId, [
        { kind: 'url', operator: 'equals', expected: 'https://example.test/done', required: true },
      ]);
      return driver;
    });
    const manager = new TaskManager({
      createExecutor,
      switchTab: vi.fn(),
      observeCriteria,
      now: () => 360,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-probe-handoff',
      taskId: 'task-probe-handoff',
      tabId: 7,
      instruction: 'finish, then continue',
      chatSessionId: 'chat-probe-handoff',
      instructionMessageId: 'message-probe-handoff-1',
    });
    await vi.waitFor(() => expect(finishProbe).toBeTypeOf('function'));
    const probing = await manager.snapshot('task-probe-handoff');
    if (!probing) throw new Error('Expected probing task');
    const oldRoundId = probing.currentRoundId;
    const oldCriterion = probing.rounds.find(item => item.id === oldRoundId)?.criteria[0];
    if (!oldCriterion) throw new Error('Expected old completion criterion');

    await manager.dispatch({
      type: 'follow_up',
      commandId: 'follow-probe-handoff',
      taskId: probing.id,
      expectedRevision: probing.revision,
      instruction: 'continue in the new round',
      chatSessionId: 'chat-probe-handoff',
      instructionMessageId: 'message-probe-handoff-2',
    });
    expect(driver.run).toHaveBeenCalledOnce();
    expect(driver.addFollowUp).toHaveBeenCalledWith('continue in the new round');

    finishProbe([
      {
        criterionId: oldCriterion.id,
        roundId: oldRoundId,
        targetRefId: oldCriterion.targetRefId,
        observedAt: 360,
        source: 'page',
        value: 'https://example.test/done',
      },
    ]);

    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledTimes(2));
    const followedUp = await manager.snapshot(probing.id);
    expect(createExecutor).toHaveBeenCalledOnce();
    expect(driver.run).toHaveBeenNthCalledWith(2, followedUp?.currentRoundId);
    expect(followedUp).toMatchObject({
      status: 'running',
      rounds: [{ evidence: [] }, { status: 'running', criteria: [], evidence: [] }],
    });
  });

  it('freezes one redacted baseline before execution and ignores later proposals', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn(() => new Promise<never>(() => {})),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const switchTab = vi.fn();
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
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: 'Saved once', required: true },
        ]);
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: 'Replaced later', required: true },
        ]);
        return driver;
      },
      switchTab,
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
    // runCurrentRound switches once; freeze baselining switches again onto the task tab.
    expect(switchTab.mock.calls.filter(call => call[0] === 7).length).toBeGreaterThanOrEqual(2);
    const freezeObserveOrder = observeCriteria.mock.invocationCallOrder[0];
    expect(switchTab.mock.invocationCallOrder.some(order => order < freezeObserveOrder)).toBe(true);
    expect(criterion).toMatchObject({
      kind: 'page_text',
      expectedDigest: await sha256('Saved once'),
      targetRefId: 'tab-7',
      baseline: false,
      frozenAt: 100,
      notBefore: 100,
      timeoutMs: 120_000,
    });
    expect(JSON.stringify(snapshot)).not.toContain('Saved once');
    expect(JSON.stringify(snapshot)).not.toContain('Replaced later');
  });

  it('binds frozen criteria to the tab that produced the baseline', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn(() => new Promise<never>(() => {})),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const manager = new TaskManager({
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'url', operator: 'equals', expected: 'https://example.test/done', required: true },
        ]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: CompletionCriterion[]) =>
        criteria.map(item => ({
          criterionId: item.id,
          roundId: item.roundId,
          targetRefId: 'tab-8',
          observedAt: 100,
          source: 'page' as const,
          value: 'https://example.test/start',
        })),
      ),
      now: () => 100,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-live-target',
      taskId: 'task-live-target',
      tabId: 7,
      instruction: 'finish on the current tab',
      chatSessionId: 'chat-live-target',
      instructionMessageId: 'message-live-target',
    });
    await vi.waitFor(() => expect(driver.run).toHaveBeenCalledOnce());

    await expect(manager.snapshot('task-live-target')).resolves.toMatchObject({
      activeTabId: 8,
      rounds: [{ criteria: [{ targetRefId: 'tab-8', baseline: 'https://example.test/start' }] }],
    });
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
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
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
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: 'Saved', required: true },
        ]);
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

  it('combines automatic proof with one dedicated user confirmation', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'submitted' }),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    let call = 0;
    const manager = new TaskManager({
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'page_text', operator: 'present', expected: 'Saved', required: true },
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
        ]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async (criteria: CompletionCriterion[]) => {
        call += 1;
        return criteria
          .filter(item => item.kind !== 'user_confirmed')
          .map(item => ({
            criterionId: item.id,
            roundId: item.roundId,
            targetRefId: item.targetRefId,
            observedAt: 300,
            source: 'page' as const,
            value: call > 1,
          }));
      }),
      now: () => 300,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-mixed',
      taskId: 'task-mixed',
      tabId: 7,
      instruction: 'submit and let me verify',
      chatSessionId: 'chat-mixed',
      instructionMessageId: 'message-mixed',
    });
    await vi.waitFor(async () => expect((await manager.snapshot('task-mixed'))?.status).toBe('waiting_user'));
    const waiting = await manager.snapshot('task-mixed');
    const round = waiting?.rounds[0];
    const confirmation = round?.criteria.find(item => item.kind === 'user_confirmed');
    if (!waiting || !round || !confirmation) throw new Error('Expected mixed confirmation criteria');
    expect(round.evidence).toEqual([expect.objectContaining({ source: 'page', passed: true })]);

    await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-mixed',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      criterionId: confirmation.id,
    });

    await expect(manager.snapshot('task-mixed')).resolves.toMatchObject({
      status: 'completed',
      rounds: [{ receipt: expect.any(Object) }],
    });
  });

  it('persists each dedicated confirmation before completing the set', async () => {
    const driver: ExecutorDriver = {
      run: vi.fn().mockResolvedValue({ kind: 'candidate_complete', summary: 'needs two confirmations' }),
      addFollowUp: vi.fn(),
      pause: vi.fn(),
      resume: vi.fn(),
      stop: vi.fn(),
    };
    const manager = new TaskManager({
      createExecutor: async (input, hooks) => {
        await hooks.onPlan(input.roundId, [
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
          { kind: 'user_confirmed', operator: 'equals', expected: true, required: true },
        ]);
        return driver;
      },
      switchTab: vi.fn(),
      observeCriteria: vi.fn(async () => []),
      now: () => 400,
    });

    await manager.dispatch({
      type: 'start',
      commandId: 'start-two-confirmations',
      taskId: 'task-two-confirmations',
      tabId: 7,
      instruction: 'perform two outcomes that need confirmation',
      chatSessionId: 'chat-two-confirmations',
      instructionMessageId: 'message-two-confirmations',
    });
    await vi.waitFor(async () =>
      expect((await manager.snapshot('task-two-confirmations'))?.status).toBe('waiting_user'),
    );
    const waiting = await manager.snapshot('task-two-confirmations');
    const round = waiting?.rounds[0];
    if (!waiting || !round || round.criteria.length !== 2) throw new Error('Expected two confirmation criteria');

    const firstAck = await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-first',
      taskId: waiting.id,
      expectedRevision: waiting.revision,
      roundId: round.id,
      criterionId: round.criteria[0].id,
    });
    expect(firstAck.accepted).toBe(true);
    const partiallyConfirmed = await manager.snapshot(waiting.id);
    expect(partiallyConfirmed).toMatchObject({
      status: 'waiting_user',
      rounds: [{ evidence: [expect.objectContaining({ criterionId: round.criteria[0].id, passed: true })] }],
    });
    if (!partiallyConfirmed) throw new Error('Expected partially confirmed task');

    const secondAck = await manager.dispatch({
      type: 'confirm_completion',
      commandId: 'confirm-second',
      taskId: waiting.id,
      expectedRevision: partiallyConfirmed.revision,
      roundId: round.id,
      criterionId: round.criteria[1].id,
    });
    expect(secondAck.accepted).toBe(true);
    await expect(manager.snapshot(waiting.id)).resolves.toMatchObject({
      status: 'completed',
      rounds: [
        {
          evidence: [
            expect.objectContaining({ criterionId: round.criteria[0].id, passed: true }),
            expect.objectContaining({ criterionId: round.criteria[1].id, passed: true }),
          ],
          receipt: expect.any(Object),
        },
      ],
    });
  });
});
