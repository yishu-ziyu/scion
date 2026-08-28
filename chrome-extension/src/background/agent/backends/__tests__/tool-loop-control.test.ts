import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  Object.defineProperty(globalThis, 'chrome', {
    configurable: true,
    value: {
      runtime: { id: 'test-extension' },
      storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(async () => undefined) } },
    },
  });
});

vi.mock('../../../../personal/bootstrap', () => ({
  ensurePersonalDefaults: vi.fn(async () => undefined),
}));

vi.mock('../../../../personal/config', () => ({}));

vi.mock('@extension/storage', () => ({
  generalSettingsStore: {
    getSettings: vi.fn(async () => ({ maxSteps: 8 })),
  },
  agentModelStore: { cleanupLegacyValidatorSettings: vi.fn(), getAllAgentModels: vi.fn() },
  llmProviderStore: { getAllProviders: vi.fn() },
  firewallStore: { getFirewall: vi.fn() },
  evalSettingsStore: { getSettings: vi.fn() },
  getApiKey: vi.fn(),
  AgentNameEnum: { Navigator: 'navigator', Planner: 'planner', Validator: 'validator' },
}));

vi.mock('@extension/i18n', () => ({ t: (key: string) => key }));

import { createToolLoopControlDriver } from '../tool-loop-control';
import {
  MockLanguageModelV4,
  textGenerateResult,
  toolCallGenerateResult,
} from '../../../orchestrator/__tests__/mock-model';
import type { ExecutorHooks } from '../../../task/contracts';

const here = dirname(fileURLToPath(import.meta.url));

function hooksMock(): ExecutorHooks {
  return {
    onPlan: vi.fn(async () => undefined),
    dispatchAction: vi.fn(async () => {
      throw new Error('dispatchAction must not run in injected-browser tests');
    }),
  };
}

describe('tool-loop control driver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens, observes, and finishes through native tools without JSON extraction', async () => {
    const observe = vi.fn(async () => ({
      text: 'Interactive elements\n[1] Submit',
      url: 'https://example.test/form',
      title: 'Form',
    }));
    const act = vi.fn(async (name: string) => {
      if (name === 'go_to_url') return { summary: 'opened' };
      if (name === 'click_element') return { summary: 'clicked' };
      return { summary: name };
    });
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCallGenerateResult('go_to_url', { url: 'https://example.test/form' }),
        toolCallGenerateResult('click_element', { index: 1 }),
        toolCallGenerateResult('done', { text: 'Submitted.', success: true }),
      ],
    });
    const driver = await createToolLoopControlDriver(
      { taskId: 't1', roundId: 'r1', instruction: 'open the form and submit', tabId: 9 },
      hooksMock(),
      {} as never,
      { model, runBrowser: { observe, act }, maxSteps: 8 },
    );

    await expect(driver.run('r1')).resolves.toEqual({ kind: 'candidate_complete', summary: 'Submitted.' });
    expect(act).toHaveBeenCalledWith('go_to_url', expect.objectContaining({ url: 'https://example.test/form' }));
    expect(act).toHaveBeenCalledWith('click_element', expect.objectContaining({ index: 1 }));
    expect(JSON.stringify(model.doGenerateCalls)).not.toMatch(/extractJsonFromModelOutput/);
  });

  it('replies with waiting_user from the wait_for_user tool', async () => {
    const driver = await createToolLoopControlDriver(
      { taskId: 't2', roundId: 'r2', instruction: 'open the dashboard', tabId: 3 },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [toolCallGenerateResult('wait_for_user', { reason: 'login_required' })],
        }),
        runBrowser: {
          observe: async () => ({ text: 'Sign in' }),
          act: async () => ({ summary: 'unused' }),
        },
        maxSteps: 4,
      },
    );
    await expect(driver.run('r2')).resolves.toEqual({ kind: 'waiting_user', reason: 'login_required' });
  });

  it('proposes complete when the page already shows the instruction success text', async () => {
    const observe = vi.fn(async () => ({
      text: 'Name Submit',
      visibleText: 'Saved successfully',
      url: 'https://example.test/form',
      title: 'Form',
    }));
    const act = vi.fn(async () => ({ summary: 'clicked' }));
    const driver = await createToolLoopControlDriver(
      {
        taskId: 't4',
        roundId: 'r4',
        instruction: 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
        tabId: 9,
      },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [toolCallGenerateResult('click_element', { index: 2 }), textGenerateResult('Still working.')],
        }),
        runBrowser: { observe, act },
        maxSteps: 2,
      },
    );
    await expect(driver.run('r4')).resolves.toEqual({
      kind: 'candidate_complete',
      summary: 'Saved successfully',
    });
  });

  it('does not call the browser when the model only writes text, then marks max_steps', async () => {
    const act = vi.fn(async () => ({ summary: 'should not run' }));
    const driver = await createToolLoopControlDriver(
      { taskId: 't3', roundId: 'r3', instruction: 'hello', tabId: 1 },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: async () => textGenerateResult('I cannot operate the browser in text.'),
        }),
        runBrowser: { observe: async () => ({ text: '' }), act },
        maxSteps: 1,
      },
    );
    await expect(driver.run('r3')).resolves.toEqual({ kind: 'failed', category: 'max_steps' });
    expect(act).not.toHaveBeenCalled();
  });
});

describe('tool-loop control source contract', () => {
  it('is the factory main path and does not extract JSON from model text', () => {
    const control = readFileSync(join(here, '../tool-loop-control.ts'), 'utf8');
    const tools = readFileSync(join(here, '../tool-loop-control-tools.ts'), 'utf8');
    const factory = readFileSync(join(here, '../../factory.ts'), 'utf8');
    expect(control).not.toContain('extractJsonFromModelOutput');
    expect(tools).not.toContain('extractJsonFromModelOutput');
    expect(control).toContain('ToolLoopAgent');
    expect(tools).toContain('EVERYDAY_CONTROL_ACTION_NAMES');
    expect(tools).toContain('ALL_ACTION_SCHEMAS');
    expect(factory).toContain('createToolLoopControlDriver');
    expect(factory).not.toMatch(/return createLlmControlDriver/);
  });
});
