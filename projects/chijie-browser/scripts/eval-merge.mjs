/**
 * Merge eval matrices into one final CSV + summary.
 *
 * Usage:
 *   EVAL_CSVS=../../reports/nanobrowser/eval/2026-08-02-eval-local-fixture-eval-matrix.csv,../../reports/nanobrowser/eval/2026-08-02-eval-public-eval-matrix.csv \
 *     MATRIX_STAMP=2026-08-02-eval-final pnpm eval:merge
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvalCsv, serializeEvalCsv, validateEvalRows } from './lib/eval-gate.mjs';
import { uniqueEvalRows } from './lib/eval-harness.mjs';
import { assertSafeCampaignStamp } from './lib/eval-provenance.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.resolve(projectRoot, '../../reports/nanobrowser/eval');
const stamp = assertSafeCampaignStamp(process.env.MATRIX_STAMP || 'eval-final');
const inputs = (process.env.EVAL_CSVS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

async function main() {
  if (inputs.length === 0) throw new Error('EVAL_CSVS is required');
  await mkdir(reportDir, { recursive: true });
  const rows = [];
  for (const input of inputs) {
    const text = await readFile(input, 'utf8');
    rows.push(...parseEvalCsv(text));
  }
  const finalRows = uniqueEvalRows(rows);
  if (new Set(finalRows.map(row => row.campaign_stamp)).size !== 1 || finalRows[0]?.campaign_stamp !== stamp) {
    throw new Error('merge cannot combine or rename campaigns');
  }
  const validationErrors = validateEvalRows(finalRows, 'merge');
  if (validationErrors.length > 0) throw new Error(`refuse invalid merge:\n${validationErrors.join('\n')}`);
  const csvPath = path.join(reportDir, `${stamp}-eval-matrix.csv`);
  const summaryPath = path.join(reportDir, `${stamp}-eval-summary.md`);
  const headers = [
    'date',
    'campaign_stamp',
    'arm_hash',
    'run_id',
    'wave',
    'task_id',
    'attempt',
    'git_sha',
    'model',
    'provider',
    'provider_base_url',
    'feature_flags_hash',
    'attach_mode',
    'prompt_version',
    'policy_tag',
    'outcome',
    'false_complete',
    'wrong_tab',
    'unapproved_commit',
    'latency_ms',
    'failure_class',
    'evidence_path',
    'notes',
  ];
  await writeFile(csvPath, serializeEvalCsv(headers, finalRows), 'utf8');
  const pass = finalRows.filter(row => row.outcome === 'verified_pass').length;
  const fail = finalRows.filter(row => row.outcome === 'fail').length;
  const invalid = finalRows.filter(row => row.outcome === 'invalid_run').length;
  const summary = `# Eval matrix ${stamp}

- Source matrices:
${inputs.map(input => `  - \`${input}\``).join('\n')}
- Total rows: ${finalRows.length}

| Outcome | Count |
|---|---:|
| verified_pass | ${pass} |
| fail | ${fail} |
| invalid_run | ${invalid} |

CSV: \`${path.relative(projectRoot, csvPath)}\`
`;
  await writeFile(summaryPath, summary, 'utf8');
  console.log(summary);
  process.exitCode = fail > 0 || invalid > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
