import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

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
