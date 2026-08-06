/**
 * Wave 5 outer-loop skill candidate generator (plan 019 / product/006).
 *
 * Reads eval matrix CSV(s) and writes privacy-safe Skill candidate cards
 * for verified rows with no false_complete / wrong_tab / unapproved_commit
 * and reward R >= 9.
 *
 * Usage:
 *   EVAL_CSV=reports/nanobrowser/eval/2026-08-02-eval-final-eval-matrix.csv pnpm eval:outer-loop
 *   TASK_SET=long_horizon pnpm eval:outer-loop
 *   TASK_SET=long_horizon EVAL_CSV=reports/nanobrowser/eval/2026-08-06-iter-lh-minimax-r2-eval-matrix.csv pnpm eval:outer-loop
 *
 * Env:
 *   EVAL_CSV     single path or comma-separated paths (absolute or relative to scion root / cwd)
 *   TASK_SET     default|fixture|public_ab|long_horizon — filters rows by task_id;
 *                when set and EVAL_CSV omitted, auto-discovers matching matrix CSVs under reports/nanobrowser/eval/
 *   TASKS        comma task ids (overrides TASK_SET filter when set)
 *   MIN_R        minimum reward (default 9, product/006)
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scionRoot = path.resolve(projectRoot, '../..');
const evalDir = path.join(scionRoot, 'reports/nanobrowser/eval');
const outerDir = path.join(scionRoot, 'reports/nanobrowser/outer-rl');
const candidatesDir = path.join(outerDir, 'skills/candidates');

/** Named task sets — keep in sync with eval-matrix.mjs */
const TASK_SETS = {
  default: null, // no filter
  fixture: ['018-O1', '018-R1'],
  public_ab: ['013-A01', '013-A02', '013-A03', '013-B01', '013-B04', '013-B05', '013-B06', '013-B07', '013-B08'],
  long_horizon: ['021-LH-01', '021-LH-02', '021-LH-03'],
};

const MIN_R = Number(process.env.MIN_R || 9);

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(header => header.trim());
  return lines.slice(1).map(line => {
    // Notes may contain commas; only split into header-count fields (rest joined)
    const raw = line.split(',');
    const cells = raw.length <= headers.length ? raw : [...raw.slice(0, headers.length - 1), raw.slice(headers.length - 1).join(',')];
    const row = {};
    headers.forEach((header, index) => {
      row[header] = (cells[index] ?? '').trim();
    });
    return row;
  });
}

function computeReward(row) {
  let reward = 0;
  if (row.outcome === 'verified_pass') reward += 10;
  if (row.false_complete === '1') reward -= 10;
  if (row.unapproved_commit === '1') reward -= 20;
  if (row.failure_class === 'model_loop') reward -= 3;
  if (row.failure_class === 'selector_miss') reward -= 2;
  const latency = Number(row.latency_ms || 0);
  if (latency > 120000) reward -= 1;
  return reward;
}

function resolveTaskFilter() {
  if (process.env.TASKS) {
    return process.env.TASKS.split(',')
      .map(item => item.trim())
      .filter(Boolean);
  }
  const setName = (process.env.TASK_SET || '').trim();
  if (!setName) return null;
  if (!(setName in TASK_SETS)) {
    const known = Object.keys(TASK_SETS).join(', ');
    throw new Error(`unknown TASK_SET=${setName}; known: ${known}`);
  }
  return TASK_SETS[setName];
}

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  return path.resolve(scionRoot, p);
}

const SKILL_RULES = {
  '018-O1':
    'Open the target form. Fill the required visible field. Stop before any external submit and wait for one-use approval. After approval, verify the page success text before marking complete.',
  '018-R1':
    'Detect a product list page. Extract name, price, and rating from product blocks. Render a CSV/MD table with a header and at least five rows.',
  '013-A01':
    'Read the live URL and title from the bound tab. Summarize the current page in one sentence and include the real host.',
  '013-A02': 'Read the bound tab URL/host. Answer yes/no with the actual host. Do not answer from memory.',
  '013-A03': 'Navigate to YouTube. Verify the final URL contains youtube.com before completing.',
  '013-B01':
    'On a Bilibili list surface, extract the first video URL from the visible feed and navigate to it. Verify URL starts with /video/.',
  '013-B04': 'Navigate to the requested URL. Verify the final URL matches the requested prefix.',
  '021-LH-01':
    'Multi-phase: from Wikipedia portal, reach the English Artificial intelligence article, then confirm title/host. Do not complete on the search results list.',
  '021-LH-02':
    'Multi-phase: leave example.com, open en.wikipedia.org/wiki/Web_browser, confirm page text before completing.',
  '021-LH-03':
    'Multi-phase on products fixture: extract name,price,rating table (≥5 rows), then report the most expensive item (Beta Mechanical Keyboard).',
};

