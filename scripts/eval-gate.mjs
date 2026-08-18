/**
 * Fail-closed regression gate for two frozen eval matrices.
 *
 * Usage:
 *   BASELINE_CSV=/path/baseline.csv CURRENT_CSV=/path/current.csv pnpm eval:gate
 * Optional: PASS_K=3 REGRESSION_TOLERANCE=0
 */
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareEvalMatricesWithEvidence, parseEvalCsv, validateGatePolicy } from './lib/eval-gate.mjs';

const baselinePath = process.env.BASELINE_CSV ? path.resolve(process.env.BASELINE_CSV) : '';
const currentPath = process.env.CURRENT_CSV ? path.resolve(process.env.CURRENT_CSV) : '';
const passK = Number(process.env.PASS_K || 3);
const tolerance = Number(process.env.REGRESSION_TOLERANCE || 0);
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function percent(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

async function main() {
  const policyErrors = validateGatePolicy({ baselinePath, currentPath, passK, tolerance });
  if (policyErrors.length > 0) throw new Error(policyErrors.join('; '));
  const [realBaseline, realCurrent] = await Promise.all([realpath(baselinePath), realpath(currentPath)]);
  if (realBaseline === realCurrent) throw new Error('baseline and current CSV resolve to the same file');

  const [baselineText, currentText] = await Promise.all([
    readFile(baselinePath, 'utf8'),
    readFile(currentPath, 'utf8'),
  ]);
  const result = await compareEvalMatricesWithEvidence(parseEvalCsv(baselineText), parseEvalCsv(currentText), {
    workspaceRoot,
    baselineCsvPath: realBaseline,
    currentCsvPath: realCurrent,
    passK,
    tolerance,
  });
  console.log(
    `[eval-gate] baseline TSR=${percent(result.baseline.tsr)} Pass^${passK}=${percent(
      result.baseline.pass_k,
    )}; current TSR=${percent(result.current.tsr)} Pass^${passK}=${percent(result.current.pass_k)}`,
  );
  for (const taskId of Object.keys(result.baseline.tasks).sort()) {
    const before = result.baseline.tasks[taskId];
    const after = result.current.tasks[taskId];
    console.log(
      `[eval-gate] ${taskId} TSR ${percent(before.tsr)} -> ${after ? percent(after.tsr) : 'missing'}; Pass^${
        passK
      } ${percent(before.pass_k)} -> ${after ? percent(after.pass_k) : 'missing'}`,
    );
  }
  if (!result.ok) {
    for (const error of result.errors) console.error(`[eval-gate] FAIL ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log('[eval-gate] PASS no safety or reliability regression');
}

main().catch(error => {
  console.error('[eval-gate] FAIL', error);
  process.exitCode = 1;
});
