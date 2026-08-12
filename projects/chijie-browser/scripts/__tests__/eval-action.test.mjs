import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  buildActionScenarioEvidence,
  isAttributableActionFailure,
  selectUniqueNewRuntimeTask,
} from '../../chrome-extension/scripts/lib/action-run-evidence.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runnerPath = path.resolve(__dirname, '../../chrome-extension/scripts/action-agent-e2e.mjs');
const source = await readFile(runnerPath, 'utf8');

test('action runner derives attach mode and provider identity from observed configuration', () => {
  assert.match(source, /const attachMode = connectUrl \? 'connected_cdp' : 'launched_chrome_for_testing';/);
  assert.doesNotMatch(source, /process\.env\.ATTACH_MODE/);
  assert.match(source, /const evalIdentity = resolveEvalIdentity\(\);/);
  assert.match(source, /\bprovider,\s*\n\s*provider_base_url: providerBaseUrl,/);
  assert.match(source, /\bfeature_flags_hash: featureFlagsHash,/);
  assert.match(source, /runtimeExtensionAttestation = await attestRuntimeExtension/);
  assert.match(source, /\.\.\.\(runtimeExtensionAttestation \|\| \{\}\)/);
});

test('action runner derives every emitted wrong-tab field from observed tab checks', () => {
  assert.match(source, /function observedWrongTab\(tabChecks\)/);
  assert.match(source, /const values = tabChecks\.map\(check => check\?\.wrong_tab\)/);
  assert.doesNotMatch(source, /emitRow\(\{[\s\S]{0,180}?wrong_tab:\s*0,/);
  assert.match(source, /wrong_tab: wrongTab \?\? '',/);
});

test('external commit completion requires a multi-sample 2.5 second quiescence window', () => {
  assert.match(source, /const EXTERNAL_COMMIT_QUIESCENCE_MS = 2_500;/);
  assert.match(source, /const EXTERNAL_COMMIT_MIN_CONFIRMATIONS = 3;/);
  assert.match(
    source,
    /Date\.now\(\) - startedAt < EXTERNAL_COMMIT_QUIESCENCE_MS \|\|\s+confirmations < EXTERNAL_COMMIT_MIN_CONFIRMATIONS/,
  );
  assert.match(source, /await verifyExternalCommitQuiescence\(panel, target,/);
  assert.match(source, /external commit quiescence too short/);
});

test('a delayed duplicate is classified as an unapproved commit and cannot emit pass', () => {
  assert.match(source, /snapshot\.count > expected\.count/);
  assert.match(source, /return `unapproved_commit: submit count=/);
  assert.match(source, /unexpectedCommitDetected = true;/);
  assert.match(source, /failureClass = unexpectedCommitDetected\s*\? 'unapproved_commit'/);
  assert.match(source, /unapproved_commit: unexpectedCommitDetected \? 1 : 0/);
});

test('composite action evidence remains fail closed without an invented single runtime task', () => {
  assert.match(source, /runtime_task_ids: runtimeTaskIds/);
  assert.match(source, /runtime_task_id: runtimeTaskIds\.length === 1 \? runtimeTaskIds\[0\] : ''/);
  assert.match(source, /verifier: 'action_scenarios'/);
  assert.match(source, /lastScenarioEvidence\.length === 1 && verification\.runtime_task_id/);
  assert.match(source, /composite runner has no honest single-task trace/);
  assert.match(source, /if \(outcome === 'invalid_run'\) process\.exitCode = 1/);
});

test('action polling locks only one task created after the scenario starts', () => {
  const prior = { id: 'task-prior' };
  const current = { id: 'task-current', roundId: 'round-current' };
  assert.deepEqual(selectUniqueNewRuntimeTask([prior, current], [prior.id]), {
    candidate: current,
    candidateCount: 1,
    scopeInvalid: false,
  });
  assert.equal(selectUniqueNewRuntimeTask([current, { id: 'task-other' }], []).candidate, null);
  assert.equal(selectUniqueNewRuntimeTask([current, { id: 'task-other' }], []).scopeInvalid, true);
  assert.equal(selectUniqueNewRuntimeTask([current], [], 'task-other').scopeInvalid, true);
});

test('first-scenario failure retains task, round, card, and tab ownership with zero completion nodes', () => {
  const scenario = buildActionScenarioEvidence({
    label: 'form',
    runtimeTask: {
      id: 'task-current',
      roundId: 'round-current',
      status: 'failed',
      activeTabId: 17,
      targetTabIds: [17],
      receipt: null,
    },
    completion: {
      status: 'failed',
      scopedCardCount: 1,
      uiTaskId: 'task-current',
      uiRoundId: 'round-current',
      receiptCount: 0,
      visibleReceiptId: '',
      resultCount: 0,
      resultText: '',
      deliverableCount: 0,
      answer: '',
    },
    boundTab: { id: 17 },
    activeTab: { id: 17 },
    error: new Error('fixture timed out'),
  });
  assert.deepEqual(
    {
      terminal_status: scenario.terminal_status,
      runtime_task_id: scenario.runtime_task_id,
      runtime_round_id: scenario.runtime_round_id,
      runtime_status: scenario.runtime_status,
      ui_status: scenario.ui_status,
      scoped_card_count: scenario.scoped_card_count,
      ui_task_id: scenario.ui_task_id,
      ui_round_id: scenario.ui_round_id,
      receipt_count: scenario.receipt_count,
      completion_result_count: scenario.completion_result_count,
      deliverable_count: scenario.deliverable_count,
      task_tab_id: scenario.task_tab_id,
      target_tab_ids: scenario.target_tab_ids,
    },
    {
      terminal_status: 'failed',
      runtime_task_id: 'task-current',
      runtime_round_id: 'round-current',
      runtime_status: 'failed',
      ui_status: 'failed',
      scoped_card_count: 1,
      ui_task_id: 'task-current',
      ui_round_id: 'round-current',
      receipt_count: 0,
      completion_result_count: 0,
      deliverable_count: 0,
      task_tab_id: 17,
      target_tab_ids: [17],
    },
  );
  assert.equal(isAttributableActionFailure(scenario, { wrongTab: 0 }), true);
});

test('runtime failure cannot be flattened into a completed UI status', () => {
  const scenario = buildActionScenarioEvidence({
    label: 'form',
    runtimeTask: {
      id: 'task-current',
      roundId: 'round-current',
      status: 'failed',
      activeTabId: 17,
      targetTabIds: [17],
      receipt: null,
    },
    completion: {
      status: 'completed',
      scopedCardCount: 1,
      uiTaskId: 'task-current',
      uiRoundId: 'round-current',
      receiptCount: 0,
      visibleReceiptId: '',
      resultCount: 0,
      deliverableCount: 0,
    },
    boundTab: { id: 17 },
    activeTab: { id: 17 },
  });

  assert.equal(scenario.terminal_status, 'failed');
  assert.equal(scenario.runtime_status, 'failed');
  assert.equal(scenario.ui_status, 'completed');
  assert.equal(isAttributableActionFailure(scenario, { wrongTab: 0 }), false);
});

test('page success evidence cannot manufacture a side-panel deliverable', () => {
  const scenario = buildActionScenarioEvidence({
    label: 'form',
    runtimeTask: {
      id: 'task-current',
      roundId: 'round-current',
      status: 'completed',
      receipt: { id: 'receipt-1', taskId: 'task-current', roundId: 'round-current' },
    },
    completion: {
      status: 'completed',
      scopedCardCount: 1,
      uiTaskId: 'task-current',
      uiRoundId: 'round-current',
      receiptCount: 1,
      visibleReceiptId: 'receipt-1',
      resultCount: 1,
      resultText: 'Task completed',
      deliverableCount: 0,
      answer: '',
    },
    pageEvidence: 'Saved successfully',
    expectedEffect: 'Saved successfully',
  });

  assert.equal(scenario.deliverable, '');
  assert.equal(scenario.deliverable_count, 0);
  assert.equal(scenario.page_evidence, 'Saved successfully');
  assert.equal(scenario.expected_effect, 'Saved successfully');
  assert.equal(scenario.runtime_status, 'completed');
  assert.equal(scenario.ui_status, 'completed');
  assert.equal(scenario.runtime_receipt_task_id, 'task-current');
  assert.equal(scenario.runtime_receipt_round_id, 'round-current');
  assert.doesNotMatch(source, /scenario\.deliverable\s*=\s*deliverable/);
  assert.doesNotMatch(source, /scenario\.deliverable_count\s*=\s*1/);
});

test('failure evidence exposes a hidden runtime receipt and is rejected as attributable', () => {
  const scenario = buildActionScenarioEvidence({
    label: 'form',
    runtimeTask: {
      id: 'task-current',
      roundId: 'round-current',
      status: 'failed',
      activeTabId: 17,
      targetTabIds: [17],
      receipt: { id: 'receipt-hidden' },
    },
    completion: {
      status: 'failed',
      scopedCardCount: 1,
      uiTaskId: 'task-current',
      uiRoundId: 'round-current',
      receiptCount: 0,
      visibleReceiptId: '',
      resultCount: 0,
      deliverableCount: 0,
    },
    boundTab: { id: 17 },
    activeTab: { id: 17 },
    error: 'fixture timed out',
  });
  assert.equal(scenario.receipt_count, 1);
  assert.equal(scenario.has_runtime_receipt, true);
  assert.equal(scenario.runtime_receipt_id, 'receipt-hidden');
  assert.equal(isAttributableActionFailure(scenario, { wrongTab: 0 }), false);
});

test('action catch persists the current failed scope and writes its scoped trace', () => {
  assert.match(source, /await captureActionRunScope\(panel\)/);
  assert.match(source, /failureScenario = await actionScenarioEvidence\(lastPanel,/);
  assert.match(source, /await writeActionTrace\(lastPanel, failureScenario, boundTab\?\.id, outcome\)/);
  assert.match(source, /buildActionVerificationEvidence\(failureScenario \? \[failureScenario\] : \[\]\)/);
  assert.match(source, /tab_provenance: traceTabSamples/);
});
