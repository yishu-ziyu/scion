#!/usr/bin/env node
/**
 * EPIC A4 — quantified baseline report (JSON + Markdown under dist/baseline/).
 *
 * Data sources (in priority order):
 *   1. EVIDENCE_DIR  — `*-verification.json` files written by
 *      chrome-extension/scripts/action-agent-e2e.mjs (writeRunnerEvidence).
 *   2. TRACE_DUMP_DIR — `*-trace.json` files (schema chijie-eval-trace-v3,
 *      written by the same runner's writeActionTrace).
 *   3. Fixture static self-check — per-directory fixture.json + index.html
 *      under chrome-extension/test/fixtures (oracle / no-external-asset invariants, always runs).
 *
 * ponytail: token/cost and SW-recovery rates have no machine-readable source
 * yet (runner matrix_row lacks tokens; sw-restart e2e emits no evidence file).
 * Those metrics stay 0 with a data_sources.notes entry; upgrade path: extend
 * action-agent-e2e emitRow with token counters and write sw evidence.
 * With no evidence/trace data the script still emits a schema-valid all-zero
 * report instead of crashing.
 *
 * Usage:
 *   node scripts/baseline-report.mjs
 *   node scripts/baseline-report.mjs --compare a.json b.json
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(REPO_ROOT, 'dist', 'baseline');
const SCHEMA_PATH = path.join(REPO_ROOT, 'schemas', 'baseline-report.schema.json');
const FIXTURE_ROOT = path.join(REPO_ROOT, 'chrome-extension', 'test', 'fixtures');

/* ---------------------------------- env ---------------------------------- */

function gitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return result.status === 0 && result.stdout?.trim() ? result.stdout.trim() : 'unknown';
}

function redactHome(absolutePath) {
  if (!absolutePath) return null;
  const home = os.homedir();
  if (home && (absolutePath === home || absolutePath.startsWith(home + path.sep))) {
    return '~/' + absolutePath.slice(home.length + 1).split(path.sep).join('/');
  }
  return absolutePath.replace(/(^|\/)(Users|home)(\/[^/]+)/, '$1$2/<home>');
}

