#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { BASELINE_PATH, REPO_ROOT, collectFileSizes, listSourceFiles, readJson } from './lib/structure-collect.mjs';

function gitLines(args) {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0) return [];
  return result.stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
}

function printSection(title, rows) {
  console.log(`\n## ${title}`);
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  for (const row of rows) console.log(row);
}

const files = await listSourceFiles();
const { sizes } = await collectFileSizes(files);
const baseline = await readJson(BASELINE_PATH, { giants: {} });
const since = '90.days';
const changed = gitLines(['log', `--since=${since}`, '--pretty=format:', '--name-only']);
const churn = new Map();
for (const file of changed) {
  churn.set(file, (churn.get(file) ?? 0) + 1);
}

const hotspots = files
  .map(file => {
    const count = churn.get(file) ?? 0;
    const lines = sizes[file] ?? 0;
    return { file, count, lines, score: count * lines };
  })
  .filter(item => item.score > 0)
  .sort((a, b) => b.score - a.score)
  .slice(0, 12);

printSection(
  'Hotspots (commits in 90 days × lines)',
  hotspots.map(item => `${String(item.score).padStart(8)}  ${item.count} commits  ${item.lines} lines  ${item.file}`),
);

const giants = Object.keys(baseline.giants ?? {}).sort();
for (const giant of giants) {
  const commits = gitLines(['log', `--since=${since}`, '--pretty=format:%H', '--', giant]);
  const together = new Map();
  for (const sha of commits) {
    for (const file of gitLines(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])) {
      if (file === giant || file.includes('__tests__') || file.endsWith('.test.ts')) continue;
      together.set(file, (together.get(file) ?? 0) + 1);
    }
  }
  const rows = [...together.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([file, count]) => `${count}/${commits.length}  ${file}`);
  printSection(`Changed with ${giant}`, rows);
}

console.log('\n## knip (report only)');
const knip = spawnSync(path.join(REPO_ROOT, 'node_modules/.bin/knip'), ['--no-progress'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  maxBuffer: 8 * 1024 * 1024,
});
const knipText = `${knip.stdout || ''}${knip.stderr || ''}`.trim();
if (!knipText) {
  console.log(knip.status === 0 ? '(clean)' : `(knip exited ${knip.status})`);
} else {
  console.log(knipText.split('\n').slice(0, 60).join('\n'));
  const extra = knipText.split('\n').length - 60;
  if (extra > 0) console.log(`… ${extra} more lines (report only, not a failure)`);
}
