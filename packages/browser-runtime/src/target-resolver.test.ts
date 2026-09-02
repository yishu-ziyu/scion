/**
 * C4 — unified TargetResolver acceptance tests.
 * Every scenario runs against fakes only; nothing touches Chrome.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROTOCOL_VERSION_STRING,
  validateReceipt,
  type BrowserAction,
  type BrowserObservation,
  type ElementTarget,
  type FrameTarget,
} from '@chijie/browser-protocol';
import { executeWithTargetResolution, resolveTarget, targetFailureReceipt } from './target-resolver';
import { buildFakeObservation, FakeActionExecutor, FakeClock, FakePageSnapshot, FakeTrace } from './fakes';

function element(over: Partial<ElementTarget> & { backendNodeId?: number } = {}): ElementTarget {
  const { backendNodeId, ...rest } = over;
  return {
    kind: 'element',
    identity: { backendNodeId: backendNodeId ?? 42 },
    pageRevision: 'rev-1',
    ...rest,
  };
}

function observationWith(elements: ElementTarget[], overrides: Partial<BrowserObservation> = {}): BrowserObservation {
  return buildFakeObservation({ interactiveElements: elements, ...overrides });
}

function clickAction(target: ElementTarget, effect: BrowserAction['effect'] = 'external_commit'): BrowserAction {
  return {
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    actionId: 'a-1',
    requestedAt: 1_700_000_000_000,
    effect,
    kind: 'click',
    target,
    input: {},
  };
}

describe('resolveTarget (C4)', () => {
  it('resolves a same-revision element by backendNodeId', async () => {
    const observation = observationWith([element({ backendNodeId: 7, index: 3 })]);
    const result = await resolveTarget(observation, element({ backendNodeId: 7 }));
    expect(result).toEqual({ kind: 'resolved', target: element({ backendNodeId: 7, index: 3 }) });
  });

  it('old target after a DOM update (node gone in newer revision) → stale', async () => {
    const observation = observationWith([element({ backendNodeId: 99 })], { pageRevision: 'rev-2' });
    const result = await resolveTarget(observation, element({ backendNodeId: 42, pageRevision: 'rev-1' }));
    expect(result.kind).toBe('stale');
  });

  it('same backend node with only the index changed → resolved re-binding', async () => {
    const observation = observationWith([element({ backendNodeId: 42, index: 8 })], { pageRevision: 'rev-2' });
    const result = await resolveTarget(observation, element({ backendNodeId: 42, index: 2, pageRevision: 'rev-1' }));
    expect(result).toEqual({
      kind: 'resolved',
      target: element({ backendNodeId: 42, index: 8, pageRevision: 'rev-2' }),
    });
  });

  it('re-binding emits a target.rebound trace event', async () => {
    const trace = new FakeTrace();
    const clock = new FakeClock(123);
    const observation = observationWith([element({ backendNodeId: 42, index: 8 })], { pageRevision: 'rev-2' });
    await resolveTarget(observation, element({ backendNodeId: 42, pageRevision: 'rev-1' }), { trace, clock });
    expect(trace.events).toEqual([
      { kind: 'target.rebound', fromRevision: 'rev-1', toRevision: 'rev-2', backendNodeId: 42, at: 123 },
    ]);
  });

  it('two same-name buttons via query → ambiguous, first is NOT auto-picked', async () => {
    const observation = observationWith([
      element({ backendNodeId: 1, index: 0, text: '提交' }),
      element({ backendNodeId: 2, index: 1, text: '提交' }),
    ]);
    const result = await resolveTarget(observation, { kind: 'query', query: '提交' });
    expect(result.kind).toBe('ambiguous');
    if (result.kind !== 'ambiguous') return;
    expect(result.candidates.map(c => c.identity.backendNodeId)).toEqual([1, 2]);
  });

  it('unique query → resolved', async () => {
    const observation = observationWith([
      element({ backendNodeId: 1, index: 0, text: '取消' }),
      element({ backendNodeId: 2, index: 1, text: '提交订单' }),
    ]);
    const result = await resolveTarget(observation, { kind: 'query', query: '提交订单' });
    expect(result.kind).toBe('resolved');
  });

  it('query with no match → missing', async () => {
    const observation = observationWith([element({ backendNodeId: 1, text: '取消' })]);
    const result = await resolveTarget(observation, { kind: 'query', query: '不存在' });
    expect(result.kind).toBe('missing');
  });

  it('unmounted iframe (same revision) → missing, structured not thrown', async () => {
    const observation = observationWith([], {
      inaccessibleFrames: [{ frameId: 'frame-1', reason: 'frame detached' }],
    });
    const ref = element({ backendNodeId: 42, identity: { backendNodeId: 42, frameId: 'frame-1' } });
    const result = await resolveTarget(observation, ref);
    expect(result.kind).toBe('missing');
  });

  it('unmounted iframe (newer revision) → stale (re-observe required)', async () => {
    const observation = observationWith([], {
      pageRevision: 'rev-2',
      inaccessibleFrames: [{ frameId: 'frame-1', reason: 'frame detached' }],
    });
    const ref = element({
      backendNodeId: 42,
      pageRevision: 'rev-1',
      identity: { backendNodeId: 42, frameId: 'frame-1' },
    });
    const result = await resolveTarget(observation, ref);
    expect(result.kind).toBe('stale');
  });

  it('frame target whose frame became inaccessible → missing/stale', async () => {
    const observation = buildFakeObservation({
      inaccessibleFrames: [{ frameId: 'frame-1', reason: 'cross-origin' }],
    });
    const ref: FrameTarget = { kind: 'frame', frameId: 'frame-1', tabId: 1, pageRevision: 'rev-1' };
    expect((await resolveTarget(observation, ref)).kind).toBe('missing');
  });

  it('cssPath fallback identity re-binds across revisions', async () => {
    const observation = observationWith(
      [{ kind: 'element', identity: { cssPath: 'body>button' }, pageRevision: 'rev-2', index: 5 }],
      { pageRevision: 'rev-2' },
    );
    const ref: ElementTarget = { kind: 'element', identity: { cssPath: 'body>button' }, pageRevision: 'rev-1' };
    const result = await resolveTarget(observation, ref);
    expect(result).toEqual({
      kind: 'resolved',
      target: { kind: 'element', identity: { cssPath: 'body>button' }, pageRevision: 'rev-2', index: 5 },
    });
  });
});

describe('executeWithTargetResolution never consumes external_commit (C4)', () => {
  async function run(observation: BrowserObservation, target: ElementTarget) {
    const snapshot = new FakePageSnapshot(new FakeClock(), observation);
    const executor = new FakeActionExecutor('applied');
    const outcome = await executeWithTargetResolution({ snapshot, executor }, clickAction(target, 'external_commit'));
    return { executor, outcome };
  }

  it('stale target → blocked receipt, executor not called', async () => {
    const observation = observationWith([], { pageRevision: 'rev-2' });
    const { executor, outcome } = await run(observation, element({ pageRevision: 'rev-1' }));
    expect(outcome.resolution?.kind).toBe('stale');
    expect(outcome.receipt.status).toBe('blocked');
    expect(outcome.receipt.error?.code).toBe('TARGET_STALE');
    expect(executor.executed).toHaveLength(0);
  });

  it('ambiguous target → blocked receipt, executor not called', async () => {
    // A cssPath that matches two elements in the digest is the realistic
    // ambiguity; identity matching must NOT pick the first one.
    const dup = (index: number): ElementTarget => ({
      kind: 'element',
      identity: { cssPath: 'body>button' },
      pageRevision: 'rev-1',
      index,
    });
    const observation = observationWith([dup(0), dup(1)]);
    const ref: ElementTarget = { kind: 'element', identity: { cssPath: 'body>button' }, pageRevision: 'rev-1' };
    const snapshot = new FakePageSnapshot(new FakeClock(), observation);
    const executor = new FakeActionExecutor('applied');
    const outcome = await executeWithTargetResolution({ snapshot, executor }, clickAction(ref, 'external_commit'));
    expect(outcome.resolution?.kind).toBe('ambiguous');
    expect(outcome.receipt.status).toBe('blocked');
    expect(outcome.receipt.error?.code).toBe('TARGET_AMBIGUOUS');
    expect(executor.executed).toHaveLength(0);
  });

  it('missing target → blocked receipt, executor not called', async () => {
    const observation = observationWith([element({ backendNodeId: 7 })]);
    const { executor, outcome } = await run(observation, element({ backendNodeId: 42 }));
    expect(outcome.resolution?.kind).toBe('missing');
    expect(outcome.receipt.error?.code).toBe('TARGET_NOT_FOUND');
    expect(executor.executed).toHaveLength(0);
  });

  it('resolved target → executor runs with the re-bound target', async () => {
    const observation = observationWith([element({ backendNodeId: 42, index: 8 })], { pageRevision: 'rev-2' });
    const { executor, outcome } = await run(observation, element({ backendNodeId: 42, pageRevision: 'rev-1' }));
    expect(outcome.receipt.status).toBe('applied');
    expect(executor.executed).toHaveLength(1);
    expect(executor.executed[0]?.target).toEqual(element({ backendNodeId: 42, index: 8, pageRevision: 'rev-2' }));
  });
});

describe('targetFailureReceipt (C4)', () => {
  it('produces validateReceipt-passing blocked receipts per failure kind', () => {
    const action = clickAction(element());
    const cases = [
      { resolution: { kind: 'stale' } as const, code: 'TARGET_STALE' },
      { resolution: { kind: 'missing' } as const, code: 'TARGET_NOT_FOUND' },
      {
        resolution: {
          kind: 'ambiguous' as const,
          candidates: [element({ backendNodeId: 1 }), element({ backendNodeId: 2 })],
        },
        code: 'TARGET_AMBIGUOUS',
      },
    ];
    for (const { resolution, code } of cases) {
      const receipt = targetFailureReceipt(action, resolution, 'rev-1');
      expect(receipt.status).toBe('blocked');
      expect(receipt.error?.code).toBe(code);
      expect(() => validateReceipt(receipt)).not.toThrow();
    }
  });
});
