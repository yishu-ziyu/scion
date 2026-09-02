/**
 * C6 — Shadow Mode comparator acceptance tests.
 * Everything runs on plain data; no Chrome, no executor call.
 */
import { describe, expect, it } from 'vitest';
import {
  BROWSER_PROTOCOL_VERSION_STRING,
  parseTraceRecord,
  type ActionReceipt,
  type BrowserAction,
  type ElementTarget,
} from '@chijie/browser-protocol';
import {
  compareShadowSides,
  legacySideOf,
  shadowOnce,
  shadowReportToTraceRecord,
  shadowTargetOf,
  ShadowComparator,
  v2SideOf,
  type LegacyPlanLike,
} from './shadow';
import type { TargetResolution } from './target-resolver';
import { FakeActionExecutor } from './fakes';

function elementTarget(over: Partial<ElementTarget> = {}): ElementTarget {
  return { kind: 'element', identity: { backendNodeId: 42 }, pageRevision: 'rev-1', ...over };
}

function clickAction(target: ElementTarget, actionId = 'a-1'): BrowserAction {
  return {
    protocolVersion: BROWSER_PROTOCOL_VERSION_STRING,
    actionId,
    requestedAt: 1_700_000_000_000,
    effect: 'reversible_write',
    kind: 'click',
    target,
    input: {},
  };
}

function appliedReceipt(actionId = 'a-1'): ActionReceipt {
  return { actionId, status: 'applied', beforeRevision: 'rev-1', afterRevision: 'rev-1', evidence: [] };
}

function legacyClick(over: Partial<LegacyPlanLike> = {}): LegacyPlanLike {
  return { name: 'click_element', args: { index: 3 }, element: { index: 3, backendNodeId: 42 }, ...over };
}

const reportOptions = { taskId: 'task-1', roundId: 'round-1', at: 1_700_000_000_000 };

function v2Plan(target: ElementTarget = elementTarget()) {
  return {
    action: clickAction(target),
    resolution: { kind: 'resolved', target } as TargetResolution,
    receipt: appliedReceipt(),
  };
}

