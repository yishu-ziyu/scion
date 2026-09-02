import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { CommandAck, TaskSession } from '@extension/storage/lib/task';
import type { StartTaskInput, TaskHandle, TaskService, Unsubscribe } from '../handle';

function makeSession(id: string): TaskSession {
  return {
    id,
    goalSummary: 'test goal',
    status: 'running',
    revision: 1,
    activeTabId: 7,
    currentRoundId: 'round-1',
    targetRefs: [],
    rounds: [],
    createdAt: 1,
    updatedAt: 1,
  };
}

function fakeHandle(id: string): TaskHandle {
  const ack = (commandId: string): CommandAck => ({
    accepted: true,
    commandId,
    taskId: id,
    revision: 2,
  });
  return {
    id,
    snapshot: async () => makeSession(id),
    followUp: async input => ack(input.instructionMessageId),
    pause: async () => ack('p1'),
    resume: async () => ack('r1'),
    cancel: async () => ack('c1'),
    subscribe: () => () => undefined,
  };
}

function fakeService(): TaskService {
  return {
    start: async () => fakeHandle('task-1'),
    get: async taskId => (taskId === 'task-1' ? fakeHandle(taskId) : null),
  };
}

describe('D1 TaskHandle / TaskService contract', () => {
  it('compiles to the exact async API shapes (no blocking-until-done return)', () => {
    const service = fakeService();
    expectTypeOf(service.start).parameter(0).toEqualTypeOf<StartTaskInput>();
    expectTypeOf(service.start).returns.toEqualTypeOf<Promise<TaskHandle>>();
    expectTypeOf(service.get).returns.toEqualTypeOf<Promise<TaskHandle | null>>();

    const handle = fakeHandle('task-1');
    expectTypeOf(handle.id).toEqualTypeOf<string>();
    expectTypeOf(handle.snapshot).returns.toEqualTypeOf<Promise<TaskSession>>();
    expectTypeOf(handle.followUp).returns.toEqualTypeOf<Promise<CommandAck>>();
    expectTypeOf(handle.pause).returns.toEqualTypeOf<Promise<CommandAck>>();
    expectTypeOf(handle.resume).returns.toEqualTypeOf<Promise<CommandAck>>();
    expectTypeOf(handle.cancel).returns.toEqualTypeOf<Promise<CommandAck>>();
    expectTypeOf(handle.subscribe).returns.toEqualTypeOf<Unsubscribe>();
    // start resolves to a handle, NOT to a finished-task result:
    expectTypeOf(service.start).returns.not.toEqualTypeOf<Promise<TaskSession>>();
  });

  it('start returns a usable handle immediately without task completion', async () => {
    const service = fakeService();
    const handle = await service.start({
      instruction: '去查一下',
      chatSessionId: 'chat-1',
      instructionMessageId: 'msg-1',
      tabId: 7,
    });
    expect(handle.id).toBe('task-1');
    // handle is usable right away (snapshot is an in-flight task, not a result):
    const snap = await handle.snapshot();
    expect(snap.status).toBe('running');
  });

  it('every control call resolves with a CommandAck, not the outcome', async () => {
    const handle = fakeHandle('task-1');
    const ack = await handle.followUp({
      instruction: '再来一轮',
      chatSessionId: 'chat-1',
      instructionMessageId: 'msg-2',
    });
    expect(ack.accepted).toBe(true);
    expect((await handle.pause()).accepted).toBe(true);
    expect((await handle.resume()).accepted).toBe(true);
    expect((await handle.cancel()).accepted).toBe(true);
  });

  it('subscribe returns an idempotent Unsubscribe', () => {
    const handle = fakeHandle('task-1');
    const listener = vi.fn();
    const off = handle.subscribe(listener);
    expect(off).toBeTypeOf('function');
    expect(() => off()).not.toThrow();
  });

  it('handles are rebuildable: get(taskId) yields an equivalent handle', async () => {
    const service = fakeService();
    const first = await service.start({
      instruction: 'x',
      chatSessionId: 'c',
      instructionMessageId: 'm',
      tabId: 1,
    });
    const rebuilt = await service.get(first.id);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt?.id).toBe(first.id);
    expect((await rebuilt?.snapshot())?.id).toBe(first.id);
    expect(await service.get('gone')).toBeNull();
  });
});
