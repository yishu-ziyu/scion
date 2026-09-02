#!/usr/bin/env node
/**
 * EPIC A2 — deterministic runtime environment snapshot (JSON on stdout).
 *
 * Privacy: never emit API keys, usernames, or absolute home paths.
 * chromePath is redacted: /Users/<name>/... or /home/<name>/... -> ~/<rest>.
 * Warnings go to stderr; stdout stays pure JSON for `pnpm baseline:env`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function warn(message) {
  console.warn(`[baseline:env] ${message}`);
}

function gitSha() {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout?.trim()) {
    warn('git rev-parse HEAD failed; reporting "unknown"');
    return 'unknown';
  }
  return result.stdout.trim();
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).version ?? null;
  } catch {
    warn('root package.json unreadable; packageVersion=null');
    return null;
  }
}

/**
 * manifest.js declares `version: packageJson.version` (root package.json).
 * ponytail: text-parse instead of importing (import needs cwd=chrome-extension + deps);
 * upgrade path: spawn `node -e import('./manifest.js')` if the manifest ever gains its own version.
 */
function manifestVersion(rootVersion) {
  try {
    const source = readFileSync(path.join(REPO_ROOT, 'chrome-extension', 'manifest.js'), 'utf8');
    if (/version:\s*packageJson\.version/.test(source)) return rootVersion;
    const literal = source.match(/version:\s*["']([^"']+)["']/);
    if (literal) return literal[1];
    warn('manifest.js has no resolvable version literal; manifestVersion=null');
    return null;
  } catch {
    warn('chrome-extension/manifest.js unreadable; manifestVersion=null');
    return null;
  }
}

function redactHome(absolutePath) {
  if (!absolutePath) return null;
  const home = os.homedir();
  if (home && (absolutePath === home || absolutePath.startsWith(home + path.sep))) {
    return '~/' + absolutePath.slice(home.length + 1).split(path.sep).join('/');
  }
  // Foreign username segment (e.g. running under another account): generic mask.
  return absolutePath.replace(/(^|\/)(Users|home)(\/[^/]+)/, '$1$2/<home>');
}

function resolveChromePath() {
  const explicit = process.env.CHROME_PATH || '';
  if (explicit) {
    if (!existsSync(explicit)) {
      warn(`CHROME_PATH set but missing: ${redactHome(explicit) ?? explicit}`);
      return { chromePath: redactHome(explicit), usable: false };
    }
    return { chromePath: redactHome(explicit), usable: true };
  }
  const candidates = [
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  const found = candidates.find(candidate => existsSync(candidate));
  if (!found) {
    warn('no Chrome path: set CHROME_PATH (or install Chrome for Testing) to populate chromePath/chromeVersion');
    return { chromePath: null, usable: false };
  }
  return { chromePath: redactHome(found), usable: true };
}

function chromeVersion(usablePath) {
  if (!usablePath) return null;
  const result = spawnSync(usablePath, ['--version'], { encoding: 'utf8', timeout: 5_000 });
  const out = (result.stdout || '').trim();
  if (result.status !== 0 || !out) {
    warn('chrome --version failed; chromeVersion=null');
    return null;
  }
  return out;
}

function pnpmVersion() {
  const result = spawnSync('pnpm', ['--version'], { encoding: 'utf8', cwd: REPO_ROOT, timeout: 10_000 });
  if (result.status === 0 && result.stdout?.trim()) return result.stdout.trim();
  try {
    const declared = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).packageManager;
    if (declared) {
      warn('pnpm binary not runnable; reporting packageManager field');
      return String(declared);
    }
  } catch {
    /* fall through */
  }
  warn('pnpm version unavailable; reporting null');
  return null;
}

const rootVersion = packageVersion();
const { chromePath, usable } = resolveChromePath();

const snapshot = {
  gitSha: gitSha(),
  node: process.version,
  pnpm: pnpmVersion(),
  packageVersion: rootVersion,
  manifestVersion: manifestVersion(rootVersion),
  platform: process.platform,
  chromePath,
  chromeVersion: chromeVersion(usable ? chromePath : null),
  protocolVersion: 'legacy',
};

const json = JSON.stringify(snapshot, null, 2);
// Self-check: stdout must always be parseable JSON (EPIC A2 acceptance).
const reparsed = JSON.parse(json);
for (const key of Object.keys(snapshot)) {
  if (JSON.stringify(reparsed[key]) !== JSON.stringify(snapshot[key])) {
    throw new Error(`self-check failed for key ${key}`);
  }
}
if (json.includes(os.homedir())) throw new Error('self-check failed: home path leaked into snapshot');
process.stdout.write(json + '\n');
