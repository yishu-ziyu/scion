/**
 * Emit matrix_row lines for 022 unit gates (KERNEL/SKILL-02/VERIFY/ARTIFACT/DIFF unit).
 * Usage: node scripts/eval-022-unit-gates.mjs
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveEvalIdentity } from '../chrome-extension/scripts/lib/eval-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scionRoot = projectRoot;
const stamp = process.env.MATRIX_STAMP || '022-unit-gates';
const model = process.env.MODEL || 'MiniMax-M3';
const evalIdentity = resolveEvalIdentity();
const provider = evalIdentity.provider;
const providerBaseUrl = evalIdentity.base_url;
const featureFlagsHash = process.env.EVAL_FEATURE_FLAGS_HASH || '';
const gitSha = process.env.GIT_SHA || '';
const attempt = Number(process.env.EVAL_ATTEMPT || 1);
const campaignStamp = process.env.EVAL_CAMPAIGN_STAMP || stamp;
const armHash = process.env.EVAL_ARM_HASH || '';
const runId = process.env.EVAL_RUN_ID || '';
const evidenceDir = process.env.EVIDENCE_DIR || '';

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function writeUnitEvidence(suite, result, outcome) {
  if (!evidenceDir) return '';
  mkdirSync(evidenceDir, { recursive: true });
  const combinedOutput = String(result.stdout || '');
  const safeTaskId = suite.task_id.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const prefix = `${safeTaskId}-attempt-${attempt}`;
  const logPath = path.join(evidenceDir, `${prefix}-unit-output.log`);
  const reportPath = path.join(evidenceDir, `${prefix}-unit-report.json`);
  writeFileSync(logPath, combinedOutput, 'utf8');
  let machineReport = null;
  try {
    machineReport = JSON.parse(combinedOutput);
  } catch {
    // Gate independently parses the same file and rejects non-machine output.
  }
  const testCount = Number(machineReport?.numPassedTests || 0);
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        schema_version: 'chijie-eval-unit-v1',
        task_id: suite.task_id,
        attempt,
        campaign_stamp: campaignStamp,
        arm_hash: armHash,
        run_id: runId,
        outcome,
        terminal_status: 'completed',
        command: ['pnpm', '-F', 'chrome-extension', 'exec', 'vitest', 'run', ...suite.files, '--reporter=json'],
        reporter: 'vitest-json-v1',
        suite_files: suite.files,
        exit_code: result.status ?? 1,
        test_count: testCount,
        stdout_path: path.relative(scionRoot, logPath).replaceAll(path.sep, '/'),
        stdout_sha256: sha256(combinedOutput),
      },
      null,
      2,
    ) + '\n',
  );
  return `${reportPath};${logPath}`;
}

const suites = [
  {
    task_id: '022-KERNEL-01',
    files: ['src/background/browser/kernel/__tests__/022-kernel-parity.test.ts'],
  },
  {
    task_id: '022-SKILL-02',
    files: ['src/background/agent/skills/__tests__/skill-fallback.test.ts'],
  },
  {
    task_id: '022-VERIFY-01',
    files: ['src/background/task/__tests__/022-verify-artifact-gates.test.ts'],
  },
  {
    task_id: '022-ARTIFACT-01',
    files: ['src/background/task/__tests__/022-verify-artifact-gates.test.ts'],
  },
  {
    task_id: '022-DIFF-01',
    files: [
      'src/background/browser/kernel/__tests__/022-diff-payload.test.ts',
      'src/background/browser/kernel/__tests__/diff.test.ts',
    ],
    notes: 'unit_payload_median; live Diff ON/OFF e2e separate',
  },
  {
    task_id: '022-SIDE-EFFECTS',
    files: ['src/background/agent/skills/__tests__/side-effects-boundary.test.ts'],
  },
  {
    task_id: '022-PRIVACY',
    files: ['src/background/task/__tests__/022-privacy-gate.test.ts'],
  },
  {
    task_id: '022-CORE-PURITY',
    files: ['src/background/agent/backends/__tests__/control-llm-core-purity.test.ts'],
  },
];

const filter = (process.env.UNIT_TASK_FILTER || process.env.EVAL_TASK_ID || '').trim();
const selected = filter ? suites.filter(s => s.task_id === filter) : suites;

if (selected.length === 0 && !filter.startsWith('022-LEARN')) {
  throw new Error(`unknown UNIT_TASK_FILTER=${filter || '<empty>'}`);
}

if (filter === '022-LEARN-01' || filter.startsWith('022-LEARN')) {
  console.log(
    `matrix_row ${JSON.stringify({
      date: stamp,
      campaign_stamp: campaignStamp,
      arm_hash: armHash,
      run_id: runId,
      wave: '022-unit',
      task_id: '022-LEARN-01',
      attempt,
      git_sha: gitSha,
      model,
      provider,
      provider_base_url: providerBaseUrl,
      feature_flags_hash: featureFlagsHash,
      attach_mode: 'unit',
      browser_version: 'not_applicable',
      prompt_version: process.env.PROMPT_VERSION || 'n/a',
      policy_tag: process.env.POLICY_TAG || '022-unit',
      outcome: 'invalid_run',
      false_complete: 0,
      wrong_tab: 0,
      unapproved_commit: 0,
      latency_ms: 0,
      failure_class: 'blocked',
      evidence_path: '',
      notes: 'enableLearnedSkills=false; promotion not wired — BLOCKED not FAIL',
    })}`,
  );
  process.exitCode = 1;
} else {
  for (const suite of selected) {
    const started = Date.now();
    const result = spawnSync(
      'pnpm',
      ['-F', 'chrome-extension', 'exec', 'vitest', 'run', ...suite.files, '--reporter=json'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        env: process.env,
      },
    );
    let machineReport = null;
    try {
      machineReport = JSON.parse(String(result.stdout || ''));
    } catch {
      // Invalid reporter output is a failed unit proof even if the process exited zero.
    }
    const ok =
      result.status === 0 &&
      machineReport?.success === true &&
      Number(machineReport?.numTotalTests) > 0 &&
      machineReport?.numPassedTests === machineReport?.numTotalTests &&
      machineReport?.numFailedTests === 0 &&
      machineReport?.numPendingTests === 0;
    const outcome = ok ? 'verified_pass' : 'fail';
    const evidencePath = writeUnitEvidence(suite, result, outcome);
    const row = {
      date: stamp,
      campaign_stamp: campaignStamp,
      arm_hash: armHash,
      run_id: runId,
      wave: '022-unit',
      task_id: suite.task_id,
      attempt,
      git_sha: gitSha,
      model,
      provider,
      provider_base_url: providerBaseUrl,
      feature_flags_hash: featureFlagsHash,
      attach_mode: 'unit',
      browser_version: 'not_applicable',
      prompt_version: process.env.PROMPT_VERSION || 'n/a',
      policy_tag: process.env.POLICY_TAG || '022-unit',
      outcome,
      false_complete: 0,
      wrong_tab: 0,
      unapproved_commit: 0,
      latency_ms: Date.now() - started,
      failure_class: ok ? '' : 'unit_fail',
      evidence_path: evidencePath,
      notes: suite.notes || (ok ? 'unit_pass' : (result.stderr || result.stdout || '').slice(-200)),
    };
    console.log(`matrix_row ${JSON.stringify(row)}`);
    if (!ok) process.exitCode = 1;
  }
}
