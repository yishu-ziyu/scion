/**
 * Shadow Mode wiring tests (C6 third batch). No Chrome: the recorder runs on
 * plain frames and the driver test injects a fake ToolLoopBrowser. Trace spans
 * land in the real TraceStore's in-memory map (chrome.storage is mocked).
 */
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

import { generalSettingsStore, type GeneralSettingsConfig } from '@extension/storage';
import { createShadowRecorder } from '../shadow-recorder';
import { createToolLoopControlDriver } from '../tool-loop-control';
import { traceStore, type TraceSpan } from '../../../task/trace';
import type { ObservationFrame } from '../../../browser/kernel';
import { MockLanguageModelV4, toolCallGenerateResult } from '../../../orchestrator/__tests__/mock-model';
import type { ExecutorHooks } from '../../../task/contracts';

function makeFrame(over: Partial<ObservationFrame> = {}): ObservationFrame {
  return {
    frameId: 'frame-1',
    observedAt: 1_700_000_000_000,
    tab: { id: 9, url: 'https://example.test/form', title: 'Form' },
    pageRevision: 'rev-1',
    targetCount: 1,
    interactiveElements: [{ index: 1, text: 'Submit', backendNodeId: 42 }],
    text: 'Interactive elements\n[1] Submit',
    signals: [],
    ...over,
  };
}

async function shadowSpans(taskId: string): Promise<TraceSpan[]> {
  const trace = await traceStore.getTrace(taskId);
  return trace?.spans.filter(span => span.kind === 'shadow') ?? [];
}

function hooksMock(): ExecutorHooks {
  return {
    onPlan: vi.fn(async () => undefined),
    dispatchAction: vi.fn(async () => {
      throw new Error('dispatchAction must not run in injected-browser tests');
    }),
  };
}

/** Minimal GeneralSettingsConfig for the mocked store. */
const settings = (runtimeMode?: string): GeneralSettingsConfig =>
  ({ maxSteps: 8, ...(runtimeMode ? { runtimeMode } : {}) }) as GeneralSettingsConfig;

