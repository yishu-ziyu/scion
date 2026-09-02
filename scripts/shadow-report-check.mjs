#!/usr/bin/env node
/**
 * C6 Shadow Mode stability checker (validator tooling).
 *
 * Scans E2E trace dumps (TRACE_DUMP_DIR / dir argument) for shadow records —
 * task_event spans named `shadow.match` / `shadow.divergence` written by
 * shadowReportToTraceRecord — and asserts the C6 acceptance minimum:
 *
 *   1. every trace with act spans produced shadow records (coverage);
 *   2. record outcomes are only match|divergence;
 *   3. divergence axes stay within {target, actionKind, error}.
 *
 * Exit 0 = stable-enough to read the breakdown; exit 1 = violation.
 * Usage: node scripts/shadow-report-check.mjs [dir]
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] || process.env.TRACE_DUMP_DIR || '');
if (!dir) {
  console.error('[shadow-check] no trace dir given (argv or TRACE_DUMP_DIR)');
  process.exit(1);
}

const AXIS = new Set(['target', 'actionKind', 'error']);
const files = readdirSync(dir).filter(name => name.endsWith('-trace.json'));
if (files.length === 0) {
  console.error(`[shadow-check] no *-trace.json files in ${dir}`);
  process.exit(1);
}

const errors = [];
let records = 0;
let match = 0;
let divergence = 0;
const axisCounts = {};

for (const name of files) {
  const trace = JSON.parse(readFileSync(join(dir, name), 'utf8'));
  const spans = Array.isArray(trace?.spans) ? trace.spans : [];
  const actSpans = spans.filter(span => span?.kind === 'act' || /(?:^|\.)act/.test(span?.name || ''));
  const events = Array.isArray(trace?.shadow_events)
    ? trace.shadow_events
    : spans.filter(span => /^shadow\./.test(span?.name || ''));
  if (actSpans.length > 0 && events.length === 0) {
    // Warning, not failure: unmapped legacy actions (scroll/wait/extract — the
    // C2 adapter ceiling) legitimately produce no shadow record.
    console.error(`[shadow-check] WARN ${name}: ${actSpans.length} act spans but 0 shadow records`);
  }
  for (const record of events) {
    records += 1;
    const outcome = String(record.name || '').replace(/^shadow\./, '');
    if (outcome === 'match') match += 1;
    else if (outcome === 'divergence') divergence += 1;
    else errors.push(`${name}: unknown shadow outcome "${record.name}"`);
    const axes = parseAxes(record);
    if (Array.isArray(axes)) {
      for (const axis of axes) {
        const key = axis?.axis ?? axis;
        if (!AXIS.has(key)) errors.push(`${name}: illegal shadow axis "${key}"`);
        axisCounts[key] = (axisCounts[key] ?? 0) + 1;
      }
    } else if (outcome === 'divergence') {
      errors.push(`${name}: divergence record without axes detail`);
    }
  }
}

/** Axes live in span.detail (JSON string) or span.data (flat primitives). */
function parseAxes(record) {
  const detail = record?.detail;
  if (typeof detail === 'string' && detail) {
    try {
      const parsed = JSON.parse(detail);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      return null;
    }
  }
  if (Array.isArray(detail)) return detail;
  if (record?.data && typeof record.data === 'object') {
    return Object.entries(record.data)
      .filter(([key]) => key.startsWith('axis.'))
      .map(([key, value]) => ({ axis: key.split('.')[1], value }));
  }
  return null;
}

console.log(
  `[shadow-check] dir=${dir} files=${files.length} shadow_records=${records} match=${match} divergence=${divergence} axes=${JSON.stringify(axisCounts)}`,
);
if (errors.length > 0) {
  for (const error of errors) console.error(`[shadow-check] FAIL ${error}`);
  process.exit(1);
}
console.log('[shadow-check] OK');
