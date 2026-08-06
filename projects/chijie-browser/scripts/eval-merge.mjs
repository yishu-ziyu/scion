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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportDir = path.resolve(projectRoot, '../../reports/nanobrowser/eval');
const stamp = process.env.MATRIX_STAMP || 'eval-final';
const inputs = (process.env.EVAL_CSVS || '')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(header => header.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim();
    });
    return row;
  });
}

async function main() {
  if (inputs.length === 0) throw new Error('EVAL_CSVS is required');
  await mkdir(reportDir, { recursive: true });
  const rows = [];
  for (const input of inputs) {
    const text = await readFile(input, 'utf8');
    rows.push(...parseCsv(text));
  }
  const deduped = new Map();
  for (const row of rows) {
    deduped.set(`${row.task_id}-${row.attempt}`, row);
  }
  const finalRows = [...deduped.values()];
  const csvPath = path.join(reportDir, `${stamp}-eval-matrix.csv`);
  const summaryPath = path.join(reportDir, `${stamp}-eval-summary.md`);
  const headers = [
    'date',
    'wave',
    'task_id',
    'attempt',
    'git_sha',
    'model',
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
  await writeFile(csvPath, headers.join(',') + '\n', 'utf8');
  for (const row of finalRows) {
    await writeFile(csvPath, headers.map(header => String(row[header] ?? '')).join(',') + '\n', { flag: 'a' });
  }
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
