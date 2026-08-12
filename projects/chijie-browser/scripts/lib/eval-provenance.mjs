import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const PROJECT_PREFIX = 'projects/chijie-browser';
export const EVAL_ARM_FIELDS = [
  'git_sha',
  'model',
  'provider',
  'provider_base_url',
  'feature_flags_hash',
  'prompt_version',
  'policy_tag',
  'attach_mode',
];
const SAFE_CAMPAIGN_STAMP = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,62}[A-Za-z0-9])?$/;
const SAFE_TASK_ID = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export function assertSafeCampaignStamp(value) {
  const stamp = String(value || '');
  if (!SAFE_CAMPAIGN_STAMP.test(stamp) || stamp === '.' || stamp === '..') {
    throw new Error(`unsafe campaign stamp=${stamp || '<empty>'}`);
  }
  return stamp;
}

export function assertSafeEvalTaskId(value) {
  const taskId = String(value || '');
  if (!SAFE_TASK_ID.test(taskId) || taskId === '.' || taskId === '..') {
    throw new Error(`unsafe eval task id=${taskId || '<empty>'}`);
  }
  return taskId;
}

export function evalArmTuple(input) {
  return Object.fromEntries(EVAL_ARM_FIELDS.map(field => [field, String(input?.[field] ?? '')]));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function computeEvalArmHash(input) {
  return sha256(`chijie-eval-arm-v1\0${canonicalJson(evalArmTuple(input))}`);
}

export function computeEvalRunId({ campaignStamp, taskId, attempt }) {
  const campaign = assertSafeCampaignStamp(campaignStamp);
  const task = assertSafeEvalTaskId(taskId);
  const runAttempt = Number(attempt);
  if (!Number.isInteger(runAttempt) || runAttempt < 1) throw new Error(`invalid eval attempt=${attempt}`);
  return sha256(`chijie-eval-run-v1\0${campaign}\0${task}\0${runAttempt}`);
}

export function expectedRunEvidenceRelativeDir(campaignStamp, taskId, attempt) {
  const campaign = assertSafeCampaignStamp(campaignStamp);
  const task = assertSafeEvalTaskId(taskId);
  const runAttempt = Number(attempt);
  if (!Number.isInteger(runAttempt) || runAttempt < 1) throw new Error(`invalid eval attempt=${attempt}`);
  return path.posix.join('reports/nanobrowser/eval/artifacts', campaign, task, `attempt-${runAttempt}`);
}

export function evalTrustKeyPath(homeDirectory = os.homedir()) {
  return path.join(homeDirectory, '.config', 'chijie', 'eval-trust.key');
}

function decodeTrustKey(text) {
  const encoded = String(text || '').trim();
  if (!/^[0-9a-f]{64}$/.test(encoded)) throw new Error('eval trust key is malformed');
  return Buffer.from(encoded, 'hex');
}

export async function ensureEvalTrustKey(homeDirectory = os.homedir()) {
  const keyPath = evalTrustKeyPath(homeDirectory);
  await mkdir(path.dirname(keyPath), { recursive: true, mode: 0o700 });
  try {
    await writeFile(keyPath, `${randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  await chmod(keyPath, 0o600);
  return readEvalTrustKey(homeDirectory);
}

export async function readEvalTrustKey(homeDirectory = os.homedir()) {
  const keyPath = evalTrustKeyPath(homeDirectory);
  const info = await stat(keyPath);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw new Error(`eval trust key must be a regular 0600 file: ${keyPath}`);
  }
  return decodeTrustKey(await readFile(keyPath, 'utf8'));
}

export function evalTrustKeyId(key) {
  return sha256(Buffer.from(key));
}

export function signEvalPayload(payload, key, signatureField) {
  if (!signatureField) throw new Error('signature field is required');
  const unsigned = { ...payload, trust_key_id: evalTrustKeyId(key) };
  delete unsigned[signatureField];
  return {
    ...unsigned,
    [signatureField]: createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex'),
  };
}

export function verifyEvalPayloadSignature(payload, key, signatureField) {
  const actual = String(payload?.[signatureField] || '');
  if (!/^[0-9a-f]{64}$/.test(actual) || payload?.trust_key_id !== evalTrustKeyId(key)) return false;
  const unsigned = { ...payload };
  delete unsigned[signatureField];
  const expected = createHmac('sha256', key).update(canonicalJson(unsigned)).digest('hex');
  return timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}

const PUBLIC_VERIFIERS = {
  '013-A01': 'body_contains',
  '013-A02': 'body_contains',
  '013-A03': 'url_contains',
  '013-B01': 'url_starts_with',
  '013-B02': 'media_paused',
  '013-B03': 'media_playing',
  '013-B04': 'url_starts_with',
  '013-B05': 'url_contains',
  '013-B06': 'url_contains',
  '013-B07': 'url_contains',
  '013-B08': 'scroll_bottom',
  '021-LH-01': 'url_and_page_text',
  '021-LH-02': 'url_and_page_text',
  '021-LH-03': 'products_extract',
  '021-LH-04': 'multi_source_delivery',
  '022-SKILL-01': 'products_extract',
};

const UNIT_SUITES = {
  '022-KERNEL-01': ['src/background/browser/kernel/__tests__/022-kernel-parity.test.ts'],
  '022-DIFF-01': [
    'src/background/browser/kernel/__tests__/022-diff-payload.test.ts',
    'src/background/browser/kernel/__tests__/diff.test.ts',
  ],
  '022-SKILL-02': ['src/background/agent/skills/__tests__/skill-fallback.test.ts'],
  '022-VERIFY-01': ['src/background/task/__tests__/022-verify-artifact-gates.test.ts'],
  '022-ARTIFACT-01': ['src/background/task/__tests__/022-verify-artifact-gates.test.ts'],
  '022-LEARN-01': [],
};

/** Commit-versioned registry binding a task id to its only accepted evaluator. */
export function expectedEvaluatorContract(taskId) {
  if (PUBLIC_VERIFIERS[taskId]) {
    return {
      runner: ['chrome-extension/scripts/eval-public-task.mjs'],
      verifier: PUBLIC_VERIFIERS[taskId],
      gateable: true,
    };
  }
  if (taskId === '018-O1' || taskId === '013-C01' || taskId === '015-J-CONT-01') {
    return {
      runner: ['chrome-extension/scripts/action-agent-e2e.mjs'],
      verifier: 'action_scenarios',
      gateable: true,
    };
  }
  if (taskId === '018-R1') {
    return {
      runner: ['chrome-extension/scripts/r1-extract-e2e.mjs'],
      verifier: 'products_extract',
      gateable: true,
    };
  }
  if (Object.hasOwn(UNIT_SUITES, taskId)) {
    return {
      runner: ['scripts/eval-022-unit-gates.mjs'],
      verifier: 'unit',
      gateable: taskId !== '022-LEARN-01',
      suite_files: UNIT_SUITES[taskId],
    };
  }
  if (/^F[1-8]$/.test(taskId)) {
    return {
      runner: ['chrome-extension/scripts/eval-frontier-task.mjs'],
      verifier: 'untrusted_frontier',
      gateable: false,
    };
  }
  throw new Error(`task is absent from evaluator registry: ${taskId}`);
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function runGit(scionRoot, args, { encoding = 'utf8' } = {}) {
  const result = spawnSync('git', args, {
    cwd: scionRoot,
    encoding,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${String(result.stderr || '').trim()}`);
  }
  return result.stdout;
}

export function readGitIdentity(scionRoot) {
  return {
    git_sha: String(runGit(scionRoot, ['rev-parse', 'HEAD'])).trim(),
    git_branch: String(runGit(scionRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(),
  };
}

export function gitTreeEntries(scionRoot, gitSha, prefix = PROJECT_PREFIX) {
  const output = String(runGit(scionRoot, ['ls-tree', '-r', '--full-tree', '-z', gitSha, '--', prefix]));
  return output
    .split('\0')
    .filter(Boolean)
    .map(record => {
      const match = /^(\d+)\s+(\S+)\s+([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
      if (!match) throw new Error(`malformed git tree entry: ${record.slice(0, 120)}`);
      return { mode: match[1], type: match[2], object: match[3], path: match[4] };
    });
}

function hashTreeEntries(entries) {
  const hash = createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${entry.mode}\0${entry.type}\0${entry.object}\0${entry.path}\0`);
  }
  return hash.digest('hex');
}

export function sourceHashAtCommit(scionRoot, gitSha) {
  const entries = gitTreeEntries(scionRoot, gitSha);
  if (entries.length === 0) throw new Error(`no tracked source at ${gitSha}`);
  return hashTreeEntries(entries);
}

export function evaluatorPrefixes({ runner = [], verifier = '', taskId = '', suiteFiles = [] } = {}) {
  const prefixes = new Set([
    `${PROJECT_PREFIX}/scripts/eval-matrix.mjs`,
    `${PROJECT_PREFIX}/scripts/eval-gate.mjs`,
    `${PROJECT_PREFIX}/scripts/lib/eval-gate.mjs`,
    `${PROJECT_PREFIX}/scripts/lib/eval-harness.mjs`,
    `${PROJECT_PREFIX}/scripts/lib/eval-provenance.mjs`,
    `${PROJECT_PREFIX}/chrome-extension/scripts/lib/eval-provider.mjs`,
    `${PROJECT_PREFIX}/chrome-extension/scripts/lib/eval-verification.mjs`,
    `${PROJECT_PREFIX}/chrome-extension/scripts/lib/eval-trace-evidence.mjs`,
  ]);
  for (const file of runner) prefixes.add(`${PROJECT_PREFIX}/${String(file).replace(/^\/+/, '')}`);
  for (const file of suiteFiles) {
    prefixes.add(`${PROJECT_PREFIX}/chrome-extension/${String(file).replace(/^\/+/, '')}`);
  }
  if (runner.some(file => String(file).includes('action-agent-e2e'))) {
    for (const fixture of ['form.html', 'products.html', 'media.html']) {
      prefixes.add(`${PROJECT_PREFIX}/chrome-extension/test/fixtures/${fixture}`);
    }
  }
  if (runner.some(file => String(file).includes('r1-extract-e2e')) || verifier === 'products_extract') {
    prefixes.add(`${PROJECT_PREFIX}/chrome-extension/test/fixtures/products.html`);
  }
  if (runner.some(file => String(file).includes('eval-frontier-task')) || /^F\d+$/.test(taskId)) {
    prefixes.add(`${PROJECT_PREFIX}/chrome-extension/test/fixtures/frontier/`);
  }
  return [...prefixes].sort();
}

export function evaluatorHashAtCommit(scionRoot, gitSha, input) {
  const prefixes = evaluatorPrefixes(input);
  const entries = gitTreeEntries(scionRoot, gitSha).filter(entry =>
    prefixes.some(prefix => entry.path === prefix || (prefix.endsWith('/') && entry.path.startsWith(prefix))),
  );
  const missing = prefixes.filter(
    prefix => !entries.some(entry => entry.path === prefix || (prefix.endsWith('/') && entry.path.startsWith(prefix))),
  );
  if (missing.length > 0) throw new Error(`evaluator files missing at ${gitSha}: ${missing.join(',')}`);
  return { hash: hashTreeEntries(entries), prefixes };
}

export function taskDefinitionHashAtCommit(scionRoot, gitSha, taskId) {
  const matrix = gitTreeEntries(scionRoot, gitSha).find(
    entry => entry.path === `${PROJECT_PREFIX}/scripts/eval-matrix.mjs`,
  );
  if (!matrix) throw new Error(`eval-matrix missing at ${gitSha}`);
  return sha256(`task-definition-v1\0${taskId}\0${matrix.object}`);
}

export async function listFiles(root) {
  const files = [];
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink is forbidden in attested files: ${entryPath}`);
      if (entry.isDirectory()) await visit(entryPath);
      else if (entry.isFile()) files.push(entryPath);
    }
  }
  await visit(root);
  return files.sort();
}

export async function assertRealpathContained(root, candidate) {
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`realpath escapes workspace: ${candidate}`);
  }
  return realCandidate;
}

