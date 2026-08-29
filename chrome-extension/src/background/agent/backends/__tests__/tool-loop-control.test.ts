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
  agentModelStore: { getModel: vi.fn() },
  llmProviderStore: { getAllProviders: vi.fn() },
  firewallStore: { getFirewall: vi.fn() },
  evalSettingsStore: { getSettings: vi.fn() },
  getApiKey: vi.fn(),
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

  it('proposes complete when a multi-step Chinese brief only names 页上出现 Saved successfully', async () => {
    const observe = vi.fn(async () => ({
      text: 'Saved successfully',
      visibleText: 'Saved successfully',
      url: 'http://127.0.0.1/form',
      title: 'Form',
    }));
    const driver = await createToolLoopControlDriver(
      {
        taskId: 't-fused',
        roundId: 'r-fused',
        instruction:
          '请按顺序做完。打开 http://127.0.0.1/brief 读候鸟简报并引用正文，打开 http://127.0.0.1/list 整理 6 个产品表，打开 http://127.0.0.1/form 把名字填成 FIELD_SENTINEL_8472 并提交，成功标志是页上出现 Saved successfully，最后用中文写纪要。',
        tabId: 9,
      },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [textGenerateResult('Looking.')],
        }),
        runBrowser: { observe, act: async () => ({ summary: 'unused' }) },
        maxSteps: 1,
      },
    );
    await expect(driver.run('r-fused')).resolves.toEqual({
      kind: 'candidate_complete',
      summary: 'Saved successfully',
    });
  });

  it('proposes complete when a Chinese success cue is already on the page', async () => {
    const observe = vi.fn(async () => ({
      text: 'Saved successfully',
      visibleText: 'Saved successfully',
      url: 'http://127.0.0.1/form',
      title: 'Form',
    }));
    const driver = await createToolLoopControlDriver(
      {
        taskId: 't5',
        roundId: 'r5',
        instruction: '把名字填成 FIELD_SENTINEL_8472 然后提交。成功标志是页上出现 Saved successfully。',
        tabId: 9,
      },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [textGenerateResult('Looking.')],
        }),
        runBrowser: { observe, act: async () => ({ summary: 'unused' }) },
        maxSteps: 1,
      },
    );
    await expect(driver.run('r5')).resolves.toEqual({
      kind: 'candidate_complete',
      summary: 'Saved successfully',
    });
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

  it('does not accept done before the named on-page success is visible', async () => {
    const observe = vi.fn(async () => ({
      text: 'Hacker News',
      visibleText: 'Hacker News',
      url: 'https://news.ycombinator.com/',
      title: 'HN',
    }));
    const driver = await createToolLoopControlDriver(
      {
        taskId: 't-hn-done',
        roundId: 'r-hn-done',
        instruction:
          '请按顺序做完。打开 https://news.ycombinator.com/ 把前 5 条标题整理成表。打开 https://httpbin.org/forms/post 把 Customer name 填成 FIELD_SENTINEL_8472 并提交。成功标志是页上出现 FIELD_SENTINEL_8472。最后用中文写纪要。',
        tabId: 9,
      },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [toolCallGenerateResult('done', { text: 'Opened news.ycombinator.com', success: true })],
        }),
        runBrowser: { observe, act: async () => ({ summary: 'unused' }) },
        maxSteps: 1,
      },
    );
    await expect(driver.run('r-hn-done')).resolves.toEqual({ kind: 'failed', category: 'max_steps' });
  });

  it('accepts done after the named success was seen, even if the current page moved on', async () => {
    let calls = 0;
    const observe = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: '{"custname":"FIELD_SENTINEL_8472"}',
          visibleText: '{"custname":"FIELD_SENTINEL_8472"}',
          url: 'https://httpbin.org/post',
          title: 'httpbin',
        };
      }
      return {
        text: 'Hacker News',
        visibleText: 'Hacker News',
        url: 'https://news.ycombinator.com/',
        title: 'HN',
      };
    });
    const driver = await createToolLoopControlDriver(
      {
        taskId: 't-seen-then-leave',
        roundId: 'r-seen-then-leave',
        instruction:
          '打开 https://httpbin.org/forms/post 把 Customer name 填成 FIELD_SENTINEL_8472 并提交。成功标志是页上出现 FIELD_SENTINEL_8472。然后打开 https://news.ycombinator.com/',
        tabId: 9,
      },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [
            toolCallGenerateResult('observe', {}),
            toolCallGenerateResult('done', { text: 'FIELD_SENTINEL_8472', success: true }),
          ],
        }),
        runBrowser: { observe, act: async () => ({ summary: 'unused' }) },
        maxSteps: 4,
      },
    );
    await expect(driver.run('r-seen-then-leave')).resolves.toEqual({
      kind: 'candidate_complete',
      summary: 'FIELD_SENTINEL_8472',
    });
  });

  it('accepts done once the named field-value success is visible', async () => {
    const observe = vi.fn(async () => ({
      text: '{"custname": "FIELD_SENTINEL_8472"}',
      visibleText: '{"custname": "FIELD_SENTINEL_8472"}',
      url: 'https://httpbin.org/post',
      title: 'httpbin',
    }));
    const driver = await createToolLoopControlDriver(
      {
        taskId: 't-sentinel-done',
        roundId: 'r-sentinel-done',
        instruction:
          '打开 https://httpbin.org/forms/post 把 Customer name 填成 FIELD_SENTINEL_8472 并提交。成功标志是页上出现 FIELD_SENTINEL_8472。',
        tabId: 9,
      },
      hooksMock(),
      {} as never,
      {
        model: new MockLanguageModelV4({
          doGenerate: [toolCallGenerateResult('done', { text: 'FIELD_SENTINEL_8472', success: true })],
        }),
        runBrowser: { observe, act: async () => ({ summary: 'unused' }) },
        maxSteps: 1,
      },
    );
    await expect(driver.run('r-sentinel-done')).resolves.toEqual({
      kind: 'candidate_complete',
      summary: 'FIELD_SENTINEL_8472',
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
