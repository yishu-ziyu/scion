import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clonePairKey,
  diffComplexity,
  diffDuplication,
  diffFileSizes,
  diffViolations,
  enclosingFunctionName,
  functionKey,
  giantsFromSizes,
  isSameViolation,
  isStableFunctionName,
  lineCount,
  parseComplexityMessage,
  repoPathFromClone,
} from '../lib/structure-ratchet.mjs';
import { forbidden, FAIL_LINES, GIANT_SLACK, NEW_COMPLEXITY_MAX } from '../lib/structure-rules.mjs';

test('lineCount matches editor lines, ignoring a trailing newline', () => {
  assert.equal(lineCount(''), 0);
  assert.equal(lineCount('a\nb\n'), 2);
  assert.equal(lineCount('a\nb'), 2);
});

test('file size ratchet allows listed giants only 50 more lines', () => {
  const files = [
    { path: 'chrome-extension/src/background/task/manager.ts', lines: 4491 },
    { path: 'pages/side-panel/src/components/TaskStatusCard.tsx', lines: 758 },
  ];
  const giants = { 'chrome-extension/src/background/task/manager.ts': 4491 };
  const ok = diffFileSizes(files, giants);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.warnings.length, 1);
  assert.equal(ok.warnings[0].path, 'pages/side-panel/src/components/TaskStatusCard.tsx');

  const grown = diffFileSizes(
    [{ path: 'chrome-extension/src/background/task/manager.ts', lines: 4491 + GIANT_SLACK + 1 }],
    giants,
  );
  assert.equal(grown.errors[0].kind, 'giant-growth');
});

test('file size ratchet rejects a new file over 800 lines', () => {
  const result = diffFileSizes(
    [{ path: 'chrome-extension/src/background/task/new-hub.ts', lines: FAIL_LINES + 1 }],
    {},
  );
  assert.equal(result.errors[0].kind, 'new-giant');
});

test('an unlisted file may grow to 800 but not past it', () => {
  const under = diffFileSizes([{ path: 'pages/side-panel/src/components/TaskStatusCard.tsx', lines: FAIL_LINES }], {});
  assert.equal(under.errors.length, 0);
  const over = diffFileSizes(
    [{ path: 'pages/side-panel/src/components/TaskStatusCard.tsx', lines: FAIL_LINES + 1 }],
    {},
  );
  assert.equal(over.errors[0].kind, 'new-giant');
});

test('complexity ratchet blocks new functions above 15 and existing ones getting worse', () => {
  const current = [
    { key: 'a.ts:newHot', complexity: NEW_COMPLEXITY_MAX + 1 },
    { key: 'a.ts:oldHot', complexity: 22 },
  ];
  const baseline = { 'a.ts:oldHot': 20 };
  const result = diffComplexity(current, baseline);
  assert.deepEqual(result.errors.map(item => item.kind).sort(), ['complexity-increase', 'new-complexity']);
});

test('complexity ratchet allows a new function at 15 and does not fail when a baseline name disappears', () => {
  const result = diffComplexity([{ key: 'a.ts:fine', complexity: NEW_COMPLEXITY_MAX }], { 'a.ts:gone': 18 });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings[0].kind, 'unused-complexity');
});

test('duplication ratchet blocks more duplicated lines and new file pairs', () => {
  const result = diffDuplication(
    { duplicatedLines: 10, pairs: [clonePairKey('a.ts', 'b.ts'), clonePairKey('c.ts', 'd.ts')] },
    { duplicatedLines: 8, pairs: [clonePairKey('a.ts', 'b.ts')] },
  );
  assert.deepEqual(result.errors.map(item => item.kind).sort(), ['duplication-lines', 'new-clone-pair']);
});

test('violation ratchet blocks new edges and leftover known entries', () => {
  const known = [{ rule: { name: 'task-not-to-sites' }, from: 'task/manager.ts', to: 'browser/sites/form-fill.ts' }];
  const current = [{ rule: { name: 'task-not-to-sites' }, from: 'task/manager.ts', to: 'browser/sites/youtube.ts' }];
  const result = diffViolations(current, known);
  assert.equal(
    result.errors.some(item => item.kind === 'new-violation'),
    true,
  );
  assert.equal(
    result.errors.some(item => item.kind === 'unused-known'),
    true,
  );
});

test('cycle identity ignores from/to order and matches module names', () => {
  const left = {
    rule: { name: 'no-circular' },
    from: 'a.ts',
    to: 'b.ts',
    cycle: [{ name: 'a.ts' }, { name: 'b.ts' }],
  };
  const right = {
    rule: { name: 'no-circular' },
    from: 'b.ts',
    to: 'a.ts',
    cycle: [{ name: 'b.ts' }, { name: 'a.ts' }],
  };
  assert.equal(isSameViolation(left, right), true);
});

test('complexity message parser and function keys stay stable', () => {
  assert.equal(
    parseComplexityMessage('Refactor this function to reduce its Cognitive Complexity from 18 to the 15 allowed.'),
    18,
  );
  assert.equal(functionKey('a.ts', 'TaskManager.dispatch', 10), 'a.ts:TaskManager.dispatch');
  assert.equal(functionKey('a.ts', '', 42), 'a.ts:L42');
  assert.equal(isStableFunctionName('map'), false);
  assert.equal(
    enclosingFunctionName(['export async function createLlmControlDriver() {', '  return items.map(() => {'], 1),
    'createLlmControlDriver',
  );
});

test('clone paths drop the repo root so macOS and CI compare the same pair', () => {
  assert.equal(
    repoPathFromClone('/repo/chrome-extension/src/background/task/manager.ts', '/repo'),
    'chrome-extension/src/background/task/manager.ts',
  );
  assert.equal(
    repoPathFromClone('pages\\side-panel\\src\\SidePanel.tsx', '/repo'),
    'pages/side-panel/src/SidePanel.tsx',
  );
});

test('giantsFromSizes keeps only files already over the hard line cap', () => {
  assert.deepEqual(giantsFromSizes({ 'big.ts': 801, 'ok.ts': 400, 'edge.ts': 800 }), { 'big.ts': 801 });
});

test('structure rules lock the agreed import directions', () => {
  const names = forbidden.map(rule => rule.name);
  for (const name of [
    'no-circular',
    'pages-not-to-extension',
    'extension-not-to-pages',
    'packages-not-to-extension',
    'packages-not-to-pages',
    'skills-not-to-browser-context',
    'control-llm-not-to-sites',
    'task-not-to-sites',
    'browser-not-to-task-impl',
  ]) {
    assert.equal(names.includes(name), true, name);
  }

  const browserRule = forbidden.find(rule => rule.name === 'browser-not-to-task-impl');
  assert.match(browserRule.to.pathNot, /contracts\|action-frame/);
});