export async function fileAttestations(scionRoot, files) {
  const out = [];
  for (const file of [...new Set(files.map(item => path.resolve(item)))].sort()) {
    const realFile = await assertRealpathContained(scionRoot, file);
    const info = await stat(realFile);
    if (!info.isFile()) throw new Error(`attested path is not a file: ${file}`);
    out.push({
      path: path.relative(scionRoot, realFile).replaceAll(path.sep, '/'),
      sha256: sha256(await readFile(realFile)),
      size: info.size,
    });
  }
  return out;
}

async function runtimeCriticalFiles(projectRoot) {
  const distRoot = path.join(projectRoot, 'dist');
  const manifest = JSON.parse(await readFile(path.join(distRoot, 'manifest.json'), 'utf8'));
  const files = new Set(['manifest.json']);
  const add = value => {
    if (!value) return;
    const normalized = path.posix.normalize(String(value).replace(/^\.\//, ''));
    if (path.posix.isAbsolute(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`runtime entry escapes dist: ${value}`);
    }
    files.add(normalized);
  };
  add(manifest?.background?.service_worker);
  add(manifest?.side_panel?.default_path);
  add(manifest?.options_page);
  add(manifest?.options_ui?.page);
  add(manifest?.action?.default_popup);
  for (const entry of manifest?.content_scripts || []) {
    for (const file of [...(entry?.js || []), ...(entry?.css || [])]) add(file);
  }
  const visitedHtml = new Set();
  for (;;) {
    const htmlPath = [...files].find(file => file.endsWith('.html') && !visitedHtml.has(file));
    if (!htmlPath) break;
    visitedHtml.add(htmlPath);
    const html = await readFile(path.join(distRoot, htmlPath), 'utf8');
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      if (/^(?:https?:|data:|#)/.test(match[1])) continue;
      add(path.posix.join(path.posix.dirname(htmlPath), match[1]));
    }
  }
  return [...files].sort();
}

export function hashAttestedFiles(files) {
  const hash = createHash('sha256');
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(`${file.path}\0${file.sha256}\0${file.size}\0`);
  }
  return hash.digest('hex');
}

export async function distAttestation(scionRoot, projectRoot) {
  const files = await fileAttestations(scionRoot, await listFiles(path.join(projectRoot, 'dist')));
  if (files.length === 0) throw new Error('dist is empty');
  const runtimeFiles = await runtimeCriticalFiles(projectRoot);
  for (const runtimeFile of runtimeFiles) {
    if (!files.some(file => file.path.endsWith(`/dist/${runtimeFile}`))) {
      throw new Error(`runtime critical file missing from dist: ${runtimeFile}`);
    }
  }
  return { hash: hashAttestedFiles(files), files, runtime_files: runtimeFiles };
}

export async function rebuildDistAndAttest(scionRoot, projectRoot) {
  const result = spawnSync('pnpm', ['build'], {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(`trusted rebuild failed: ${String(result.stderr || result.stdout).slice(-1000)}`);
  const status = readWorkspaceStatus(scionRoot);
  if (status.blocking.length > 0) {
    throw new Error(`trusted rebuild changed source: ${status.blocking.map(item => item.path).join(',')}`);
  }
  return distAttestation(scionRoot, projectRoot);
}

function runChecked(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const diagnostic = String(result.stderr || result.stdout || '')
      .trim()
      .slice(-1200);
    throw new Error(`${label} failed (${result.status ?? 'signal'}): ${diagnostic}`);
  }
  return result;
}

async function prepareTrustedCommitCheckout({ worktreeRoot }) {
  const projectRoot = path.join(worktreeRoot, PROJECT_PREFIX);
  runChecked('pnpm', ['install', '--offline', '--frozen-lockfile'], projectRoot, 'offline frozen install');
  const dist = await rebuildDistAndAttest(worktreeRoot, projectRoot);
  return { worktreeRoot, projectRoot, dist };
}

/**
 * Materialize a recorded commit in an isolated detached worktree, prepare it,
 * run one callback while it exists, and remove only that exact temporary tree.
 */
export async function withTrustedCommitCheckout(
  scionRoot,
  gitSha,
  callback,
  { prepare = prepareTrustedCommitCheckout } = {},
) {
  if (!/^[0-9a-f]{40}$/.test(String(gitSha || ''))) throw new Error(`invalid baseline git sha=${gitSha || '<empty>'}`);
  const resolvedCommit = String(runGit(scionRoot, ['rev-parse', '--verify', `${gitSha}^{commit}`])).trim();
  if (resolvedCommit !== gitSha) throw new Error(`baseline git sha did not resolve exactly: ${gitSha}`);
  const tempParent = await mkdtemp(path.join(os.tmpdir(), 'chijie-eval-baseline-'));
  const worktreeRoot = path.join(tempParent, 'worktree');
  let added = false;
  let primaryError;
  let cleanupError;
  let callbackResult;
  try {
    runChecked('git', ['worktree', 'add', '--detach', worktreeRoot, gitSha], scionRoot, 'git worktree add');
    added = true;
    const prepared = await prepare({ worktreeRoot, gitSha });
    callbackResult = await callback({ worktreeRoot, gitSha, ...prepared });
  } catch (error) {
    primaryError = error;
  } finally {
    if (added) {
      const removal = spawnSync('git', ['worktree', 'remove', '--force', worktreeRoot], {
        cwd: scionRoot,
        encoding: 'utf8',
      });
      if (removal.status !== 0) {
        cleanupError = new Error(`temporary worktree cleanup failed: ${String(removal.stderr || '').trim()}`);
      }
    }
    await rm(tempParent, { recursive: true, force: true });
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
  return callbackResult;
}

export function parseGitStatusPorcelain(output) {
  return String(output || '')
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => ({ code: line.slice(0, 2), path: line.slice(3).replace(/^"|"$/g, '') }));
}

export function classifyWorkspaceStatus(entries) {
  const allowedUntracked = [];
  const blocking = [];
  for (const entry of entries) {
    if (entry.code === '??' && /^(?:\.omo\/|clicky\/|reports\/)/.test(entry.path)) {
      allowedUntracked.push(entry.path);
    } else {
      blocking.push(entry);
    }
  }
  return { allowedUntracked, blocking };
}

export function readWorkspaceStatus(scionRoot) {
  const tracked = runGit(scionRoot, ['status', '--porcelain', '--untracked-files=no']);
  // `--directory` also reports empty, untrackable folders. Only real files can
  // change a committed build, so keep the file-level list here.
  const untracked = String(runGit(scionRoot, ['ls-files', '--others', '--exclude-standard', '-z']))
    .split('\0')
    .filter(Boolean)
    .map(file => `?? ${file}`)
    .join('\n');
  const output = `${tracked}${tracked && untracked ? '\n' : ''}${untracked}`;
  return classifyWorkspaceStatus(parseGitStatusPorcelain(output));
}