describe('createShadowRecorder (C6)', () => {
  it('records a matching shadow span for an index action resolved on the decision frame', async () => {
    const recorder = createShadowRecorder({ runtimeMode: 'v2-shadow', taskId: 'shadow-match', roundId: () => 'r1' });
    expect(recorder).not.toBeNull();
    await recorder!.record({ name: 'click_element', args: { index: 1 }, error: null, frame: makeFrame() });

    const spans = await shadowSpans('shadow-match');
    expect(spans).toHaveLength(1);
    expect(spans[0].kind).toBe('shadow');
    expect(spans[0].name).toBe('shadow.match');
    expect(spans[0].taskId).toBe('shadow-match');
    expect(spans[0].roundId).toBe('r1');
    const axes = JSON.parse(spans[0].detail!);
    expect(Array.isArray(axes)).toBe(true);
    expect(axes).toEqual([]);
    expect(spans[0].data).toEqual({ version: 1, divergence_axes: 0 });
  });

  it('records a match for a targetless action without a frame', async () => {
    const recorder = createShadowRecorder({ runtimeMode: 'v2-shadow', taskId: 'shadow-nav', roundId: () => 'r1' });
    await recorder!.record({ name: 'go_to_url', args: { url: 'https://example.test/' }, error: null, frame: null });

    const spans = await shadowSpans('shadow-nav');
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('shadow.match');
  });

  it('reports an error-axis divergence when the legacy action failed', async () => {
    const recorder = createShadowRecorder({ runtimeMode: 'v2-shadow', taskId: 'shadow-err', roundId: () => 'r1' });
    await recorder!.record({
      name: 'click_element',
      args: { index: 1 },
      error: 'action_target_stale',
      frame: makeFrame(),
    });

    const spans = await shadowSpans('shadow-err');
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('shadow.divergence');
    const axes = JSON.parse(spans[0].detail!) as Array<{ axis: string; legacy: string; v2: string }>;
    expect(axes.map(axis => axis.axis)).toEqual(['error']);
    expect(axes[0].v2).toBe('ok');
    expect(spans[0].data).toEqual({ version: 1, divergence_axes: 1 });
  });

  it('keeps the query-planned legacy side as unresolved and lets the resolver pin the v2 identity', async () => {
    const recorder = createShadowRecorder({ runtimeMode: 'v2-shadow', taskId: 'shadow-query', roundId: () => 'r1' });
    await recorder!.record({ name: 'click_element', args: { query: 'submit' }, error: null, frame: makeFrame() });

    const spans = await shadowSpans('shadow-query');
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe('shadow.divergence');
    const axes = JSON.parse(spans[0].detail!) as Array<{ axis: string }>;
    expect(axes.map(axis => axis.axis)).toContain('target');
  });

  it('records nothing for legacy actions with no protocol mapping', async () => {
    const recorder = createShadowRecorder({ runtimeMode: 'v2-shadow', taskId: 'shadow-unmapped', roundId: () => 'r1' });
    await recorder!.record({ name: 'scroll_to_text', args: { text: 'footer' }, error: null, frame: makeFrame() });
    expect(await shadowSpans('shadow-unmapped')).toHaveLength(0);
  });

  it('is default-off: legacy, garbage, and missing modes return null', () => {
    expect(createShadowRecorder({ runtimeMode: 'legacy', taskId: 'x', roundId: () => 'r' })).toBeNull();
    expect(createShadowRecorder({ runtimeMode: 'v2-active', taskId: 'x', roundId: () => 'r' })).toBeNull();
    expect(createShadowRecorder({ runtimeMode: 'garbage', taskId: 'x', roundId: () => 'r' })).toBeNull();
    expect(createShadowRecorder({ runtimeMode: undefined, taskId: 'x', roundId: () => 'r' })).toBeNull();
  });

  it('never throws when persistence fails — the record is swallowed and logged', async () => {
    const recorder = createShadowRecorder({ runtimeMode: 'v2-shadow', taskId: 'shadow-boom', roundId: () => 'r1' });
    const spy = vi.spyOn(traceStore, 'appendSpan').mockRejectedValueOnce(new Error('storage boom'));
    await expect(
      recorder!.record({ name: 'go_to_url', args: { url: 'https://example.test/' }, error: null, frame: null }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('tool-loop control driver shadow wiring (C6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('emits one shadow span per dispatched action when runtimeMode is v2-shadow', async () => {
    vi.mocked(generalSettingsStore.getSettings).mockResolvedValue(settings('v2-shadow'));
    const act = vi.fn(async (name: string) => ({ summary: name }));
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCallGenerateResult('go_to_url', { url: 'https://example.test/form' }),
        toolCallGenerateResult('click_element', { index: 1 }),
        toolCallGenerateResult('done', { text: 'Submitted.', success: true }),
      ],
    });
    const driver = await createToolLoopControlDriver(
      { taskId: 'wired-shadow', roundId: 'r-wired', instruction: 'open the form and submit', tabId: 9 },
      hooksMock(),
      {} as never,
      { model, runBrowser: { observe: async () => ({ text: 'Form' }), act }, maxSteps: 8 },
    );

    await expect(driver.run('r-wired')).resolves.toEqual({ kind: 'candidate_complete', summary: 'Submitted.' });
    const spans = await shadowSpans('wired-shadow');
    expect(spans).toHaveLength(2); // go_to_url + click_element; done dispatches no browser action
    expect(spans.map(span => span.kind)).toEqual(['shadow', 'shadow']);
    expect(spans.map(span => span.name).sort()).toEqual(['shadow.divergence', 'shadow.match']);
    for (const span of spans) {
      const axes = JSON.parse(span.detail!);
      expect(Array.isArray(axes)).toBe(true);
      expect(span.roundId).toBe('r-wired');
    }
  });

  it('emits zero shadow spans and identical results in legacy mode', async () => {
    vi.mocked(generalSettingsStore.getSettings).mockResolvedValue(settings());
    const act = vi.fn(async (name: string) => ({ summary: name }));
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCallGenerateResult('go_to_url', { url: 'https://example.test/form' }),
        toolCallGenerateResult('done', { text: 'Submitted.', success: true }),
      ],
    });
    const driver = await createToolLoopControlDriver(
      { taskId: 'wired-legacy', roundId: 'r-legacy', instruction: 'open the form and submit', tabId: 9 },
      hooksMock(),
      {} as never,
      { model, runBrowser: { observe: async () => ({ text: 'Form' }), act }, maxSteps: 8 },
    );

    await expect(driver.run('r-legacy')).resolves.toEqual({ kind: 'candidate_complete', summary: 'Submitted.' });
    expect(act).toHaveBeenCalledTimes(1);
    expect(await traceStore.getTrace('wired-legacy')).toBeNull();
    expect(await shadowSpans('wired-legacy')).toHaveLength(0);
  });

  it('keeps the legacy outcome intact when the shadow side fails', async () => {
    vi.mocked(generalSettingsStore.getSettings).mockResolvedValue(settings('v2-shadow'));
    const spy = vi.spyOn(traceStore, 'appendSpan').mockRejectedValue(new Error('storage boom'));
    const act = vi.fn(async (name: string) => ({ summary: name }));
    const model = new MockLanguageModelV4({
      doGenerate: [
        toolCallGenerateResult('go_to_url', { url: 'https://example.test/form' }),
        toolCallGenerateResult('done', { text: 'Submitted.', success: true }),
      ],
    });
    const driver = await createToolLoopControlDriver(
      { taskId: 'wired-boom', roundId: 'r-boom', instruction: 'open the form and submit', tabId: 9 },
      hooksMock(),
      {} as never,
      { model, runBrowser: { observe: async () => ({ text: 'Form' }), act }, maxSteps: 8 },
    );

    await expect(driver.run('r-boom')).resolves.toEqual({ kind: 'candidate_complete', summary: 'Submitted.' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
