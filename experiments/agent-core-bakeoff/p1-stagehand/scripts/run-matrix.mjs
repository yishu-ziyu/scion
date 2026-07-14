/**
 * M1 matrix: run form + media fixtures N times (default 10).
 * Docs: product/003 G1/G2, product/004 M1 commands.
 * Usage: AUTO_APPROVE=1 HEADLESS=true node scripts/run-matrix.mjs
 */
import { spawn } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveMiniMaxConfig } from './lib/minimax-env.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const runs = Number(process.env.RUNS || 10);
const reportDir = path.resolve(root, '../../../reports/nanobrowser/bakeoff');
const stamp = new Date().toISOString().slice(0, 10);
const csvPath = path.join(reportDir, `${stamp}-m1-matrix.csv`);
const summaryPath = path.join(reportDir, `${stamp}-m1-summary.md`);

function runScript(script) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [script], {
      cwd: root,
      env: { ...process.env, AUTO_APPROVE: process.env.AUTO_APPROVE || '1', HEADLESS: process.env.HEADLESS || 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', d => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', d => {
      out += d;
      process.stderr.write(d);
    });
    child.on('close', code => resolve({ code: code ?? 1, out }));
  });
}

function parseMatrixRow(out) {
  const m = out.match(/matrix_row\s+(\{[\s\S]*\})/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch {
    return null;
  }
}

async function main() {
  const mm = resolveMiniMaxConfig();
  await mkdir(reportDir, { recursive: true });
  const header =
    'path,task,attempt,model,outcome,false_complete,unapproved_commit,target_bind_ok,latency_ms,notes\n';
  await writeFile(csvPath, header, 'utf8');

  const results = { form: [], media: [] };

  for (let i = 1; i <= runs; i += 1) {
    console.log(`\n======== FORM attempt ${i}/${runs} ========`);
    const form = await runScript(path.join(__dirname, 'run-form.mjs'));
    const formRow = parseMatrixRow(form.out) || {
      path: 'P1',
      task: 'T1-fixture',
      model: mm.modelName,
      outcome: form.code === 0 ? 'verified_pass' : 'fail',
      false_complete: 0,
      unapproved_commit: 0,
      latency_ms: '',
    };
    formRow.attempt = i;
    results.form.push(formRow);
    await appendFile(
      csvPath,
      [
        formRow.path,
        formRow.task,
        i,
        formRow.model || mm.modelName,
        formRow.outcome,
        formRow.false_complete ?? '',
        formRow.unapproved_commit ?? '',
        formRow.target_bind_ok ?? '',
        formRow.latency_ms ?? '',
        (formRow.notes || '').replaceAll(',', ';'),
      ].join(',') + '\n',
    );

    console.log(`\n======== MEDIA attempt ${i}/${runs} ========`);
    const media = await runScript(path.join(__dirname, 'run-media.mjs'));
    const mediaRow = parseMatrixRow(media.out) || {
      path: 'P1',
      task: 'T2-fixture',
      model: mm.modelName,
      outcome: media.code === 0 ? 'verified_pass' : 'fail',
      false_complete: 0,
      target_bind_ok: 0,
      latency_ms: '',
    };
    mediaRow.attempt = i;
    results.media.push(mediaRow);
    await appendFile(
      csvPath,
      [
        mediaRow.path,
        mediaRow.task,
        i,
        mediaRow.model || mm.modelName,
        mediaRow.outcome,
        mediaRow.false_complete ?? '',
        mediaRow.unapproved_commit ?? '',
        mediaRow.target_bind_ok ?? '',
        mediaRow.latency_ms ?? '',
        (mediaRow.notes || '').replaceAll(',', ';'),
      ].join(',') + '\n',
    );
  }

  const formPass = results.form.filter(r => r.outcome === 'verified_pass').length;
  const mediaPass = results.media.filter(r => r.outcome === 'verified_pass').length;
  const g1 = formPass === runs;
  const g2 = mediaPass === runs;

  const summary = `# M1 matrix ${stamp}

- Model: ${mm.modelName}
- Base: ${mm.baseURL}
- Runs: ${runs}
- CSV: \`${path.relative(path.resolve(root, '../../..'), csvPath)}\`

| Gate | Result | Detail |
|---|---|---|
| G1 form | ${g1 ? 'PASS' : 'FAIL'} | ${formPass}/${runs} |
| G2 media | ${g2 ? 'PASS' : 'FAIL'} | ${mediaPass}/${runs} |

Tabbit parity note: fixture 10/10 is required before claiming progress toward Agent 91.8% on real sites.

## Next

${g1 && g2 ? 'M1 complete → start M2 (production core swap design).' : 'Stay on M1: fix failures, re-run matrix.'}
`;

  await writeFile(summaryPath, summary, 'utf8');
  console.log(summary);
  process.exitCode = g1 && g2 ? 0 : 1;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
