/**
 * Emit matrix_row lines for 022 unit gates (KERNEL/SKILL-02/VERIFY/ARTIFACT/DIFF unit).
 * Usage: node scripts/eval-022-unit-gates.mjs
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const stamp = process.env.MATRIX_STAMP || '022-unit-gates';
const model = process.env.MODEL || 'MiniMax-M3';
const gitSha = process.env.GIT_SHA || '';

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

if (filter === '022-LEARN-01' || filter.startsWith('022-LEARN')) {
  console.log(
    `matrix_row ${JSON.stringify({
      date: stamp,
      wave: '022-unit',
      task_id: '022-LEARN-01',
      attempt: 1,
      git_sha: gitSha,
      model,
      attach_mode: 'unit',
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
  process.exitCode = 0;
} else {
  for (const suite of selected) {
    const started = Date.now();
    const result = spawnSync(
      'pnpm',
      ['-F', 'chrome-extension', 'exec', 'vitest', 'run', ...suite.files],
      { cwd: projectRoot, encoding: 'utf8', env: process.env },
    );
    const ok = result.status === 0;
    const row = {
      date: stamp,
      wave: '022-unit',
      task_id: suite.task_id,
      attempt: 1,
      git_sha: gitSha,
      model,
      attach_mode: 'unit',
      prompt_version: process.env.PROMPT_VERSION || 'n/a',
      policy_tag: process.env.POLICY_TAG || '022-unit',
      outcome: ok ? 'verified_pass' : 'fail',
      false_complete: 0,
      wrong_tab: 0,
      unapproved_commit: 0,
      latency_ms: Date.now() - started,
      failure_class: ok ? '' : 'unit_fail',
      evidence_path: suite.files.join(';'),
      notes: suite.notes || (ok ? 'unit_pass' : (result.stderr || result.stdout || '').slice(-200)),
    };
    console.log(`matrix_row ${JSON.stringify(row)}`);
    if (!ok) process.exitCode = 1;
  }
}
