import { honestFailureStatus } from './eval-verification.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Dump raw per-task traces (eval-traces-v1) to dir so post-mortem tools
 * (e.g. scripts/shadow-report-check.mjs) can audit runs whose scenarios
 * failed before the per-scenario scoped trace was written. Storage dies with
 * the temp browser profile, so this must run while the panel is still open.
 */
export async function dumpRawTraces(panel, dir) {
  if (!dir || !panel) return 0;
  try {
    const raw = await panel.evaluate(async () => {
      const stored = await chrome.storage.local.get(['eval-traces-v1']);
      return stored['eval-traces-v1'] || {};
    });
    mkdirSync(dir, { recursive: true });
    for (const [taskId, trace] of Object.entries(raw)) {
      writeFileSync(join(dir, `${taskId}-trace.json`), JSON.stringify(trace, null, 2) + '\n');
    }
    console.log(`[e2e] raw traces dumped to ${dir} (${Object.keys(raw).length})`);
    return Object.keys(raw).length;
  } catch (error) {
    console.error('[e2e] raw trace dump failed', error);
    return 0;
  }
}

function timestamp(value) {
  const parsed = typeof value === 'number' ? value : Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function isObservedOrActionSpan(span) {
  return ['observe', 'act', 'reobserve'].includes(span?.kind) || /(?:^|\.)observe|(?:^|\.)act/.test(span?.name || '');
}

function nearestSample(samples, startedAt, runtimeTaskId) {
  const time = timestamp(startedAt);
  if (time === null) return null;
  return (
    samples
      .filter(sample => sample?.task_id === runtimeTaskId && timestamp(sample.captured_at) !== null)
      .map(sample => ({ sample, delta: Math.abs(timestamp(sample.captured_at) - time) }))
      .sort((left, right) => left.delta - right.delta)[0] ?? null
  );
}

export function buildScopedTraceEvidence({
  rawTraces,
  evalTaskId,
  attempt,
  campaignStamp,
  armHash,
  runId,
  runtimeTaskId,
  runtimeRoundId,
  boundTabId,
  terminalStatus,
  scopedCardCount,
  uiTaskId,
  uiRoundId,
  visibleReceiptId,
  hasRuntimeReceipt,
  runtimeReceiptId,
  receiptCount,
  completionResultCount,
  deliverableCount,
  deliverableRequired,
  outcome,
  tabSamples,
}) {
  const resolvedOutcome = outcome || 'verified_pass';
  const resolvedCompletionResultCount = completionResultCount ?? receiptCount;
  const resolvedDeliverableRequired = deliverableRequired ?? true;
  const trace = rawTraces?.[runtimeTaskId];
  if (!runtimeTaskId || !trace || trace.taskId !== runtimeTaskId) {
    throw new Error('trace identity missing or ambiguous');
  }
  const samples = Array.isArray(tabSamples) ? tabSamples : [];
  const isShadowSpan = span => /^shadow\./.test(span?.name || '');
  const spans = (trace.spans || []).map(span => {
    const nearest = isObservedOrActionSpan(span) ? nearestSample(samples, span.startedAt, runtimeTaskId) : null;
    const targetIds = nearest?.sample?.target_tab_ids || [];
    const tabId = targetIds.length === 1 ? targetIds[0] : nearest?.sample?.task_tab_id;
    return {
      id: span.id,
      task_id: span.taskId,
      kind: span.kind,
      name: span.name,
      started_at: span.startedAt,
      ended_at: span.endedAt ?? null,
      status: span.status ?? null,
      tab_id: isObservedOrActionSpan(span) ? (Number.isInteger(tabId) ? tabId : null) : null,
      tab_sample_delta_ms: nearest?.delta ?? null,
      // C6: shadow records carry the redacted axes breakdown through to the dump.
      ...(isShadowSpan(span) ? { detail: span.detail ?? null, data: span.data ?? null } : {}),
    };
  });
  return {
    schema_version: 'chijie-eval-trace-v3',
    eval_task_id: evalTaskId,
    attempt,
    campaign_stamp: campaignStamp,
    arm_hash: armHash,
    run_id: runId,
    runtime_task_id: runtimeTaskId,
    runtime_round_id: runtimeRoundId,
    trace_task_id: trace.taskId,
    bound_tab_id: boundTabId,
    terminal_status: terminalStatus,
    outcome: resolvedOutcome,
    scoped_card_count: scopedCardCount,
    ui_task_id: uiTaskId,
    ui_round_id: uiRoundId,
    visible_receipt_id: visibleReceiptId || '',
    has_runtime_receipt: hasRuntimeReceipt === true,
    runtime_receipt_id: runtimeReceiptId || '',
    receipt_count: receiptCount,
    completion_result_count: resolvedCompletionResultCount,
    deliverable_count: deliverableCount,
    deliverable_required: resolvedDeliverableRequired,
    trace_terminal_status: trace.terminalStatus ?? null,
    spans,
    // C6: top-level shadow records so the stability checker can audit
    // match/divergence coverage without re-parsing span shapes.
    shadow_events: (trace.spans || [])
      .filter(isShadowSpan)
      .map(span => ({
        name: span.name,
        at: span.startedAt,
        task_id: span.taskId,
        round_id: span.roundId ?? null,
        detail: span.detail ?? null,
        data: span.data ?? null,
      })),
    tab_events: samples
      .filter(sample => sample?.task_id === runtimeTaskId)
      .map(sample => ({
        captured_at: sample.captured_at,
        task_id: sample.task_id,
        active_tab_id: sample.active_tab_id ?? null,
        task_tab_id: sample.task_tab_id ?? null,
        target_tab_ids: sample.target_tab_ids || [],
      })),
  };
}

export function validateScopedTraceEvidence(
  trace,
  { evalTaskId, attempt, runtimeTaskId, allowedTabIds, campaignStamp, armHash, runId, outcome, deliverableRequired },
) {
  const errors = [];
  const allowed = new Set((allowedTabIds || []).filter(Number.isInteger));
  if (trace?.schema_version !== 'chijie-eval-trace-v3') errors.push('invalid trace schema');
  if (trace?.eval_task_id !== evalTaskId) errors.push('trace eval_task_id mismatch');
  if (Number(trace?.attempt) !== Number(attempt)) errors.push('trace attempt mismatch');
  if (campaignStamp && trace?.campaign_stamp !== campaignStamp) errors.push('trace campaign_stamp mismatch');
  if (armHash && trace?.arm_hash !== armHash) errors.push('trace arm_hash mismatch');
  if (runId && trace?.run_id !== runId) errors.push('trace run_id mismatch');
  if (!runtimeTaskId || trace?.runtime_task_id !== runtimeTaskId || trace?.trace_task_id !== runtimeTaskId) {
    errors.push('trace runtime identity mismatch');
  }
  if (
    !trace?.runtime_round_id ||
    trace?.scoped_card_count !== 1 ||
    trace?.ui_task_id !== runtimeTaskId ||
    trace?.ui_round_id !== trace.runtime_round_id
  ) {
    errors.push('trace UI task/round ownership mismatch');
  }
  if (trace?.outcome !== outcome) errors.push('trace outcome mismatch');
  if (trace?.deliverable_required !== deliverableRequired) errors.push('trace deliverable requirement mismatch');
  const terminalStatusMatches =
    trace?.trace_terminal_status === trace?.terminal_status ||
    (outcome !== 'verified_pass' &&
      honestFailureStatus(trace?.terminal_status) &&
      trace?.trace_terminal_status == null);
  if (
    (!['completed', 'failed', 'cancelled'].includes(trace?.terminal_status) &&
      !honestFailureStatus(trace?.terminal_status)) ||
    !terminalStatusMatches
  ) {
    errors.push('trace terminal status mismatch');
  }
  if (outcome === 'verified_pass') {
    if (
      trace?.terminal_status !== 'completed' ||
      trace?.has_runtime_receipt !== true ||
      !trace?.runtime_receipt_id ||
      trace?.visible_receipt_id !== trace.runtime_receipt_id ||
      trace?.receipt_count !== 1 ||
      trace?.completion_result_count !== 1 ||
      !Number.isInteger(trace?.deliverable_count) ||
      trace.deliverable_count < (deliverableRequired ? 1 : 0) ||
      trace.deliverable_count > 1
    ) {
      errors.push('trace completion cardinality invalid');
    }
  } else {
    if (trace?.has_runtime_receipt !== false || trace?.runtime_receipt_id || trace?.visible_receipt_id) {
      errors.push('trace honest failure retains receipt');
    }
    if (trace?.receipt_count !== 0 || trace?.completion_result_count !== 0 || trace?.deliverable_count !== 0) {
      errors.push('trace honest failure exposes completion nodes');
    }
  }
  if (!Number.isInteger(trace?.bound_tab_id) || !allowed.has(trace.bound_tab_id)) {
    errors.push('trace bound tab invalid');
  }
  if (!Array.isArray(trace?.spans) || trace.spans.length === 0) {
    errors.push('trace is empty');
    return errors;
  }
  const observedOrActions = trace.spans.filter(isObservedOrActionSpan);
  if (outcome === 'verified_pass' && observedOrActions.length === 0) errors.push('trace has no observe/action spans');
  const observeSpans = trace.spans.filter(
    span => ['observe', 'reobserve'].includes(span?.kind) || /(?:^|\.)observe/.test(span?.name || ''),
  );
  const actSpans = trace.spans.filter(span => span?.kind === 'act' || /(?:^|\.)act/.test(span?.name || ''));
  if (
    outcome === 'verified_pass' &&
    ['013-A03', '013-B01', '013-B04', '013-B05', '013-B06', '013-B07', '018-O1', '013-C01'].includes(evalTaskId) &&
    actSpans.length < 1
  ) {
    errors.push('task trace lacks required action span');
  }
  if (outcome === 'verified_pass' && evalTaskId === '021-LH-04' && (observeSpans.length < 2 || actSpans.length < 2)) {
    errors.push('LH04 trace lacks multi-source observe/action sequence');
  }
  const ids = trace.spans.map(span => String(span?.id || ''));
  if (ids.some(id => !id) || new Set(ids).size !== ids.length) errors.push('trace span ids missing or duplicated');
  for (const span of trace.spans) {
    if (span?.task_id !== runtimeTaskId) errors.push('cross-task trace span');
  }
  for (const span of observedOrActions) {
    if (!Number.isInteger(span.tab_id) || !allowed.has(span.tab_id)) errors.push(`trace span wrong tab ${span.name}`);
    if (!Number.isFinite(span.tab_sample_delta_ms) || span.tab_sample_delta_ms > 2000) {
      errors.push(`trace span lacks timely tab sample ${span.name}`);
    }
  }
  if (!Array.isArray(trace?.tab_events) || trace.tab_events.length === 0) errors.push('trace tab events empty');
  let previousEventAt = Number.NEGATIVE_INFINITY;
  for (const event of trace?.tab_events || []) {
    if (event.task_id !== runtimeTaskId) errors.push('cross-task tab event');
    const eventAt = timestamp(event.captured_at);
    if (eventAt === null || eventAt < previousEventAt) errors.push('trace tab events are not ordered');
    if (eventAt !== null) previousEventAt = eventAt;
    for (const id of [event.active_tab_id, event.task_tab_id, ...(event.target_tab_ids || [])]) {
      if (!Number.isInteger(id) || !allowed.has(id)) errors.push('trace tab event wrong tab');
    }
  }
  return [...new Set(errors)];
}