describe('ShadowComparator (C6)', () => {
  it('identical plans on all three axes → match', () => {
    const comparator = new ShadowComparator();
    const result = comparator.compare({ legacy: legacySideOf(legacyClick()), v2: v2SideOf(v2Plan()) });
    expect(result).toEqual({ kind: 'match', axes: [] });
  });

  it('compares target, actionKind and error axes', () => {
    const comparator = new ShadowComparator();
    // different element identity
    expect(
      comparator.compare({
        legacy: legacySideOf(legacyClick({ element: { backendNodeId: 99 } })),
        v2: v2SideOf(v2Plan()),
      }),
    ).toEqual({ kind: 'divergence', axes: ['target'] });
    // different action vocabulary (legacy scroll has no protocol mapping);
    // same identity and same error, so only the kind axis diverges.
    expect(
      comparator.compare({
        legacy: legacySideOf({ name: 'scroll_to_bottom', element: { backendNodeId: 42 } }),
        v2: v2SideOf(v2Plan()),
      }),
    ).toEqual({ kind: 'divergence', axes: ['actionKind'] });
    // different error classification
    expect(
      comparator.compare({
        legacy: legacySideOf(legacyClick({ error: 'action_target_stale' })),
        v2: v2SideOf({
          ...v2Plan(),
          receipt: {
            ...appliedReceipt(),
            status: 'unknown',
            error: { code: 'DEBUGGER_DETACHED', message: 'detached', retryable: true, origin: 'runtime' },
          },
        }),
      }),
    ).toEqual({ kind: 'divergence', axes: ['error'] });
  });

  it('element identity: backendNodeId wins, cssPath is fallback, no shared id diverges', () => {
    const byNode = shadowTargetOf(elementTarget({ identity: { backendNodeId: 7 } }));
    const byCss = shadowTargetOf(elementTarget({ identity: { cssPath: 'div > button' } }));
    const click = { actionKind: 'click' as const, error: null };
    expect(compareShadowSides({ target: byNode, ...click }, { target: byNode, ...click }).kind).toBe('match');
    // cssPath-only vs backendNodeId-only share no comparable id → divergence
    expect(compareShadowSides({ target: byCss, ...click }, { target: byNode, ...click })).toEqual({
      kind: 'divergence',
      axes: ['target'],
    });
  });

  it('unresolved v2 target vs resolved legacy target diverges on target axis', () => {
    const legacy = legacySideOf(legacyClick());
    const v2 = v2SideOf({
      action: clickAction(elementTarget()),
      resolution: { kind: 'ambiguous', candidates: [elementTarget()] },
      receipt: appliedReceipt(),
    });
    expect(legacy.target.kind).toBe('element');
    expect(v2.target).toEqual({ kind: 'unresolved', reason: 'ambiguous' });
    expect(compareShadowSides(legacy, v2)).toEqual({ kind: 'divergence', axes: ['target'] });
  });

  it('shadow comparison never calls an executor (pure, no side effects)', async () => {
    const executor = new FakeActionExecutor();
    const action = clickAction(elementTarget());
    // The v2 plan is *planned* data only; shadowOnce compares outcomes, it
    // does not execute them. The executor stays untouched.
    const report = shadowOnce(legacyClick(), { action, receipt: appliedReceipt() }, reportOptions);
    expect(report.outcome).toBe('match');
    expect(executor.executed).toHaveLength(0);
  });

  it('shadowOnce records a match report', () => {
    const report = shadowOnce(legacyClick(), v2Plan(), { ...reportOptions, gitSha: 'deadbeef' });
    expect(report).toEqual({
      version: 1,
      kind: 'shadow',
      outcome: 'match',
      taskId: 'task-1',
      roundId: 'round-1',
      gitSha: 'deadbeef',
      at: 1_700_000_000_000,
      axes: [],
    });
  });

  it('shadowOnce records divergences with axis + both-side summaries', () => {
    const report = shadowOnce(
      legacyClick({ element: { backendNodeId: 42 } }),
      {
        action: clickAction(elementTarget({ identity: { backendNodeId: 77 } })),
        resolution: { kind: 'resolved', target: elementTarget({ identity: { backendNodeId: 77 } }) },
        receipt: {
          ...appliedReceipt(),
          status: 'blocked',
          error: { code: 'TARGET_STALE', message: 'gone', retryable: true, origin: 'runtime' },
        },
      },
      reportOptions,
    );
    expect(report.outcome).toBe('divergence');
    expect(report.axes.map(a => a.axis)).toEqual(['target', 'error']);
    expect(report.axes[0]).toEqual({ axis: 'target', legacy: 'element(node=42)', v2: 'element(node=77)' });
    expect(report.axes[1]).toEqual({ axis: 'error', legacy: 'ok', v2: 'TARGET_STALE' });
  });

  it('report JSON never carries raw input_text form values', () => {
    const secret = 'MyS3cretFormValue!!';
    const report = shadowOnce(
      { name: 'input_text', args: { index: 3, text: secret }, element: { backendNodeId: 42 } },
      {
        action: {
          ...clickAction(elementTarget()),
          kind: 'input_text',
          input: { text: secret },
        } as BrowserAction,
        resolution: { kind: 'resolved', target: elementTarget() },
        receipt: appliedReceipt(),
      },
      reportOptions,
    );
    expect(report.outcome).toBe('match');
    expect(JSON.stringify(report)).not.toContain(secret);
  });

  it('divergence detail strings are redacted even if a side smuggles a secret', () => {
    const secret = 'hunter2secretvalue';
    // A cssPath carrying a password-style selector must be scrubbed before
    // it rides into the report.
    const report = shadowOnce(
      { name: 'click_element', element: { cssPath: `input[name="password=${secret}"]` } },
      { action: clickAction(elementTarget()), receipt: appliedReceipt() },
      reportOptions,
    );
    expect(report.outcome).toBe('divergence');
    const json = JSON.stringify(report);
    expect(json).not.toContain(secret);
    expect(json).toContain('[REDACTED]');
  });

  it('maps a shadow report onto the H1 TraceRecord envelope (task_event)', () => {
    const report = shadowOnce(legacyClick(), v2Plan(), reportOptions);
    const record = shadowReportToTraceRecord(report, { seq: 1, recordedAt: report.at });
    const parsed = parseTraceRecord(record);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.record.type).toBe('task_event');
    if (parsed.record.type === 'task_event') {
      expect(parsed.record.event).toBe('shadow.match');
      expect(parsed.record.taskId).toBe('task-1');
      expect(parsed.record.roundId).toBe('round-1');
    }
  });
});
