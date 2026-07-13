import { describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: { runtime: { id: 'test-extension' } },
  });
});

import { AgentContext } from '../types';
import { Actors, ExecutionState, type AgentEvent } from '../event/types';
import { shouldPersistExecutionEvent } from '../../../../../pages/side-panel/src/event-persistence';

function emittedEvent(emit: ReturnType<typeof vi.fn<(event: AgentEvent) => Promise<void>>>): AgentEvent {
  const event = emit.mock.calls.at(0)?.[0];
  if (!event) throw new Error('Expected an emitted event');
  return event;
}

describe('AgentContext event privacy', () => {
  it.each([
    [ExecutionState.ACT_START, 'action_started'],
    [ExecutionState.ACT_OK, 'action_completed'],
    [ExecutionState.ACT_FAIL, 'action_failed'],
  ])('redacts raw action details for %s before emission', async (state, expected) => {
    const emit = vi.fn<(event: AgentEvent) => Promise<void>>(async () => undefined);
    const context = new AgentContext('task-1', {} as never, {} as never, { emit } as never, {});
    const secret = 'email jane@example.test SSN 123-45-6789 full cached page body';

    await context.emitEvent(Actors.NAVIGATOR, state, secret);

    expect(emit).toHaveBeenCalledOnce();
    const event = emittedEvent(emit);
    expect(event.data.details).toBe(expected);
    expect(JSON.stringify(event)).not.toContain(secret);
  });

  it('preserves non-action status details', async () => {
    const emit = vi.fn<(event: AgentEvent) => Promise<void>>(async () => undefined);
    const context = new AgentContext('task-1', {} as never, {} as never, { emit } as never, {});

    await context.emitEvent(Actors.SYSTEM, ExecutionState.TASK_FAIL, 'Configuration is missing');

    expect(emittedEvent(emit).data.details).toBe('Configuration is missing');
  });

  it('redacts model-generated planner details before emission', async () => {
    const emit = vi.fn<(event: AgentEvent) => Promise<void>>(async () => undefined);
    const context = new AgentContext('task-1', {} as never, {} as never, { emit } as never, {});

    await context.emitEvent(
      Actors.PLANNER,
      ExecutionState.STEP_OK,
      'Next enter jane@example.test and copy the full page body',
    );

    expect(emittedEvent(emit).data.details).toBe('step_completed');
  });

  it.each([ExecutionState.ACT_START, ExecutionState.ACT_OK, ExecutionState.ACT_FAIL])(
    'keeps %s out of durable side-panel chat history',
    state => {
      expect(shouldPersistExecutionEvent(state as never)).toBe(false);
    },
  );
});