function environment() {
  const rootPkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
  const explicit = process.env.CHROME_PATH || '';
  const candidates = [
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const chromePath = explicit || candidates.find(candidate => existsSync(candidate)) || null;
  return {
    gitSha: gitSha(),
    node: process.version,
    pnpm: rootPkg.packageManager ?? null,
    packageVersion: rootPkg.version ?? null,
    manifestVersion: rootPkg.version ?? null,
    platform: process.platform,
    chromePath: redactHome(chromePath),
    chromeVersion: null,
    protocolVersion: 'legacy',
  };
}

/* ------------------------------- data loading ----------------------------- */

function listJson(dir, suffix) {
  if (!dir || !existsSync(dir)) return [];
  return readdirSync(dir)
    .filter(name => name.endsWith(suffix))
    .map(name => ({ file: path.join(dir, name), data: safeJson(path.join(dir, name)) }))
    .filter(item => item.data);
}

function safeJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function loadEvidenceRows() {
  const dir = process.env.EVIDENCE_DIR || path.join(REPO_ROOT, 'reports', 'nanobrowser', 'eval');
  return listJson(dir, '-verification.json').map(item => ({ file: item.file, row: item.data }));
}

function loadTraces() {
  const dir = process.env.TRACE_DUMP_DIR || '';
  return listJson(dir, '-trace.json').map(item => ({ file: item.file, trace: item.data }));
}

function fixtureSelfCheck() {
  const cases = [];
  if (!existsSync(FIXTURE_ROOT)) return cases;
  for (const entry of readdirSync(FIXTURE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(FIXTURE_ROOT, entry.name);
    const metaPath = path.join(dir, 'fixture.json');
    const htmlPath = path.join(dir, 'index.html');
    if (!existsSync(metaPath) || !existsSync(htmlPath)) continue;
    const meta = safeJson(metaPath);
    const html = readFileSync(htmlPath, 'utf8');
    const failures = [];
    if (!meta || meta.fixture !== entry.name) failures.push('fixture.json missing or name mismatch');
    if (!html.includes('__CHIJIE_FIXTURE_STATE__')) failures.push('oracle global missing');
    if (!html.includes('__CHIJIE_FIXTURE_RESET__')) failures.push('reset hook missing');
    if (/src=["']https?:/i.test(html) || /href=["']https?:/i.test(html)) failures.push('external http asset found');
    cases.push({
      case_id: `fixture:${entry.name}`,
      trace_id: `fixture:${entry.name}@${gitSha().slice(0, 8)}`,
      kind: 'fixture',
      outcome: failures.length === 0 ? 'pass' : 'fail',
      latency_ms: null,
      detail: failures.join('; '),
    });
  }
  return cases;
}

/* --------------------------------- metrics -------------------------------- */

function quantile(sorted, q) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function mean(values) {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function spansOf(trace, kind) {
  return (trace.spans || []).filter(span => span.kind === kind);
}

function buildMetrics(evidence, traces) {
  const rows = evidence.map(item => item.row);
  const terminal = rows.filter(row => ['verified_pass', 'fail'].includes(row.outcome));
  const verified = terminal.filter(row => row.outcome === 'verified_pass');
  const falseSuccess = rows.filter(row => Number(row.false_complete) === 1);
  const latencies = rows.map(row => Number(row.latency_ms)).filter(Number.isFinite).sort((a, b) => a - b);

  const actionsPerTrace = traces.map(item => spansOf(item.trace, 'act').length);
  const modelCallsPerTrace = traces.map(item => spansOf(item.trace, 'llm').length);
  const stale = traces.reduce(
    (total, item) =>
      total +
      spansOf(item.trace, 'act').filter(span => /stale/i.test(String(span.detail ?? span.name ?? ''))).length,
    0,
  );
  const noEffect = traces.reduce(
    (total, item) =>
      total +
      spansOf(item.trace, 'act').filter(span => /no.?effect/i.test(String(span.detail ?? span.name ?? ''))).length,
    0,
  );
  const swRows = rows.filter(row => /sw|restart/i.test(String(row.task_id ?? '')));
  const swRecovered = swRows.filter(row => row.outcome === 'verified_pass');
  const providerRepeat = traces.reduce((total, item) => {
    const failedLlm = spansOf(item.trace, 'llm').filter(span => span.status === 'fail').length;
    return total + (failedLlm > 1 ? failedLlm - 1 : 0);
  }, 0);

  return {
    verified_success_rate: terminal.length === 0 ? 0 : verified.length / terminal.length,
    false_success_rate: rows.length === 0 ? 0 : falseSuccess.length / rows.length,
    avg_actions: mean(actionsPerTrace),
    avg_model_calls: mean(modelCallsPerTrace),
    avg_tokens: 0,
    median_task_duration_ms: quantile(latencies, 0.5),
    p95_task_duration_ms: quantile(latencies, 0.95),
    stale_target_count: stale,
    action_no_effect_count: noEffect,
    sw_recovery_success_rate: swRows.length === 0 ? 0 : swRecovered.length / swRows.length,
    provider_error_repeat_failure_count: providerRepeat,
  };
}

function dataSources(evidence, traces, notes) {
  return {
    evidence_dir: process.env.EVIDENCE_DIR || null,
    trace_dir: process.env.TRACE_DUMP_DIR || null,
    fixture_dir: 'chrome-extension/test/fixtures',
    row_count: evidence.length + traces.length,
    notes,
  };
}

/* ----------------------------- schema validation -------------------------- */

function validate(value, schema, trail, errors) {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  if (schema.type) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
    const resolved = actual === 'number' && Number.isInteger(value) && types.includes('integer') ? 'integer' : actual;
    if (!types.includes(resolved)) {
      errors.push(`${trail}: expected ${types.join('|')}, got ${actual}`);
      return;
    }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${trail}: expected const ${schema.const}`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${trail}: ${value} not in enum`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${trail}: ${value} < min ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${trail}: ${value} > max ${schema.maximum}`);
  }
  if (Array.isArray(value) && schema.items) {
    value.forEach((item, index) => validate(item, schema.items, `${trail}[${index}]`, errors));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const key of schema.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${trail}: missing required ${key}`);
    }
    for (const [key, sub] of Object.entries(schema.properties ?? {})) {
      if (Object.hasOwn(value, key)) validate(value[key], sub, `${trail}.${key}`, errors);
    }
  }
}

function validateReport(report, schema) {
  const errors = [];
  validate(report, schema, '$', errors);
  return errors;
}

/* --------------------------------- markdown -------------------------------- */

function toMarkdown(report) {
  const lines = [
    '# Chijie 量化基线报告',
    '',
    `- generated_at: ${report.generated_at}`,
    `- git_sha: ${report.git_sha}`,
    `- environment: node=${report.environment.node} pnpm=${report.environment.pnpm} pkg=${report.environment.packageVersion} platform=${report.environment.platform} protocol=${report.environment.protocolVersion}`,
    `- data_sources: rows=${report.data_sources.row_count} evidence_dir=${report.data_sources.evidence_dir ?? '-'} trace_dir=${report.data_sources.trace_dir ?? '-'}`,
    '',
    '## 指标',
    '',
    '| 指标 | 值 |',
    '|------|----|',
  ];
  for (const [key, value] of Object.entries(report.metrics)) {
    lines.push(`| ${key} | ${typeof value === 'number' ? Number(value.toFixed(4)) : value} |`);
  }
  lines.push('', '## 案例', '', '| case_id | trace_id | kind | outcome | detail |', '|---------|----------|------|---------|--------|');
  for (const item of report.cases) {
    lines.push(`| ${item.case_id} | ${item.trace_id} | ${item.kind} | ${item.outcome} | ${item.detail || ''} |`);
  }
  lines.push('', '## 失败案例', '');
  if (report.failures.length === 0) lines.push('（无）');
  for (const item of report.failures) {
    lines.push(`- ${item.case_id} (trace ${item.trace_id}): ${item.reason}`);
  }
  if (report.data_sources.notes.length > 0) {
    lines.push('', '## 数据说明', '');
    for (const note of report.data_sources.notes) lines.push(`- ${note}`);
  }
  return lines.join('\n') + '\n';
}

/* --------------------------------- compare --------------------------------- */

const METRIC_DIRECTION = {
  verified_success_rate: 'higher',
  sw_recovery_success_rate: 'higher',
  false_success_rate: 'lower',
  avg_actions: 'lower',
  avg_model_calls: 'lower',
  avg_tokens: 'lower',
  median_task_duration_ms: 'lower',
  p95_task_duration_ms: 'lower',
  stale_target_count: 'lower',
  action_no_effect_count: 'lower',
  provider_error_repeat_failure_count: 'lower',
};

function compareReports(leftPath, rightPath) {
  const left = JSON.parse(readFileSync(leftPath, 'utf8'));
  const right = JSON.parse(readFileSync(rightPath, 'utf8'));
  const rows = [];
  for (const metric of Object.keys(METRIC_DIRECTION)) {
    const a = left.metrics?.[metric] ?? 0;
    const b = right.metrics?.[metric] ?? 0;
    const higherIsBetter = METRIC_DIRECTION[metric] === 'higher';
    let verdict = 'unchanged';
    if (a !== b) verdict = higherIsBetter === b > a ? 'improvement' : 'regression';
    rows.push({ metric, left: a, right: b, delta: b - a, verdict });
  }
  console.log(`compare ${left.git_sha} -> ${right.git_sha}`);
  for (const row of rows) {
    console.log(
      `  ${row.verdict.padEnd(11)} ${row.metric}: ${Number(row.left.toFixed(4))} -> ${Number(row.right.toFixed(4))} (delta ${Number(row.delta.toFixed(4))})`,
    );
  }
  const regressions = rows.filter(row => row.verdict === 'regression').length;
  if (regressions > 0) {
    console.log(`result: ${regressions} regression(s)`);
    process.exitCode = 1;
  } else {
    console.log('result: no regressions');
  }
}

/* ----------------------------------- main ---------------------------------- */

const compareIndex = process.argv.indexOf('--compare');
if (compareIndex >= 0) {
  const [left, right] = process.argv.slice(compareIndex + 1);
  if (!left || !right) {
    console.error('usage: node scripts/baseline-report.mjs --compare <a.json> <b.json>');
    process.exit(2);
  }
  compareReports(left, right);
  process.exit(process.exitCode ?? 0);
}

const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const evidence = loadEvidenceRows();
const traces = loadTraces();
const fixtureCases = fixtureSelfCheck();

const notes = [];
if (evidence.length === 0) {
  notes.push(
    'no *-verification.json found (set EVIDENCE_DIR; produced by pnpm e2e:action-agent with EVIDENCE_DIR=…) — run metrics are 0, not hidden',
  );
}
if (traces.length === 0) {
  notes.push('no *-trace.json found (set TRACE_DUMP_DIR; produced by pnpm e2e:action-agent with TRACE_DUMP_DIR=…) — action/model-call averages are 0');
}
notes.push('avg_tokens: no machine-readable source yet (runner emits no token counters); stays 0 until wired');
notes.push('sw_recovery_success_rate: sw-restart e2e prints PASS/FAIL only; no evidence file — 0 until wired');

const cases = [
  ...evidence.map(item => ({
    case_id: `${item.row.task_id ?? 'unknown'}-attempt-${item.row.attempt ?? 0}`,
    trace_id: item.row.run_id || item.row.arm_hash || path.basename(item.file),
    kind: 'evidence',
    outcome: String(item.row.outcome ?? 'unknown'),
    latency_ms: Number.isFinite(Number(item.row.latency_ms)) ? Number(item.row.latency_ms) : null,
    detail: String(item.row.notes ?? item.row.failure_class ?? ''),
  })),
  ...traces.map(item => ({
    case_id: `${item.trace.eval_task_id ?? 'unknown'}-trace-attempt-${item.trace.attempt ?? 0}`,
    trace_id: item.trace.run_id || path.basename(item.file),
    kind: 'trace',
    outcome: String(item.trace.outcome ?? 'unknown'),
    latency_ms: null,
    detail: `spans=${(item.trace.spans || []).length}`,
  })),
  ...fixtureCases,
];

const failures = cases
  .filter(item => item.outcome === 'fail' || item.outcome === 'false')
  .map(item => ({ case_id: item.case_id, trace_id: item.trace_id, reason: item.detail || item.outcome }));

const report = {
  schema_version: 'chijie-baseline-report-v1',
  generated_at: new Date().toISOString(),
  git_sha: gitSha(),
  environment: environment(),
  data_sources: dataSources(evidence, traces, notes),
  metrics: buildMetrics(evidence, traces),
  cases,
  failures,
};

const errors = validateReport(report, schema);
if (errors.length > 0) {
  console.error('baseline report failed schema validation:');
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });
const jsonPath = path.join(OUT_DIR, 'baseline-report.json');
const mdPath = path.join(OUT_DIR, 'baseline-report.md');
writeFileSync(jsonPath, JSON.stringify(report, null, 2) + '\n');
writeFileSync(mdPath, toMarkdown(report));
console.log(`wrote ${path.relative(REPO_ROOT, jsonPath)} and ${path.relative(REPO_ROOT, mdPath)}`);
console.log(
  `metrics: verified_success_rate=${report.metrics.verified_success_rate.toFixed(4)} false_success_rate=${report.metrics.false_success_rate.toFixed(4)} median_ms=${report.metrics.median_task_duration_ms} p95_ms=${report.metrics.p95_task_duration_ms} cases=${report.cases.length} failures=${report.failures.length}`,
);
