/**
 * Chijie 0.2 / EPIC D3 — TaskServiceImpl + TaskHandleImpl bridge over the real
 * TaskManager. The point under test: start() resolves at the CommandAck while
 * the executor is still running, and progress/control flow through the handle
 * + D2 event stream without ever blocking on executor.run().
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskManager } from '../manager';
import { TaskServiceImpl, type StartTaskRequest } from '../task-service';
import { TaskHandleImpl } from '../task-handle';
import type { TaskEvent } from '../task-events';
import type { ExecutorDriver, ExecutorOutcome } from '../contracts';

const store = vi.hoisted(() => ({
  sessions: new Map<string, unknown>(),
  saveTask: vi.fn(async (task: { id: string }) => {
    store.sessions.set(task.id, structuredClone(task));
  }),
}));

vi.mock('@extension/storage/lib/chat', () => ({
  chatHistoryStore: { getSession: async () => null },
}));

vi.mock('@extension/storage/lib/task', () => ({
  isHumanPageReading: (value?: string) => Boolean(value?.trim()),
  compactPageReading: (value: string) => value,
  getTask: async (id: string) => store.sessions.get(id) ?? null,
  getActiveTask: async () => [...store.sessions.values()].at(-1) ?? null,
  saveTask: store.saveTask,
  deleteTask: async (id: string) => {
    store.sessions.delete(id);
  },
  getEvidenceSpace: async () => null,
  evidenceSpaceProgress: () => ({
    total: 0,
    userDiscussions: 0,
    products: 0,
    repository: 0,
    browserContext: 0,
    productPrinciples: 0,
  }),
  researchDecisionReady: () => false,
  researchDeliveryReady: () => false,
  advanceEvidenceWorkCycle: async () => null,
  resetEvidenceWorkCycles: async () => null,
  putSkillSaveMeta: async () => undefined,
  getSkillSaveMeta: async () => null,
  clearSkillSaveMetaForTask: async () => undefined,
}));

vi.mock('../../agent/factory', () => ({
  browserContext: {
    getCurrentPage: async () => {
      throw new Error('not attached in D3 bridge tests');
    },
  },
}));

type FailedOutcome = { kind: 'failed'; category: string };

/** run() resolves only when the test says so; finish() before run() is kept. */
function controllableDriver(): ExecutorDriver & { finish: (outcome: FailedOutcome) => void } {
  let settle: ((outcome: FailedOutcome) => void) | undefined;
  let pending: FailedOutcome | undefined;
  return {
    run: () =>
      new Promise<FailedOutcome>(resolve => {
        settle = resolve;
        if (pending) resolve(pending);
      }),
    addFollowUp: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(async () => undefined),
    finish: outcome => {
      if (settle) settle(outcome);
      else pending = outcome;
    },
  };
}

function makeService(driver: ExecutorDriver) {
  const createExecutor = vi.fn(async () => driver);
  const manager = new TaskManager({
    createExecutor,
    switchTab: vi.fn(async () => undefined),
    observeCriteria: vi.fn(async () => []),
    now: () => 100,
    postCommitVerifyDelaysMs: [0],
  });
  const service = new TaskServiceImpl({ manager, now: () => 100 });
  const internals = manager as unknown as { drivers: Map<string, ExecutorDriver> };
  return {
    service,
    createExecutor,
    waitDriverRegistered: (taskId: string) => vi.waitFor(() => expect(internals.drivers.has(taskId)).toBe(true)),
  };
}

const startInput: StartTaskRequest = {
  instruction: '打开 example.test 并总结页面',
  chatSessionId: 'chat-1',
  instructionMessageId: 'msg-1',
  tabId: 7,
  commandId: 'cmd-1',
  taskId: 'task-1',
};

describe('TaskServiceImpl (D3 bridge)', () => {
  beforeEach(() => {
    store.sessions.clear();
    store.saveTask.mockClear();
  });

  it('start resolves with a handle while the executor run never resolves', async () => {
    const never = controllableDriver();
    never.run = () => new Promise<ExecutorOutcome>(() => undefined);
    const { service, createExecutor } = makeService(never);

    const handle = await service.start(startInput);

    expect(handle.id).toBe('task-1');
    expect((handle as TaskHandleImpl).ack).toMatchObject({
      accepted: true,
      taskId: 'task-1',
      commandId: 'cmd-1',
    });
    const snapshot = await handle.snapshot();
    expect(snapshot.status).toBe('running');
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
    // start() already returned; the executor is still (permanently) running.
  });

  it('duplicate commandId returns the same ack and creates one session', async () => {
    const { service, createExecutor } = makeService(controllableDriver());

    const first = await service.start(startInput);
    const second = await service.start(startInput);

    expect((second as TaskHandleImpl).ack).toEqual((first as TaskHandleImpl).ack);
    expect(second.id).toBe(first.id);
    expect(store.sessions.size).toBe(1);
    await vi.waitFor(() => expect(createExecutor).toHaveBeenCalledTimes(1));
  });

  it('subscribe receives the D2 event stream; unsubscribe stops delivery without touching the task', async () => {
    const driver = controllableDriver();
    const { service, waitDriverRegistered } = makeService(driver);
    const handle = await service.start(startInput);

    const events: TaskEvent[] = [];
    const off = handle.subscribe(event => events.push(event));
    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0));
    expect(events[0]).toMatchObject({ type: 'task.accepted', taskId: 'task-1', sequence: 1 });
    await waitDriverRegistered('task-1');

    off();
    const ack = await handle.pause();
    expect(ack.accepted).toBe(true);
    expect(driver.pause).toHaveBeenCalled();
    expect((await handle.snapshot()).status).toBe('paused');
    // The chat-side subscriber is gone but the task lifecycle kept running.
    expect(events.some(event => event.type === 'task.state_changed')).toBe(false);
    expect(driver.stop).not.toHaveBeenCalled();
  });

  it('runtime failure arrives as task.failed, distinct from a rejected start', async () => {
    const driver = controllableDriver();
    const { service } = makeService(driver);
    const handle = await service.start(startInput);

    const events: TaskEvent[] = [];
    handle.subscribe(event => events.push(event));

    driver.finish({ kind: 'failed', category: 'llm_failed' });
    await vi.waitFor(() =>
      expect(events.some(event => event.type === 'task.failed' && event.payload.category === 'llm_failed')).toBe(true),
    );
    expect((await handle.snapshot()).status).toBe('failed');

    // A rejected start never creates a session and carries its own error.
    const rejected = await service.start({
      ...startInput,
      instruction: '   ',
      commandId: 'cmd-bad',
      taskId: 'task-bad',
    });
    const rejectedAck = (rejected as TaskHandleImpl).ack;
    expect(rejectedAck?.accepted).toBe(false);
    if (rejectedAck && !rejectedAck.accepted) expect(rejectedAck.error).toBe('invalid_input');
    expect(store.sessions.has('task-bad')).toBe(false);
  });

  it('get rebuilds an equivalent handle; unknown id yields null', async () => {
    const { service } = makeService(controllableDriver());
    const started = await service.start(startInput);

    const rebuilt = await service.get(started.id);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt?.id).toBe(started.id);
    expect((await rebuilt?.snapshot())?.id).toBe(started.id);
    expect(await service.get('gone')).toBeNull();
  });
});
