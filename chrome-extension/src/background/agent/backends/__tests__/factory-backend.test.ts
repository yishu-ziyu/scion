import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { id: 'test-extension' },
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => undefined),
        },
      },
    },
  });
});

vi.mock('../../../../personal/bootstrap', () => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
}));

vi.mock('../../../../personal/config', () => ({}));

vi.mock('@extension/storage', () => ({
  generalSettingsStore: {
    getSettings: vi.fn(async () => ({})),
  },
  agentModelStore: {},
  llmProviderStore: {},
  firewallStore: {},
  AgentNameEnum: { Navigator: 'navigator', Planner: 'planner', Validator: 'validator' },
}));

vi.mock('../../../browser/context', () => ({
  default: class BrowserContext {
    updateConfig() {}
  },
}));

const createToolLoopControlDriver = vi.fn(async (...args: unknown[]) => {
  void args;
  return {
    run: vi.fn(),
    addFollowUp: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  };
});

vi.mock('../tool-loop-control', () => ({
  createToolLoopControlDriver: (...args: unknown[]) => createToolLoopControlDriver(...args),
}));

import { createExecutorDriver } from '../../factory';
import { fixtureFormControlSteps } from '../control-loop';

describe('factory control driver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createExecutorDriver without scripted steps uses the tool-loop control driver', async () => {
    const hooks = { onPlan: vi.fn(), dispatchAction: vi.fn() };
    await createExecutorDriver({ taskId: 't', roundId: 'r', instruction: 'i', tabId: 1 }, hooks);
    expect(createToolLoopControlDriver).toHaveBeenCalledOnce();
  });

  it('createExecutorDriver with scripted steps does not call the tool-loop control driver', async () => {
    const hooks = {
      onPlan: vi.fn(async () => undefined),
      dispatchAction: vi.fn(async (_r, action, args) => ({
        actionResult: await action.call(args),
        attempt: {
          id: 'a',
          roundId: 'r',
          actionName: action.name(),
          state: 'observed' as const,
          effect: 'reversible' as const,
          argsDigest: 'digest',
          proposedAt: 1,
        },
        evidence: [],
      })),
    };
    const driver = await createExecutorDriver({ taskId: 't', roundId: 'r', instruction: 'i', tabId: 1 }, hooks, {
      control: { steps: fixtureFormControlSteps() },
    });
    const outcome = await driver.run('r');
    expect(outcome.kind).toBe('candidate_complete');
    expect(createToolLoopControlDriver).not.toHaveBeenCalled();
  });
});
