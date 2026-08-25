import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { CRUISE_TARGETS, NEW_COMPLEXITY_MAX, SOURCE_EXCLUDES, SOURCE_ROOTS } from './structure-rules.mjs';
import {
  clonePairKey,
  enclosingFunctionName,
  functionKey,
  giantsFromSizes,
  isStableFunctionName,
  lineCount,
  parseComplexityMessage,
  repoPathFromClone,
} from './structure-ratchet.mjs';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const BASELINE_PATH = path.join(REPO_ROOT, 'scripts/structure-baseline.json');
export const KNOWN_VIOLATIONS_PATH = path.join(REPO_ROOT, '.dependency-cruiser-known-violations.json');

function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

export function repoRelative(filePath) {
  return toPosix(path.relative(REPO_ROOT, filePath));
}

export function isSourceFile(relativePath) {
  if (!/\.(ts|tsx)$/.test(relativePath)) return false;
  if (relativePath.endsWith('.d.ts')) return false;
  return !SOURCE_EXCLUDES.some(pattern => pattern.test(relativePath));
}

export async function listSourceFiles(root = REPO_ROOT) {
  const files = [];

  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const relative = repoRelative(full);
      if (SOURCE_EXCLUDES.some(pattern => pattern.test(relative))) continue;
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (entry.isFile() && isSourceFile(relative)) files.push(relative);
    }
  }

  for (const relativeRoot of SOURCE_ROOTS) {
    await walk(path.join(root, relativeRoot));
  }
  files.sort();
  return files;
}

export async function collectFileSizes(files, root = REPO_ROOT) {
  const sizes = {};
  const listed = [];
  for (const relative of files) {
    const content = await readFile(path.join(root, relative), 'utf8');
    const lines = lineCount(content);
    sizes[relative] = lines;
    listed.push({ path: relative, lines });
  }
  return { sizes, files: listed, giants: giantsFromSizes(sizes) };
}

function nameFromEslintLoc(line, column, endColumn) {
  const sliced = line.slice(Math.max(0, column - 1), Math.max(column - 1, endColumn - 1)).trim();
  if (/^[A-Za-z_$][\w$]*$/.test(sliced)) return sliced;
  const before = line.slice(0, Math.max(0, column - 1));
  const assigned = before.match(/([A-Za-z_$][\w$]*)\s*=\s*(async\s*)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*$/);
  if (assigned) return assigned[1];
  const method = before.match(/([A-Za-z_$][\w$]*)\s*\([^)]*$/);
  if (method) return method[1];
  return '';
}

export async function collectComplexity(files, root = REPO_ROOT) {
  const eslint = new ESLint({
    cwd: root,
    useEslintrc: false,
    ignore: false,
    overrideConfig: {
      parser: '@typescript-eslint/parser',
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
      plugins: ['sonarjs'],
      rules: { 'sonarjs/cognitive-complexity': ['warn', NEW_COMPLEXITY_MAX] },
    },
  });

  const absFiles = files.map(relative => path.join(root, relative));
  const reports = await eslint.lintFiles(absFiles);
  const current = [];
  const byKey = {};

  for (const report of reports) {
    const relative = repoRelative(report.filePath);
    const source = report.source ?? (await readFile(report.filePath, 'utf8'));
    const lines = source.split(/\r?\n/);
    for (const message of report.messages) {
      if (message.ruleId !== 'sonarjs/cognitive-complexity') continue;
      const complexity = parseComplexityMessage(message.message);
      if (complexity == null || complexity <= NEW_COMPLEXITY_MAX) continue;
      const lineText = lines[message.line - 1] ?? '';
      let name = nameFromEslintLoc(lineText, message.column, message.endColumn);
      if (!isStableFunctionName(name)) {
        name = enclosingFunctionName(lines, message.line - 1);
      }
      if (!isStableFunctionName(name)) continue;
      const key = functionKey(relative, name, message.line);
      const previous = byKey[key];
      if (previous != null && previous >= complexity) continue;
      byKey[key] = complexity;
      const existing = current.findIndex(item => item.key === key);
      const entry = { key, complexity, path: relative, name, line: message.line };
      if (existing >= 0) current[existing] = entry;
      else current.push(entry);
    }
  }

  current.sort((a, b) => a.key.localeCompare(b.key));
  return { current, byKey };
}

function runBin(bin, args, extra = {}) {
  const binPath = path.join(REPO_ROOT, 'node_modules/.bin', bin);
  const result = spawnSync(binPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...extra,
  });
  return result;
}

export async function collectDuplication(root = REPO_ROOT) {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'chijie-jscpd-'));
  try {
    const result = runBin(
      'jscpd',
      [
        '--format',
        'typescript,tsx',
        '--min-lines',
        '8',
        '--min-tokens',
        '70',
        '--ignore',
        '**/node_modules/**,**/dist/**,**/build/**,**/*.test.ts,**/*.test.tsx,**/__tests__/**,**/*.d.ts',
        '--reporters',
        'json',
        '--output',
        outputDir,
        '--silent',
        '.',
      ],
      { cwd: root },
    );
    if (result.status && result.status !== 0 && result.status !== 1) {
      throw new Error(result.stderr || `jscpd exited ${result.status}`);
    }
    const report = JSON.parse(await readFile(path.join(outputDir, 'jscpd-report.json'), 'utf8'));
    const duplicates = report.duplicates ?? [];
    const pairs = [
      ...new Set(
        duplicates.map(item => {
          const left = repoPathFromClone(item.firstFile?.name ?? '', root);
          const right = repoPathFromClone(item.secondFile?.name ?? '', root);
          return clonePairKey(left, right);
        }),
      ),
    ].sort();
    return {
      duplicatedLines: report.statistics?.total?.duplicatedLines ?? 0,
      percentage: report.statistics?.total?.percentage ?? 0,
      pairs,
    };
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
}

export async function collectViolations(root = REPO_ROOT) {
  const result = runBin(
    'depcruise',
    ['--config', '.dependency-cruiser.mjs', '--output-type', 'json', '--progress', 'none', ...CRUISE_TARGETS],
    { cwd: root },
  );
  if (result.error) throw result.error;
  if (result.status && result.status !== 0 && result.status !== 1) {
    throw new Error(result.stderr || `depcruise exited ${result.status}`);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed.summary?.violations ?? [];
}

export async function collectSnapshot(root = REPO_ROOT) {
  const files = await listSourceFiles(root);
  const fileSizes = await collectFileSizes(files, root);
  const complexity = await collectComplexity(files, root);
  const duplication = await collectDuplication(root);
  const violations = await collectViolations(root);
  return { files, fileSizes, complexity, duplication, violations };
}

export async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (fallback !== undefined && error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}
