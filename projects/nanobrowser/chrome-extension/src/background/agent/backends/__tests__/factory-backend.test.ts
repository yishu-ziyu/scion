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

vi.mock('../../../../personal/config', () => ({
  PERSONAL_AGENT_CORE_BACKEND: null,
}));

vi.mock('@extension/storage', () => ({
  generalSettingsStore: {
    getSettings: vi.fn(async () => ({ agentCoreBackend: 'control' })),
  },
  agentModelStore: {},
  llmProviderStore: {},
  firewallStore: {},
  AgentNameEnum: { Navigator: 'navigator', Planner: 'planner' },
}));

vi.mock('../../../browser/context', () => ({
  default: class BrowserContext {
    updateConfig() {}
  },
}));

const createNanoExecutorDriver = vi.fn(async () => ({
  run: vi.fn(),
  addFollowUp: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
}));

const createLlmControlDriver = vi.fn(async () => ({
  run: vi.fn(),
  addFollowUp: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('../nano', () => ({
  createNanoExecutorDriver: (...args: unknown[]) => createNanoExecutorDriver(...args),
}));

vi.mock('../control-llm', () => ({
  createLlmControlDriver: (...args: unknown[]) => createLlmControlDriver(...args),
}));

import { createExecutorDriver, resolveAgentCoreBackend } from '../../factory';
import { fixtureFormControlSteps } from '../control-loop';

describe('factory multi-backend (design/002)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolveAgentCoreBackend defaults to control (M2)', async () => {
    await expect(resolveAgentCoreBackend()).resolves.toBe('control');
  });

  it('resolveAgentCoreBackend honors explicit control', async () => {
    await expect(resolveAgentCoreBackend('control')).resolves.toBe('control');
  });

  it('createExecutorDriver nano path calls nano backend', async () => {
    const hooks = { onPlan: vi.fn(), dispatchAction: vi.fn() };
    await createExecutorDriver(
      { taskId: 't', roundId: 'r', instruction: 'i', tabId: 1 },
      hooks,
      { backend: 'nano' },
    );
    expect(createNanoExecutorDriver).toHaveBeenCalledOnce();
  });

  it('createExecutorDriver control without steps uses LLM control driver', async () => {
    const hooks = { onPlan: vi.fn(), dispatchAction: vi.fn() };
    await createExecutorDriver(
      { taskId: 't', roundId: 'r', instruction: 'i', tabId: 1 },
      hooks,
      { backend: 'control' },
    );
    expect(createLlmControlDriver).toHaveBeenCalledOnce();
    expect(createNanoExecutorDriver).not.toHaveBeenCalled();
  });

  it('createExecutorDriver control with steps returns runnable driver', async () => {
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
          proposedAt: 1,
        },
        evidence: [],
      })),
    };
    const driver = await createExecutorDriver(
      { taskId: 't', roundId: 'r', instruction: 'i', tabId: 1 },
      hooks,
      { backend: 'control', control: { steps: fixtureFormControlSteps() } },
    );
    const outcome = await driver.run('r');
    expect(outcome.kind).toBe('candidate_complete');
    expect(createNanoExecutorDriver).not.toHaveBeenCalled();
    expect(createLlmControlDriver).not.toHaveBeenCalled();
  });
});
