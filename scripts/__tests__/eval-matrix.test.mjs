import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixScript = path.join(projectRoot, 'scripts/eval-matrix.mjs');
const mergeScript = path.join(projectRoot, 'scripts/eval-merge.mjs');
const unitScript = path.join(projectRoot, 'scripts/eval-022-unit-gates.mjs');

function dryRun(env) {
  const childEnv = { ...process.env, DRY_RUN: '1' };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  return spawnSync(process.execPath, [matrixScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: childEnv,
  });
}

test('matrix rejects zero runs and duplicate task ids', () => {
  const zero = dryRun({ RUNS: '0', TASKS: '021-LH-04' });
  assert.notEqual(zero.status, 0);
  assert.match(`${zero.stdout}${zero.stderr}`, /RUNS must be a positive integer/);
  const duplicate = dryRun({ RUNS: '1', TASKS: '021-LH-04,021-LH-04' });
  assert.notEqual(duplicate.status, 0);
  assert.match(`${duplicate.stdout}${duplicate.stderr}`, /TASKS contains duplicates/);
  const empty = dryRun({ RUNS: '1', TASKS: ' ,' });
  assert.notEqual(empty.status, 0);
  assert.match(`${empty.stdout}${empty.stderr}`, /zero task ids/);
});

test('merge and unit runner reject zero-work inputs', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'eval-zero-work-'));
  try {
    const emptyCsv = path.join(temp, 'empty.csv');
    writeFileSync(emptyCsv, 'task_id,attempt,outcome\n');
    const merge = spawnSync(process.execPath, [mergeScript], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, EVAL_CSVS: emptyCsv, MATRIX_STAMP: 'must-not-write' },
    });
    assert.notEqual(merge.status, 0);
    assert.match(`${merge.stdout}${merge.stderr}`, /zero eval rows/);

    const unit = spawnSync(process.execPath, [unitScript], {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, UNIT_TASK_FILTER: 'NOPE', EVAL_TASK_ID: 'NOPE' },
    });
    assert.notEqual(unit.status, 0);
    assert.match(`${unit.stdout}${unit.stderr}`, /unknown UNIT_TASK_FILTER/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('phase0 registry dry-run contains exactly 13 tasks including LH04', () => {
  const result = dryRun({ RUNS: '1', TASK_SET: 'phase0_022', TASKS: undefined });
  assert.equal(result.status, 0, result.stderr);
  const taskLines = result.stdout.split('\n').filter(line => /^\s+(?:OK|WARN)/.test(line));
  assert.equal(taskLines.length, 13);
  assert(taskLines.some(line => line.includes('021-LH-04')));
});

test('LH03 uses a runtime fixture oracle and frontier leaked prompts are fail-closed', () => {
  const source = readFileSync(matrixScript, 'utf8');
  assert.match(source, /VERIFY: 'products_extract'/);
  assert.doesNotMatch(source, /应为 Beta Mechanical Keyboard/);
  assert.equal((source.match(/trusted: false/g) || []).length, 8);
  assert.match(source, /const persistedRows = parseEvalCsv\(await readFile\(csvPath, 'utf8'\)\)/);
  assert.match(source, /validateEvidenceRows\(persistedRows/);
  assert.match(source, /matrix self-validation failed/);
});