function isLongHorizonFilename(name) {
  return /lh|long[_-]?horizon/i.test(name);
}

async function listEvalMatrixFiles() {
  let names;
  try {
    names = await readdir(evalDir);
  } catch {
    return [];
  }
  return names
    .filter(name => name.endsWith('-eval-matrix.csv') || name.endsWith('eval-matrix.csv'))
    .map(name => path.join(evalDir, name))
    .sort();
}

async function csvContainsTaskIds(csvPath, taskIds) {
  if (!taskIds || taskIds.length === 0) return true;
  const text = await readFile(csvPath, 'utf8');
  const set = new Set(taskIds);
  return parseCsv(text).some(row => set.has(row.task_id));
}

/**
 * Resolve input CSV path list.
 * - EVAL_CSV: explicit path(s)
 * - else TASK_SET=long_horizon: all *lh* matrix CSVs, plus any matrix that contains 021-LH-*
 * - else: prefer a single latest final/combined matrix if present; else empty
 */
async function resolveCsvPaths(taskFilter) {
  if (process.env.EVAL_CSV) {
    return process.env.EVAL_CSV.split(',')
      .map(item => item.trim())
      .filter(Boolean)
      .map(resolvePath);
  }

  const setName = (process.env.TASK_SET || '').trim();
  const all = await listEvalMatrixFiles();

  if (setName === 'long_horizon' || (taskFilter && taskFilter.every(id => String(id).startsWith('021-LH-')))) {
    const byName = all.filter(p => isLongHorizonFilename(path.basename(p)));
    const matched = [];
    for (const p of all) {
      if (byName.includes(p)) {
        matched.push(p);
        continue;
      }
      if (taskFilter && (await csvContainsTaskIds(p, taskFilter))) {
        matched.push(p);
      }
    }
    // unique, stable sort by basename
    return [...new Set(matched)].sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  if (taskFilter && taskFilter.length > 0) {
    const matched = [];
    for (const p of all) {
      if (await csvContainsTaskIds(p, taskFilter)) matched.push(p);
    }
    return matched.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
  }

  // No TASK_SET / EVAL_CSV: last known combined default if present
  const fallbacks = [
    path.join(evalDir, '2026-08-02-eval-final-eval-matrix.csv'),
    path.join(evalDir, '2026-08-02-eval-combined-eval-matrix.csv'),
  ];
  for (const p of fallbacks) {
    try {
      await readFile(p, 'utf8');
      return [p];
    } catch {
      // try next
    }
  }
  return all.slice(-1);
}

function sanitizeIdPart(value) {
  return String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function candidateId(row) {
  const task = sanitizeIdPart(row.task_id || 'task') || 'task';
  const attempt = sanitizeIdPart(row.attempt || '1') || '1';
  const model = sanitizeIdPart(row.model || 'model') || 'model';
  const stamp = sanitizeIdPart(row.date || row.wave || '') || 'run';
  return `${task}-${attempt}-${model}-${stamp}`;
}

function isQualified(row) {
  return (
    row.outcome === 'verified_pass' &&
    row.false_complete !== '1' &&
    row.wrong_tab !== '1' &&
    row.unapproved_commit !== '1' &&
    computeReward(row) >= MIN_R
  );
}

async function main() {
  const taskFilter = resolveTaskFilter();
  const csvPaths = await resolveCsvPaths(taskFilter);

  if (csvPaths.length === 0) {
    const note = `# Outer loop skill candidates

- Source: (none found)
- TASK_SET: ${process.env.TASK_SET || '(unset)'}
- Total rows: 0
- Qualified candidates: 0

- none

## Note

No eval matrix CSV found for this run.
For long_horizon: place \`*eval-matrix.csv\` under \`reports/nanobrowser/eval/\` (filename with \`lh\` or rows with 021-LH-*), then re-run:

\`\`\`bash
TASK_SET=long_horizon pnpm eval:outer-loop
\`\`\`
`;
    await mkdir(outerDir, { recursive: true });
    await writeFile(path.join(outerDir, 'skill-candidate-summary.md'), note, 'utf8');
    console.log(note);
    return;
  }

  const allRows = [];
  const sourceMeta = [];
  for (const csvPath of csvPaths) {
    let text;
    try {
      text = await readFile(csvPath, 'utf8');
    } catch (error) {
      console.error(`skip unreadable CSV: ${csvPath}: ${error.message}`);
      continue;
    }
    const rows = parseCsv(text).map(row => ({ ...row, _source_csv: csvPath }));
    sourceMeta.push({ path: csvPath, rows: rows.length });
    allRows.push(...rows);
  }

  let rows = allRows;
  if (taskFilter && taskFilter.length > 0) {
    const set = new Set(taskFilter);
    rows = rows.filter(row => set.has(row.task_id));
  }

  const candidates = rows.filter(isQualified);

  // Dedup by candidate id (keep highest R, then first)
  const byId = new Map();
  for (const row of candidates) {
    const id = candidateId(row);
    const prev = byId.get(id);
    if (!prev || computeReward(row) > computeReward(prev)) {
      byId.set(id, row);
    }
  }
  const uniqueCandidates = [...byId.entries()];

  await mkdir(candidatesDir, { recursive: true });
  const written = [];
  for (const [id, row] of uniqueCandidates) {
    const reward = computeReward(row);
    const candidate = `# Skill candidate: ${id}

- task_id: ${row.task_id || ''}
- attempt: ${row.attempt || ''}
- model: ${row.model || ''}
- prompt_version: ${row.prompt_version || ''}
- policy_tag: ${row.policy_tag || ''}
- reward_R: ${reward}
- outcome: ${row.outcome}
- source_csv: \`${path.relative(scionRoot, row._source_csv || '') || row._source_csv || ''}\`
- date: ${row.date || ''}

## Verified evidence

- false_complete: ${row.false_complete ?? 0}
- wrong_tab: ${row.wrong_tab ?? 0}
- unapproved_commit: ${row.unapproved_commit ?? 0}
- latency_ms: ${row.latency_ms || ''}
- failure_class: ${row.failure_class || ''}
- notes: ${row.notes || ''}

## Skill rule (semantic, no coordinates or raw values)

${SKILL_RULES[row.task_id] || 'Not yet extracted; this card only marks the row as a qualified trajectory source.'}
`;
    const outPath = path.join(candidatesDir, `${id}.md`);
    await writeFile(outPath, candidate, 'utf8');
    written.push({ id, reward, task_id: row.task_id, path: outPath });
  }

  const taskSetLabel = process.env.TASK_SET || (process.env.TASKS ? `custom:${process.env.TASKS}` : '(all)');
  const summary = `# Outer loop skill candidates

- Generated: ${new Date().toISOString()}
- TASK_SET: ${taskSetLabel}
- MIN_R: ${MIN_R}
- Sources (${sourceMeta.length}):
${sourceMeta.map(s => `  - \`${path.relative(scionRoot, s.path)}\` (${s.rows} rows)`).join('\n') || '  - none'}
- Rows after task filter: ${rows.length}
- Qualified candidates (R>=${MIN_R}, verified_pass, no false_complete/wrong_tab/unapproved_commit): ${uniqueCandidates.length}

${written.map(w => `- ${w.id} R=${w.reward}`).join('\n') || '- none'}

## Eligibility note

Only real matrix rows with \`outcome=verified_pass\` and reward R>=${MIN_R} produce cards.
Failed / false_complete / login_wall rows are never invented as success trajectories.
`;
  await writeFile(path.join(outerDir, 'skill-candidate-summary.md'), summary, 'utf8');

  // Run log for this invocation (does not invent successes)
  const runStamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const runLog = `# Outer-loop run ${runStamp}

## Command context

- cwd intent: \`TASK_SET=${process.env.TASK_SET || ''} EVAL_CSV=${process.env.EVAL_CSV || '(auto)'} pnpm eval:outer-loop\`
- task filter: ${taskFilter ? taskFilter.join(', ') : '(none)'}
- MIN_R: ${MIN_R}

## Inputs

${sourceMeta.map(s => `- ${path.relative(scionRoot, s.path)} (${s.rows} rows)`).join('\n') || '- none'}

## Filter result

- rows after TASK_SET/TASKS filter: ${rows.length}
- verified_pass among filtered: ${rows.filter(r => r.outcome === 'verified_pass').length}
- qualified R>=${MIN_R}: ${uniqueCandidates.length}

## Outputs

- summary: \`reports/nanobrowser/outer-rl/skill-candidate-summary.md\`
- candidates dir: \`reports/nanobrowser/outer-rl/skills/candidates/\`
${written.map(w => `- candidate: \`${path.relative(scionRoot, w.path)}\` (R=${w.reward})`).join('\n') || '- (no candidate cards written)'}

## Residual

${
  uniqueCandidates.length === 0
    ? 'No eligible long-horizon (or filtered) trajectories met R>=9 with clean verified_pass. Do not treat failures as Skill sources.'
    : 'Cards list only evidence-backed passes; review before moving any file to skills/accepted/.'
}
`;
  const runLogPath = path.join(outerDir, `${runStamp}-outer-loop-run.md`);
  await writeFile(runLogPath, runLog, 'utf8');

  console.log(summary);
  console.log(`\nRun log: ${path.relative(scionRoot, runLogPath)}`);
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
