#!/usr/bin/env node
/**
 * Fail on new layer-rule breaks, new import cycles, giant-file growth,
 * new high cognitive complexity, and new duplication.
 * `--write-baseline` snapshots the current tree after a real shrink; CI never uses it.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BASELINE_PATH, KNOWN_VIOLATIONS_PATH, collectSnapshot, readJson } from './lib/structure-collect.mjs';
import { WARN_LINES } from './lib/structure-rules.mjs';
import {
  diffComplexity,
  diffDuplication,
  diffFileSizes,
  diffViolations,
  mergeFindings,
} from './lib/structure-ratchet.mjs';

function printFindings(title, findings) {
  if (findings.length === 0) return;
  console.error(`${title} (${findings.length})`);
  for (const item of findings) {
    console.error(`  - ${item.message}`);
  }
}

async function writeBaseline(snapshot) {
  const baseline = {
    giants: snapshot.fileSizes.giants,
    complexity: snapshot.complexity.byKey,
    duplication: {
      duplicatedLines: snapshot.duplication.duplicatedLines,
      pairs: snapshot.duplication.pairs,
    },
  };
  await mkdir(path.dirname(BASELINE_PATH), { recursive: true });
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  await writeFile(KNOWN_VIOLATIONS_PATH, `${JSON.stringify(snapshot.violations, null, 2)}\n`);
}

function compareSnapshot(snapshot, baseline, knownViolations) {
  return mergeFindings(
    diffViolations(snapshot.violations, knownViolations),
    diffFileSizes(snapshot.fileSizes.files, baseline.giants ?? {}),
    diffComplexity(snapshot.complexity.current, baseline.complexity ?? {}),
    diffDuplication(snapshot.duplication, baseline.duplication ?? { duplicatedLines: 0, pairs: [] }),
  );
}

const write = process.argv.includes('--write-baseline');
const snapshot = await collectSnapshot();

if (write) {
  await writeBaseline(snapshot);
  console.log(
    `Wrote ${path.relative(process.cwd(), BASELINE_PATH)} and ${path.relative(process.cwd(), KNOWN_VIOLATIONS_PATH)}`,
  );
  console.log(
    `giants=${Object.keys(snapshot.fileSizes.giants).length} complexity=${Object.keys(snapshot.complexity.byKey).length} clonePairs=${snapshot.duplication.pairs.length} violations=${snapshot.violations.length}`,
  );
  process.exit(0);
}

const baseline = await readJson(BASELINE_PATH);
const knownViolations = await readJson(KNOWN_VIOLATIONS_PATH);
const findings = compareSnapshot(snapshot, baseline, knownViolations);

printFindings('Structure errors', findings.errors);
if (process.env.STRUCTURE_VERBOSE) {
  printFindings('Structure warnings', findings.warnings);
} else if (findings.warnings.length > 0) {
  console.error(
    `structure warnings: ${findings.warnings.length} files over ${WARN_LINES} lines (STRUCTURE_VERBOSE=1 to list)`,
  );
}

if (findings.errors.length > 0) {
  console.error(`structure check failed with ${findings.errors.length} error(s)`);
  process.exit(1);
}

console.log(
  `structure check passed (${snapshot.files.length} files, ${snapshot.violations.length} listed layer debts, ${findings.warnings.length} warning(s))`,
);

export { compareSnapshot, writeBaseline };
