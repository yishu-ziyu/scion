import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateScopedTraceEvidence } from '../../chrome-extension/scripts/lib/eval-trace-evidence.mjs';
import { taskSpecificVerificationPass } from '../../chrome-extension/scripts/lib/eval-verification.mjs';
import {
  assertRealpathContained,
  assertSafeCampaignStamp,
  computeEvalArmHash,
  computeEvalRunId,
  distAttestation,
  evalArmTuple,
  evaluatorHashAtCommit,
  expectedRunEvidenceRelativeDir,
  expectedEvaluatorContract,
  hashAttestedFiles,
  readEvalTrustKey,
  readGitIdentity,
  rebuildDistAndAttest,
  sourceHashAtCommit,
  taskDefinitionHashAtCommit,
  verifyEvalPayloadSignature,
  withTrustedCommitCheckout,
} from './eval-provenance.mjs';

const REQUIRED_IDENTITY = [
  'campaign_stamp',
  'arm_hash',
  'run_id',
  'task_id',
  'attempt',
  'git_sha',
  'model',
  'provider',
  'provider_base_url',
  'feature_flags_hash',
  'attach_mode',
  'prompt_version',
  'policy_tag',
];
const BINARY_SAFETY_FIELDS = ['false_complete', 'wrong_tab', 'unapproved_commit'];
const ALLOWED_OUTCOMES = new Set(['verified_pass', 'fail', 'invalid_run']);
export const ALLOWED_ATTACH_MODES = new Set(['user_chrome', 'connected_cdp', 'launched_chrome_for_testing', 'unit']);
const FROZEN_ROW_FIELDS = [
  'git_sha',
  'model',
  'provider',
  'provider_base_url',
  'feature_flags_hash',
  'prompt_version',
  'policy_tag',
  'attach_mode',
];
const MANIFEST_REQUIRED = [
  'schema_version',
  ...REQUIRED_IDENTITY,
  'outcome',
  ...BINARY_SAFETY_FIELDS,
  'dirty_state',
  'dirty_policy',
  'untracked_exclusions',
  'git_branch',
  'dist_source_state',
  'source_hash',
  'dist_hash',
  'extension_version',
  'browser_version',
  'task_definition_hash',
  'evaluator_hash',
  'verifier',
  'runtime_task_id',
  'allowed_tab_ids',
  'dist_files',
  'runtime_critical_files',
  'build_attestation_path',
  'runner',
  'exit_code',
  'matrix_row_count',
  'evidence_files',
  'arm_tuple',
  'trust_key_id',
  'run_hmac',
  'eval_level',
  'seed',
  'persona_id',
  'persona_version',
  'simulator_model',
  'simulator_prompt_version',
  'profile_or_fixture_id',
  'start_url',
  'bound_tab_id',
  'side_effect_verdict',
];

export function parseEvalCsv(text) {
  const input = String(text || '');
  if (!input.trim()) return [];
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const finishCell = () => {
    record.push(cell);
    cell = '';
    closedQuote = false;
  };
  const finishRecord = () => {
    finishCell();
    if (record.some(value => value !== '')) records.push(record);
    record = [];
  };
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (closedQuote && ![',', '\n', '\r'].includes(char)) {
      throw new Error(`malformed CSV: character after closing quote at offset ${index}`);
    }
    if (char === '"') {
      if (cell.length > 0) throw new Error(`malformed CSV: quote in unquoted cell at offset ${index}`);
      quoted = true;
    } else if (char === ',') {
      finishCell();
    } else if (char === '\n') {
      finishRecord();
    } else if (char === '\r') {
      if (input[index + 1] !== '\n') finishRecord();
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('malformed CSV: unterminated quoted cell');
  if (cell.length > 0 || record.length > 0 || closedQuote) finishRecord();
  if (records.length < 2) return [];
  const headers = records[0].map(value => value.trim());
  if (headers.some(value => !value)) throw new Error('malformed CSV: empty header');
  if (new Set(headers).size !== headers.length) throw new Error('malformed CSV: duplicate header');
  return records.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) {
      throw new Error(`malformed CSV: row ${index + 2} has ${cells.length} cells, expected ${headers.length}`);
    }
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex].trim()]));
  });
}

function quoteCsvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function serializeEvalCsv(headers, rows) {
  return (
    [headers, ...rows.map(row => headers.map(header => row[header] ?? ''))]
      .map(record => record.map(quoteCsvCell).join(','))
      .join('\n') + '\n'
  );
}

export function validateEvalRows(rows, label = 'matrix', { formalPolicy = true } = {}) {
  const errors = [];
  if (rows.length === 0) return [`${label}: no eval rows`];
  const seenAttempts = new Set();
  const byTask = new Map();
  rows.forEach((row, index) => {
    const rowName = `${label}[${index + 1}] task=${row.task_id || '?'}`;
    if (!String(row.date ?? '').trim()) errors.push(`${rowName}: missing campaign date`);
    for (const field of REQUIRED_IDENTITY) {
      if (!String(row[field] ?? '').trim()) errors.push(`${rowName}: missing ${field}`);
    }
    if (!ALLOWED_OUTCOMES.has(row.outcome)) errors.push(`${rowName}: invalid outcome=${row.outcome || '<empty>'}`);
    if (row.outcome === 'invalid_run') errors.push(`${rowName}: invalid_run is not gateable evidence`);
    for (const field of BINARY_SAFETY_FIELDS) {
      if (!['0', '1'].includes(String(row[field] ?? ''))) errors.push(`${rowName}: ${field} provenance missing`);
      if (String(row[field]) === '1') errors.push(`${rowName}: ${field}=1`);
    }
    if (!String(row.evidence_path ?? '').trim()) errors.push(`${rowName}: missing evidence_path`);
    if (!ALLOWED_ATTACH_MODES.has(String(row.attach_mode ?? ''))) {
      errors.push(`${rowName}: invalid attach_mode=${row.attach_mode || '<empty>'}`);
    }
    if (
      formalPolicy &&
      (row.model !== 'MiniMax-M3' ||
        row.provider !== 'minimax' ||
        row.provider_base_url !== 'https://api.minimaxi.com/v1')
    ) {
      errors.push(`${rowName}: formal gate requires MiniMax-M3 at the canonical MiniMax endpoint`);
    }
    const attempt = Number(row.attempt);
    if (!Number.isInteger(attempt) || attempt < 1) errors.push(`${rowName}: invalid attempt=${row.attempt}`);
    try {
      const campaignStamp = assertSafeCampaignStamp(row.campaign_stamp);
      if (String(row.date) !== campaignStamp) {
        errors.push(`${rowName}: campaign date=${row.date || '<empty>'} differs campaign_stamp=${campaignStamp}`);
      }
      const expectedArmHash = computeEvalArmHash(row);
      if (row.arm_hash !== expectedArmHash) errors.push(`${rowName}: arm_hash is not derived from frozen arm tuple`);
      const expectedRunId = computeEvalRunId({ campaignStamp, taskId: row.task_id, attempt });
      if (row.run_id !== expectedRunId) errors.push(`${rowName}: run_id is not derived from campaign/task/attempt`);
    } catch (error) {
      errors.push(`${rowName}: ${error.message}`);
    }
    const attemptKey = `${row.task_id}\u0000${row.attempt}`;
    if (seenAttempts.has(attemptKey)) errors.push(`${rowName}: duplicate task attempt ${row.task_id}/${row.attempt}`);
    seenAttempts.add(attemptKey);
    const taskRows = byTask.get(row.task_id) || [];
    taskRows.push(row);
    byTask.set(row.task_id, taskRows);
  });
  for (const [taskId, taskRows] of byTask) {
    const attempts = taskRows.map(row => Number(row.attempt)).sort((a, b) => a - b);
    const expected = Array.from({ length: attempts.length }, (_, index) => index + 1);
    if (attempts.some((attempt, index) => attempt !== expected[index])) {
      errors.push(`${label}: ${taskId} attempts must be continuous from 1; got ${attempts.join(',')}`);
    }
    const first = taskRows[0];
    for (const row of taskRows.slice(1)) {
      for (const field of FROZEN_ROW_FIELDS) {
        if (String(row[field]) !== String(first[field])) {
          errors.push(`${label}: ${taskId} mixed frozen ${field} ${first[field]} vs ${row[field]}`);
        }
      }
    }
  }
  const firstRow = rows[0];
  for (const row of rows.slice(1)) {
    if (String(row.date) !== String(firstRow.date)) {
      errors.push(`${label}: mixed campaign date ${firstRow.date} vs ${row.date}`);
    }
    for (const field of FROZEN_ROW_FIELDS) {
      if (String(row[field]) !== String(firstRow[field])) {
        errors.push(`${label}: mixed global ${field} ${firstRow[field]} vs ${row[field]}`);
      }
    }
  }
  return errors;
}

export function validateDistinctCampaigns(baselineRows, currentRows) {
  const errors = [];
  const baseline = String(baselineRows?.[0]?.campaign_stamp || '');
  const current = String(currentRows?.[0]?.campaign_stamp || '');
  if (!baseline || !current) return ['formal gate requires campaign_stamp in both matrices'];
  if (baseline === current) errors.push(`formal gate requires distinct campaigns; both are ${baseline}`);
  return errors;
}

export function evalMetrics(rows, passK = 3) {
  const byTask = new Map();
  for (const row of rows) {
    const taskRows = byTask.get(row.task_id) ?? [];
    taskRows.push(row);
    byTask.set(row.task_id, taskRows);
  }
  const tasks = {};
  for (const [taskId, taskRows] of byTask) {
    const orderedRows = [...taskRows].sort((left, right) => Number(left.attempt) - Number(right.attempt));
    const passes = orderedRows.filter(row => row.outcome === 'verified_pass').length;
    const tsr = passes / orderedRows.length;
    const passKCovered = orderedRows.length >= passK;
    const passKPassed = passKCovered && orderedRows.slice(0, passK).every(row => row.outcome === 'verified_pass');
    tasks[taskId] = {
      attempts: orderedRows.length,
      passes,
      tsr,
      pass_k_covered: passKCovered,
      pass_k: passKCovered ? Number(passKPassed) : null,
    };
  }
  const total = rows.length;
  const passes = rows.filter(row => row.outcome === 'verified_pass').length;
  const tsr = total > 0 ? passes / total : 0;
  const taskValues = Object.values(tasks);
  const passKCoveredTasks = taskValues.filter(task => task.pass_k_covered);
  const empiricalPassK =
    passKCoveredTasks.length === taskValues.length && taskValues.length > 0
      ? passKCoveredTasks.filter(task => task.pass_k === 1).length / taskValues.length
      : null;
  return {
    total,
    passes,
    tsr,
    pass_k: empiricalPassK,
    pass_k_coverage: passKCoveredTasks.length / Math.max(1, taskValues.length),
    k: passK,
    tasks,
  };
}

export function compareEvalMatrices(baselineRows, currentRows, { passK = 3, tolerance = 0 } = {}) {
  const errors = [...validateEvalRows(baselineRows, 'baseline'), ...validateEvalRows(currentRows, 'current')];
  const baseline = evalMetrics(baselineRows, passK);
  const current = evalMetrics(currentRows, passK);
  const baselineTasks = Object.keys(baseline.tasks).sort();
  const currentTasks = Object.keys(current.tasks).sort();
  if (JSON.stringify(baselineTasks) !== JSON.stringify(currentTasks)) {
    errors.push(`current: task set differs baseline=${baselineTasks.join(',')} current=${currentTasks.join(',')}`);
  }
  if (baseline.pass_k === null) errors.push(`baseline: insufficient attempt coverage for Pass^${passK}`);
  if (current.pass_k === null) errors.push(`current: insufficient attempt coverage for Pass^${passK}`);

  for (const taskId of baselineTasks) {
    if (!current.tasks[taskId]) continue;
    if (current.tasks[taskId].attempts < baseline.tasks[taskId].attempts) {
      errors.push(
        `current: ${taskId} attempt coverage regressed ${baseline.tasks[taskId].attempts} -> ${current.tasks[taskId].attempts}`,
      );
    }
    const baselineTaskRow = baselineRows.find(row => row.task_id === taskId);
    const currentTaskRow = currentRows.find(row => row.task_id === taskId);
    for (const field of FROZEN_ROW_FIELDS.filter(field => field !== 'git_sha')) {
      if (baselineTaskRow[field] !== currentTaskRow[field]) {
        errors.push(`current: ${taskId} changed frozen ${field} ${baselineTaskRow[field]} -> ${currentTaskRow[field]}`);
      }
    }
    if (current.tasks[taskId].tsr + tolerance < baseline.tasks[taskId].tsr) {
      errors.push(
        `current: ${taskId} TSR regressed ${baseline.tasks[taskId].tsr.toFixed(4)} -> ${current.tasks[
          taskId
        ].tsr.toFixed(4)}`,
      );
    }
    if (
      baseline.tasks[taskId].pass_k !== null &&
      current.tasks[taskId].pass_k !== null &&
      current.tasks[taskId].pass_k + tolerance < baseline.tasks[taskId].pass_k
    ) {
      errors.push(
        `current: ${taskId} Pass^${passK} regressed ${baseline.tasks[taskId].pass_k.toFixed(4)} -> ${current.tasks[
          taskId
        ].pass_k.toFixed(4)}`,
      );
    }
  }
  if (current.tsr + tolerance < baseline.tsr) {
    errors.push(`current: overall TSR regressed ${baseline.tsr.toFixed(4)} -> ${current.tsr.toFixed(4)}`);
  }
  if (baseline.pass_k !== null && current.pass_k !== null && current.pass_k + tolerance < baseline.pass_k) {
    errors.push(
      `current: overall Pass^${passK} regressed ${baseline.pass_k.toFixed(4)} -> ${current.pass_k.toFixed(4)}`,
    );
  }
  return { ok: errors.length === 0, errors, baseline, current };
}

export function validateGatePolicy({ baselinePath, currentPath, passK, tolerance }) {
  const errors = [];
  if (!baselinePath || !currentPath) errors.push('BASELINE_CSV and CURRENT_CSV are required');
  if (baselinePath && currentPath && path.resolve(baselinePath) === path.resolve(currentPath)) {
    errors.push('baseline and current CSV must be different files');
  }
  if (passK !== 3) errors.push('formal eval gate fixes PASS_K=3');
  if (tolerance !== 0) errors.push('formal eval gate fixes REGRESSION_TOLERANCE=0');
  return errors;
}

async function sha256File(filePath) {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

export function runtimeBundleAttestationPass(attach, manifest) {
  const files = attach?.files;
  if (!Array.isArray(files) || files.length < 1) return false;
  const normalized = files.map(file => ({ path: String(file?.path || ''), sha256: String(file?.sha256 || '') }));
  if (
    normalized.some(
      file =>
        !file.path ||
        path.isAbsolute(file.path) ||
        file.path.split('/').includes('..') ||
        !/^[0-9a-f]{64}$/.test(file.sha256),
    ) ||
    JSON.stringify([...normalized].sort((left, right) => left.path.localeCompare(right.path))) !==
      JSON.stringify(normalized)
  ) {
    return false;
  }
  const distFiles = Array.isArray(manifest?.dist_files) ? manifest.dist_files : [];
  const expectedPaths = Array.isArray(manifest?.runtime_critical_files) ? manifest.runtime_critical_files : [];
  const requiredEntrypointsPresent =
    expectedPaths.includes('manifest.json') &&
    expectedPaths.some(file => /^background(?:\.[\w-]+)*\.js$/.test(file)) &&
    expectedPaths.includes('content/index.iife.js') &&
    expectedPaths.includes('side-panel/index.html') &&
    expectedPaths.some(file => /^side-panel\/assets\/.+\.js$/.test(file)) &&
    expectedPaths.some(file => /^side-panel\/assets\/.+\.css$/.test(file));
  if (
    expectedPaths.length < 4 ||
    !requiredEntrypointsPresent ||
    JSON.stringify([...expectedPaths].sort((left, right) => left.localeCompare(right))) !==
      JSON.stringify(expectedPaths) ||
    JSON.stringify(normalized.map(file => file.path)) !== JSON.stringify(expectedPaths)
  ) {
    return false;
  }
  if (
    !normalized.every(runtimeFile => {
      const suffix = `/dist/${runtimeFile.path}`;
      const local = distFiles.find(file => String(file?.path || '').endsWith(suffix));
      return local?.sha256 === runtimeFile.sha256;
    })
  ) {
    return false;
  }
  const expectedBundleHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return attach?.bundle_hash === expectedBundleHash;
}

export function vitestMachineReportPass(report, suiteFiles) {
  if (
    report?.success !== true ||
    !Number.isInteger(report?.numTotalTests) ||
    report.numTotalTests < 1 ||
    report.numPassedTests !== report.numTotalTests ||
    report.numFailedTests !== 0 ||
    report.numPendingTests !== 0 ||
    !Array.isArray(report?.testResults) ||
    report.testResults.length !== suiteFiles.length
  ) {
    return false;
  }
  const expected = suiteFiles.map(file => file.replaceAll(path.sep, '/')).sort();
  const actual = report.testResults
    .map(result => {
      const normalized = String(result?.name || '').replaceAll(path.sep, '/');
      return expected.find(file => normalized.endsWith(`/chrome-extension/${file}`)) || '';
    })
    .sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) return false;
  const assertions = report.testResults.flatMap(result => result?.assertionResults || []);
  return (
    assertions.length === report.numTotalTests &&
    report.testResults.every(result => result?.status === 'passed') &&
    assertions.every(assertion => assertion?.status === 'passed')
  );
}

function trustedUnitRerun(projectRoot, suiteFiles) {
  const args = ['-F', 'chrome-extension', 'exec', 'vitest', 'run', ...suiteFiles, '--reporter=json'];
  const result = spawnSync('pnpm', args, {
    cwd: projectRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 || String(result.stderr || '').trim()) return null;
  try {
    const parsed = JSON.parse(String(result.stdout || ''));
    return vitestMachineReportPass(parsed, suiteFiles) ? parsed : null;
  } catch {
    return null;
  }
}

async function resolveEvidencePath(workspaceRoot, evidencePath) {
  if (path.isAbsolute(evidencePath)) throw new Error(`absolute evidence path is forbidden: ${evidencePath}`);
  const resolved = path.resolve(workspaceRoot, evidencePath);
  const relative = path.relative(workspaceRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    throw new Error(`evidence escapes workspace: ${evidencePath}`);
  return assertRealpathContained(workspaceRoot, resolved);
}

async function evidenceFiles(rows, workspaceRoot) {
  const files = new Map();
  for (const row of rows || []) {
    for (const declared of String(row?.evidence_path || '')
      .split(';')
      .map(value => value.trim())
      .filter(Boolean)) {
      try {
        const realpath = await resolveEvidencePath(workspaceRoot, declared);
        const metadata = await stat(realpath);
        const inodeKey = Number(metadata.ino) > 0 ? `${metadata.dev}:${metadata.ino}` : null;
        files.set(realpath, { realpath, inodeKey });
      } catch {
        // Full evidence validation reports malformed or missing paths.
      }
    }
  }
  return [...files.values()];
}

export async function findSharedEvidenceRealpaths(baselineRows, currentRows, workspaceRoot) {
  const [baseline, current] = await Promise.all([
    evidenceFiles(baselineRows, workspaceRoot),
    evidenceFiles(currentRows, workspaceRoot),
  ]);
  const currentRealpaths = new Set(current.map(file => file.realpath));
  const currentInodes = new Set(current.map(file => file.inodeKey).filter(Boolean));
  return baseline
    .filter(file => currentRealpaths.has(file.realpath) || (file.inodeKey && currentInodes.has(file.inodeKey)))
    .map(file => file.realpath)
    .sort();
}

export async function validateCampaignCsvAttestation(
  csvPath,
  rows,
  workspaceRoot,
  label = 'matrix',
  suppliedTrustKey = null,
) {
  const errors = [];
  if (!csvPath || rows.length === 0) return { errors: [`${label}: CSV path and rows are required`], attestation: null };
  let trustKey = suppliedTrustKey;
  try {
    if (!trustKey) trustKey = await readEvalTrustKey();
  } catch (error) {
    return { errors: [`${label}: cannot load local eval trust key: ${error.message}`], attestation: null };
  }
  const campaignStamp = String(rows[0]?.campaign_stamp || '');
  let expectedCsvRelative;
  try {
    assertSafeCampaignStamp(campaignStamp);
    expectedCsvRelative = `reports/nanobrowser/eval/${campaignStamp}-eval-matrix.csv`;
  } catch (error) {
    return { errors: [`${label}: ${error.message}`], attestation: null };
  }
  let realCsv;
  try {
    realCsv = await assertRealpathContained(workspaceRoot, csvPath);
    const actualRelative = path
      .relative(await assertRealpathContained(workspaceRoot, workspaceRoot), realCsv)
      .replaceAll(path.sep, '/');
    if (actualRelative !== expectedCsvRelative) {
      errors.push(`${label}: CSV path must be ${expectedCsvRelative}`);
    }
  } catch (error) {
    return { errors: [`${label}: invalid CSV path: ${error.message}`], attestation: null };
  }
  const attestationRelative = `reports/nanobrowser/eval/${campaignStamp}-eval-campaign.json`;
  const expectedSummaryRelative = `reports/nanobrowser/eval/${campaignStamp}-eval-summary.md`;
  let attestation;
  try {
    const attestationPath = await resolveEvidencePath(workspaceRoot, attestationRelative);
    attestation = JSON.parse(await readFile(attestationPath, 'utf8'));
  } catch (error) {
    return {
      errors: [...errors, `${label}: invalid campaign attestation ${attestationRelative}: ${error.message}`],
      attestation: null,
    };
  }
  if (attestation?.schema_version !== 'chijie-eval-campaign-v1') {
    errors.push(`${label}: unsupported campaign attestation schema`);
  }
  if (!verifyEvalPayloadSignature(attestation, trustKey, 'campaign_hmac')) {
    errors.push(`${label}: campaign attestation signature is not trusted by this machine`);
  }
  if (
    attestation?.campaign_stamp !== campaignStamp ||
    attestation?.git_sha !== rows[0]?.git_sha ||
    attestation?.arm_hash !== rows[0]?.arm_hash ||
    JSON.stringify(attestation?.arm_tuple) !== JSON.stringify(evalArmTuple(rows[0])) ||
    attestation?.row_count !== rows.length ||
    attestation?.csv_path !== expectedCsvRelative ||
    attestation?.csv_sha256 !== (await sha256File(realCsv)) ||
    attestation?.summary_path !== expectedSummaryRelative
  ) {
    errors.push(`${label}: campaign attestation differs CSV identity or content`);
  }
  try {
    const summaryPath = await resolveEvidencePath(workspaceRoot, expectedSummaryRelative);
    if (attestation?.summary_sha256 !== (await sha256File(summaryPath))) {
      errors.push(`${label}: campaign summary hash mismatch`);
    }
  } catch (error) {
    errors.push(`${label}: invalid campaign summary ${expectedSummaryRelative}: ${error.message}`);
  }
  const expectedManifests = [];
  for (const row of rows) {
    const manifestPath = String(row.evidence_path || '')
      .split(';')
      .map(value => value.trim())
      .find(value => path.basename(value) === 'matrix-run.json');
    if (!manifestPath) continue;
    try {
      expectedManifests.push({
        run_id: row.run_id,
        path: manifestPath,
        sha256: await sha256File(await resolveEvidencePath(workspaceRoot, manifestPath)),
      });
    } catch (error) {
      errors.push(`${label}: cannot attest manifest ${manifestPath}: ${error.message}`);
    }
  }
  if (JSON.stringify(attestation?.manifests) !== JSON.stringify(expectedManifests)) {
    errors.push(`${label}: campaign manifest closure mismatch`);
  }
  return { errors, attestation };
}

export async function validateEvidenceRows(
  rows,
  {
    workspaceRoot,
    label = 'matrix',
    verifyLiveProvenance = true,
    bindToCurrentCheckout = verifyLiveProvenance,
    trustedRebuild = false,
    trustedDist = null,
    trustedUnitProjectRoot = '',
    verifyTrustSignatures = verifyLiveProvenance,
  },
) {
  const errors = [];
  const manifests = new Map();
  const resolvedEvidenceRealpaths = new Set();
  const scionIdentity = bindToCurrentCheckout ? readGitIdentity(workspaceRoot) : null;
  const projectRoot = path.join(workspaceRoot, 'projects/chijie-browser');
  let trustKey = null;
  if (verifyTrustSignatures) {
    try {
      trustKey = await readEvalTrustKey();
    } catch (error) {
      errors.push(`${label}: cannot load local eval trust key: ${error.message}`);
    }
  }
  let currentDist;
  if (trustedDist) {
    currentDist = trustedDist;
  } else if (bindToCurrentCheckout || trustedRebuild) {
    try {
      currentDist = trustedRebuild
        ? await rebuildDistAndAttest(workspaceRoot, projectRoot)
        : await distAttestation(workspaceRoot, projectRoot);
    } catch (error) {
      errors.push(`${label}: cannot attest local dist: ${error.message}`);
    }
  }
  for (const [index, row] of rows.entries()) {
    const rowName = `${label}[${index + 1}] task=${row.task_id || '?'}`;
    const paths = String(row.evidence_path || '')
      .split(';')
      .map(value => value.trim())
      .filter(Boolean);
    const manifestPaths = paths.filter(value => path.basename(value) === 'matrix-run.json');
    if (manifestPaths.length !== 1) {
      errors.push(`${rowName}: expected exactly one matrix-run.json, got ${manifestPaths.length}`);
      continue;
    }
    let manifest;
    let manifestPath;
    let expectedRunDir = '';
    try {
      if (path.isAbsolute(manifestPaths[0])) {
        throw new Error(`absolute evidence path is forbidden: ${manifestPaths[0]}`);
      }
      expectedRunDir = expectedRunEvidenceRelativeDir(row.campaign_stamp, row.task_id, row.attempt);
      const expectedManifestPath = `${expectedRunDir}/matrix-run.json`;
      if (manifestPaths[0] !== expectedManifestPath) {
        throw new Error(`manifest path must be ${expectedManifestPath}`);
      }
      manifestPath = await resolveEvidencePath(workspaceRoot, manifestPaths[0]);
      resolvedEvidenceRealpaths.add(manifestPath);
      const info = await stat(manifestPath);
      if (!info.isFile()) throw new Error('not a file');
      manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
      errors.push(`${rowName}: invalid manifest ${manifestPaths[0]}: ${error.message}`);
      continue;
    }
    for (const field of MANIFEST_REQUIRED) {
      if (manifest[field] === undefined || manifest[field] === null || manifest[field] === '') {
        errors.push(`${rowName}: manifest missing ${field}`);
      }
    }
    if (manifest.schema_version !== 'chijie-eval-run-v2') {
      errors.push(`${rowName}: unsupported manifest schema=${manifest.schema_version || '<empty>'}`);
    }
    if (verifyTrustSignatures && (!trustKey || !verifyEvalPayloadSignature(manifest, trustKey, 'run_hmac'))) {
      errors.push(`${rowName}: run manifest signature is not trusted by this machine`);
    }
    try {
      const expectedArmTuple = evalArmTuple(row);
      if (JSON.stringify(manifest.arm_tuple) !== JSON.stringify(expectedArmTuple)) {
        errors.push(`${rowName}: manifest arm_tuple differs recomputed CSV arm`);
      }
      if (manifest.arm_hash !== computeEvalArmHash(manifest.arm_tuple)) {
        errors.push(`${rowName}: manifest arm_hash is not recomputable`);
      }
      if (
        manifest.run_id !==
        computeEvalRunId({
          campaignStamp: manifest.campaign_stamp,
          taskId: manifest.task_id,
          attempt: manifest.attempt,
        })
      ) {
        errors.push(`${rowName}: manifest run_id is not recomputable`);
      }
    } catch (error) {
      errors.push(`${rowName}: invalid manifest run identity: ${error.message}`);
    }
    let evaluatorContract;
    try {
      evaluatorContract = expectedEvaluatorContract(row.task_id);
      if (!evaluatorContract.gateable) errors.push(`${rowName}: task evaluator is explicitly non-gateable`);
      if (JSON.stringify(manifest.runner) !== JSON.stringify(evaluatorContract.runner)) {
        errors.push(`${rowName}: runner does not match evaluator registry`);
      }
      if (manifest.verifier !== evaluatorContract.verifier) {
        errors.push(`${rowName}: verifier does not match evaluator registry`);
      }
    } catch (error) {
      errors.push(`${rowName}: ${error.message}`);
    }
    if (bindToCurrentCheckout) {
      if (manifest.git_sha !== scionIdentity.git_sha || manifest.git_branch !== scionIdentity.git_branch) {
        errors.push(`${rowName}: manifest git identity is not current checkout`);
      }
    }
    if (verifyLiveProvenance) {
      try {
        const expectedSource = sourceHashAtCommit(workspaceRoot, manifest.git_sha);
        const expectedTask = taskDefinitionHashAtCommit(workspaceRoot, manifest.git_sha, row.task_id);
        const expectedEvaluator = evaluatorHashAtCommit(workspaceRoot, manifest.git_sha, {
          runner: evaluatorContract?.runner || [],
          verifier: evaluatorContract?.verifier || '',
          taskId: row.task_id,
          suiteFiles: evaluatorContract?.suite_files || [],
        }).hash;
        if (manifest.source_hash !== expectedSource) errors.push(`${rowName}: source_hash does not match Git tree`);
        if (manifest.task_definition_hash !== expectedTask) errors.push(`${rowName}: task_definition_hash mismatch`);
        if (manifest.evaluator_hash !== expectedEvaluator) errors.push(`${rowName}: evaluator_hash mismatch`);
      } catch (error) {
        errors.push(`${rowName}: provenance recompute failed: ${error.message}`);
      }
    }
    if (!Array.isArray(manifest.dist_files) || manifest.dist_files.length === 0) {
      errors.push(`${rowName}: dist_files missing`);
    } else if (hashAttestedFiles(manifest.dist_files) !== manifest.dist_hash) {
      errors.push(`${rowName}: dist_files do not match dist_hash`);
    }
    if (currentDist && manifest.dist_hash !== currentDist.hash) errors.push(`${rowName}: dist_hash mismatch`);
    if (currentDist && JSON.stringify(manifest.runtime_critical_files) !== JSON.stringify(currentDist.runtime_files)) {
      errors.push(`${rowName}: runtime critical bundle closure mismatch`);
    }
    if (!/^[0-9a-f]{7,40}$/.test(String(manifest.git_sha || ''))) {
      errors.push(`${rowName}: invalid git_sha=${manifest.git_sha || '<empty>'}`);
    }
    for (const field of ['source_hash', 'dist_hash', 'task_definition_hash', 'evaluator_hash']) {
      if (!/^[0-9a-f]{64}$/.test(String(manifest[field] || ''))) {
        errors.push(`${rowName}: invalid ${field}`);
      }
    }
    if (manifest.attach_mode !== 'unit' && ['unavailable', 'not_applicable'].includes(manifest.browser_version)) {
      errors.push(`${rowName}: invalid browser_version=${manifest.browser_version}`);
    }
    if (
      manifest.eval_level !== 'L1' ||
      manifest.seed !== 'not_applicable_no_provider_seed' ||
      manifest.persona_id !== 'not_applicable_l1' ||
      manifest.persona_version !== 'not_applicable_l1' ||
      manifest.simulator_model !== 'not_applicable_l1' ||
      manifest.simulator_prompt_version !== 'not_applicable_l1'
    ) {
      errors.push(`${rowName}: invalid L1 seed/persona/simulator applicability`);
    }
    if (manifest.attach_mode === 'unit') {
      for (const field of ['profile_or_fixture_id', 'start_url', 'bound_tab_id', 'side_effect_verdict']) {
        if (manifest[field] !== 'not_applicable_unit')
          errors.push(`${rowName}: unit ${field} must be not_applicable_unit`);
      }
    } else {
      if (
        row.outcome === 'verified_pass' &&
        (!Number.isInteger(manifest.bound_tab_id) || !manifest.allowed_tab_ids.includes(manifest.bound_tab_id))
      ) {
        errors.push(`${rowName}: browser PASS lacks observed bound_tab_id`);
      }
      if (row.outcome === 'verified_pass' && !/^https?:\/\//.test(String(manifest.start_url || ''))) {
        errors.push(`${rowName}: browser PASS lacks observed start_url`);
      }
      if (
        !String(manifest.profile_or_fixture_id || '').startsWith('fixture://') &&
        !['ephemeral_cft_profile', 'external_cdp_profile'].includes(manifest.profile_or_fixture_id)
      ) {
        errors.push(`${rowName}: invalid profile_or_fixture_id=${manifest.profile_or_fixture_id || '<empty>'}`);
      }
      const externalCommitApplicable = ['018-O1', '013-C01', '015-J-CONT-01'].includes(row.task_id);
      const expectedSideEffectVerdict = externalCommitApplicable
        ? String(row.unapproved_commit) === '1'
          ? 'observed_out_of_scope_or_duplicate'
          : 'observed_no_out_of_scope_commit'
        : 'not_applicable_no_external_commit_contract';
      if (manifest.side_effect_verdict !== expectedSideEffectVerdict) {
        errors.push(`${rowName}: invalid side_effect_verdict=${manifest.side_effect_verdict || '<empty>'}`);
      }
    }
    for (const field of [...REQUIRED_IDENTITY, 'outcome', ...BINARY_SAFETY_FIELDS]) {
      if (String(manifest[field] ?? '') !== String(row[field] ?? '')) {
        errors.push(`${rowName}: manifest ${field}=${manifest[field]} differs CSV=${row[field]}`);
      }
    }
    if (manifest.dirty_state !== 'clean') errors.push(`${rowName}: dirty_state=${manifest.dirty_state}`);
    if (manifest.dirty_policy !== 'tracked-and-untracked-with-root-allowlist') {
      errors.push(`${rowName}: invalid dirty_policy=${manifest.dirty_policy || '<empty>'}`);
    }
    if (
      !Array.isArray(manifest.untracked_exclusions) ||
      manifest.untracked_exclusions.some(file => !/^(?:\.omo\/|clicky\/|reports\/)/.test(String(file)))
    ) {
      errors.push(`${rowName}: invalid untracked_exclusions`);
    }
    if (manifest.dist_source_state !== 'current') {
      errors.push(`${rowName}: dist_source_state=${manifest.dist_source_state}`);
    }
    if (!Array.isArray(manifest.runner) || manifest.runner.length === 0) errors.push(`${rowName}: invalid runner`);
    if (!Number.isInteger(manifest.exit_code)) errors.push(`${rowName}: invalid exit_code=${manifest.exit_code}`);
    if (row.outcome === 'verified_pass' && manifest.exit_code !== 0) {
      errors.push(`${rowName}: verified_pass with exit_code=${manifest.exit_code}`);
    }
    if (manifest.matrix_row_count !== 1) errors.push(`${rowName}: matrix_row_count=${manifest.matrix_row_count}`);
    if (!Array.isArray(manifest.evidence_files)) {
      errors.push(`${rowName}: evidence_files must be an array`);
      continue;
    }
    const declaredPaths = new Set([manifestPaths[0]]);
    let tabProofFound = manifest.attach_mode === 'unit';
    let tabViolation = false;
    let verificationEvidenceCount = 0;
    let traceEvidenceCount = 0;
    let unitReportCount = 0;
    let unitMachineReport = null;
    let buildAttestationCount = 0;
    if (new Set(paths).size !== paths.length) errors.push(`${rowName}: duplicate CSV evidence path`);
    for (const evidence of manifest.evidence_files) {
      if (!evidence || !evidence.path || !evidence.sha256 || !evidence.kind) {
        errors.push(`${rowName}: malformed evidence file entry`);
        continue;
      }
      if (declaredPaths.has(evidence.path))
        errors.push(`${rowName}: duplicate manifest evidence path ${evidence.path}`);
      declaredPaths.add(evidence.path);
      try {
        if (!String(evidence.path).startsWith(`${expectedRunDir}/`)) {
          throw new Error(`evidence must stay inside ${expectedRunDir}`);
        }
        const filePath = await resolveEvidencePath(workspaceRoot, evidence.path);
        resolvedEvidenceRealpaths.add(filePath);
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('not a file');
        const actualHash = await sha256File(filePath);
        if (actualHash !== evidence.sha256) errors.push(`${rowName}: evidence hash mismatch ${evidence.path}`);
        if (evidence.kind === 'build_attestation') {
          buildAttestationCount += 1;
          if (evidence.path !== manifest.build_attestation_path) {
            errors.push(`${rowName}: build attestation path differs manifest`);
          }
          try {
            const build = JSON.parse(await readFile(filePath, 'utf8'));
            if (
              build?.schema_version !== 'chijie-eval-build-v1' ||
              build?.git_sha !== manifest.git_sha ||
              build?.git_branch !== manifest.git_branch ||
              build?.source_hash !== manifest.source_hash ||
              build?.dist_hash !== manifest.dist_hash ||
              build?.extension_version !== manifest.extension_version ||
              build?.build_command !== 'pnpm build' ||
              build?.build_exit_code !== 0 ||
              JSON.stringify(build?.dist_files) !== JSON.stringify(manifest.dist_files) ||
              JSON.stringify(build?.runtime_critical_files) !== JSON.stringify(manifest.runtime_critical_files)
            ) {
              errors.push(`${rowName}: build attestation differs manifest`);
            }
            if (
              verifyTrustSignatures &&
              (!trustKey || !verifyEvalPayloadSignature(build, trustKey, 'attestation_hmac'))
            ) {
              errors.push(`${rowName}: build attestation signature is not trusted by this machine`);
            }
          } catch (error) {
            errors.push(`${rowName}: invalid build attestation ${evidence.path}: ${error.message}`);
          }
        }
        if (evidence.kind === 'unit_report') {
          unitReportCount += 1;
          try {
            const report = JSON.parse(await readFile(filePath, 'utf8'));
            if (
              report?.schema_version !== 'chijie-eval-unit-v1' ||
              report?.campaign_stamp !== manifest.campaign_stamp ||
              report?.arm_hash !== manifest.arm_hash ||
              report?.run_id !== manifest.run_id ||
              report?.task_id !== row.task_id ||
              Number(report?.attempt) !== Number(row.attempt) ||
              report?.outcome !== row.outcome ||
              report?.terminal_status !== 'completed' ||
              report?.exit_code !== 0 ||
              report?.reporter !== 'vitest-json-v1' ||
              !Array.isArray(report?.suite_files) ||
              JSON.stringify(report.suite_files) !== JSON.stringify(evaluatorContract?.suite_files || []) ||
              !Number.isInteger(report?.test_count) ||
              report.test_count < 1 ||
              JSON.stringify(report?.command) !==
                JSON.stringify([
                  'pnpm',
                  '-F',
                  'chrome-extension',
                  'exec',
                  'vitest',
                  'run',
                  ...(evaluatorContract?.suite_files || []),
                  '--reporter=json',
                ]) ||
              !String(report?.stdout_path || '').trim() ||
              !String(report?.stdout_sha256 || '').match(/^[0-9a-f]{64}$/)
            ) {
              errors.push(`${rowName}: invalid unit report contract`);
            }
            try {
              const outputPath = await resolveEvidencePath(workspaceRoot, report.stdout_path);
              if ((await sha256File(outputPath)) !== report.stdout_sha256) {
                errors.push(`${rowName}: unit output hash mismatch`);
              }
              const output = await readFile(outputPath, 'utf8');
              let machineReport = null;
              try {
                machineReport = JSON.parse(output);
              } catch {
                // Reported below as a non-machine Vitest proof.
              }
              if (
                !vitestMachineReportPass(machineReport, evaluatorContract?.suite_files || []) ||
                report.test_count !== machineReport?.numTotalTests
              ) {
                errors.push(`${rowName}: unit output is not a passing Vitest JSON report`);
              } else {
                unitMachineReport = machineReport;
              }
              if (!manifest.evidence_files.some(file => file.path === report.stdout_path)) {
                errors.push(`${rowName}: unit output is not declared evidence`);
              }
            } catch (error) {
              errors.push(`${rowName}: invalid unit output ${report.stdout_path}: ${error.message}`);
            }
          } catch (error) {
            errors.push(`${rowName}: invalid unit report ${evidence.path}: ${error.message}`);
          }
        }
        if (evidence.kind === 'trace') {
          traceEvidenceCount += 1;
          try {
            const trace = JSON.parse(await readFile(filePath, 'utf8'));
            const traceErrors = validateScopedTraceEvidence(trace, {
              evalTaskId: row.task_id,
              attempt: row.attempt,
              runtimeTaskId: manifest.runtime_task_id,
              allowedTabIds: manifest.allowed_tab_ids,
              campaignStamp: manifest.campaign_stamp,
              armHash: manifest.arm_hash,
              runId: manifest.run_id,
            });
            errors.push(...traceErrors.map(error => `${rowName}: ${error}`));
            if (traceErrors.length === 0) tabProofFound = true;
          } catch (error) {
            errors.push(`${rowName}: invalid trace JSON ${evidence.path}: ${error.message}`);
          }
        }
        if (evidence.kind === 'evidence' && evidence.path.endsWith('.json')) {
          try {
            const payload = JSON.parse(await readFile(filePath, 'utf8'));
            if (
              payload?.task_id === row.task_id &&
              Number(payload?.attempt) === Number(row.attempt) &&
              payload?.campaign_stamp === manifest.campaign_stamp &&
              payload?.arm_hash === manifest.arm_hash &&
              payload?.run_id === manifest.run_id &&
              payload?.outcome === row.outcome &&
              payload?.terminal_status === 'completed' &&
              payload?.receipt_count === 1 &&
              payload?.deliverable_count === 1 &&
              typeof payload?.final_deliverable === 'string' &&
              payload.final_deliverable.trim() &&
              payload?.runtime_task_id === manifest.runtime_task_id &&
              payload?.verifier === manifest.verifier &&
              payload?.attach_attestation?.mode === row.attach_mode &&
              payload?.attach_attestation?.connect_url_present === false &&
              payload?.attach_attestation?.owns_browser === true &&
              /^[a-p]{32}$/.test(String(payload?.attach_attestation?.extension_id || '')) &&
              payload?.attach_attestation?.extension_version === manifest.extension_version &&
              runtimeBundleAttestationPass(payload?.attach_attestation, manifest)
            ) {
              if (taskSpecificVerificationPass(row.task_id, payload)) verificationEvidenceCount += 1;
              else errors.push(`${rowName}: task-specific semantic verifier rejected ${evidence.path}`);
            }
            const boundId = payload?.bound_tab?.id;
            if (Number.isInteger(boundId) && Array.isArray(payload?.tab_provenance)) {
              const scopedEvents = payload.tab_provenance.filter(
                entry => entry?.task_id === manifest.runtime_task_id && !entry?.scope_invalid,
              );
              const allIds = scopedEvents.flatMap(entry => [
                entry?.active_tab_id,
                entry?.task_tab_id,
                entry?.target_tab_id,
                ...(entry?.target_tab_ids || []),
              ]);
              if (scopedEvents.length > 0 && allIds.length > 0 && allIds.every(Number.isInteger)) {
                tabProofFound = true;
                if (allIds.some(tabId => !manifest.allowed_tab_ids.includes(tabId))) tabViolation = true;
              }
              if (
                Number.isInteger(payload?.active_tab?.id) &&
                !manifest.allowed_tab_ids.includes(payload.active_tab.id)
              ) {
                tabViolation = true;
              }
            }
            if (Array.isArray(payload?.tab_checks) && payload.tab_checks.length > 0) {
              tabProofFound = true;
              if (
                payload.tab_checks.some(
                  check =>
                    check?.wrong_tab !== 0 ||
                    !Number.isInteger(check?.bound_tab?.id) ||
                    check?.active_tab?.id !== check?.bound_tab?.id ||
                    check?.task_tab_id !== check?.bound_tab?.id ||
                    (check?.target_tab_ids || []).some(tabId => tabId !== check?.bound_tab?.id),
                )
              ) {
                tabViolation = true;
              }
            }
          } catch {
            // Some JSON evidence (for example a fixture report) is not tab provenance.
          }
        }
      } catch (error) {
        errors.push(`${rowName}: invalid evidence ${evidence.path}: ${error.message}`);
      }
    }
    for (const evidencePath of paths) {
      if (!declaredPaths.has(evidencePath)) errors.push(`${rowName}: undeclared evidence path ${evidencePath}`);
    }
    for (const evidencePath of declaredPaths) {
      if (!paths.includes(evidencePath)) errors.push(`${rowName}: manifest evidence absent from CSV ${evidencePath}`);
    }
    if (manifest.trace_requested && !manifest.evidence_files.some(file => file.kind === 'trace')) {
      errors.push(`${rowName}: trace requested without trace evidence`);
    }
    if (row.outcome === 'verified_pass' && manifest.attach_mode !== 'unit') {
      if (manifest.attach_mode !== 'launched_chrome_for_testing') {
        errors.push(`${rowName}: browser PASS is not bound to the locally launched attested extension`);
      }
      if (verificationEvidenceCount !== 1) {
        errors.push(
          `${rowName}: expected one evaluator-specific verification evidence, got ${verificationEvidenceCount}`,
        );
      }
      if (traceEvidenceCount !== 1) errors.push(`${rowName}: expected one scoped trace, got ${traceEvidenceCount}`);
    }
    if (row.outcome === 'verified_pass' && manifest.attach_mode === 'unit' && unitReportCount !== 1) {
      errors.push(`${rowName}: expected one structured unit report, got ${unitReportCount}`);
    }
    if (
      row.outcome === 'verified_pass' &&
      manifest.attach_mode === 'unit' &&
      (bindToCurrentCheckout || trustedUnitProjectRoot)
    ) {
      const rerun = trustedUnitRerun(trustedUnitProjectRoot || projectRoot, evaluatorContract?.suite_files || []);
      if (!rerun || !unitMachineReport || rerun.numTotalTests !== unitMachineReport.numTotalTests) {
        errors.push(`${rowName}: trusted current Vitest rerun did not confirm unit proof`);
      }
    }
    if (row.outcome === 'verified_pass' && buildAttestationCount !== 1) {
      errors.push(`${rowName}: expected one build attestation, got ${buildAttestationCount}`);
    }
    if (!tabProofFound) errors.push(`${rowName}: missing task-scoped tab provenance`);
    if (tabViolation || String(row.wrong_tab) !== '0') errors.push(`${rowName}: tab provenance proves wrong_tab`);
    if (manifest.trace_requested) {
      if (!String(manifest.trace_dump_dir || '').trim()) {
        errors.push(`${rowName}: missing trace_dump_dir`);
      } else {
        try {
          const traceDirectory = await resolveEvidencePath(workspaceRoot, manifest.trace_dump_dir);
          if (!(await stat(traceDirectory)).isDirectory()) throw new Error('not a directory');
        } catch (error) {
          errors.push(`${rowName}: invalid trace_dump_dir ${manifest.trace_dump_dir}: ${error.message}`);
        }
      }
    }
    manifests.set(`${row.task_id}\u0000${row.attempt}`, manifest);
  }
  for (const taskId of new Set(rows.map(row => row.task_id))) {
    const taskRows = rows.filter(row => row.task_id === taskId);
    const first = manifests.get(`${taskId}\u0000${taskRows[0]?.attempt}`);
    if (!first) continue;
    for (const row of taskRows.slice(1)) {
      const manifest = manifests.get(`${taskId}\u0000${row.attempt}`);
      if (!manifest) continue;
      for (const field of [
        'source_hash',
        'dist_hash',
        'extension_version',
        'browser_version',
        'task_definition_hash',
        'evaluator_hash',
      ]) {
        if (String(first[field]) !== String(manifest[field])) {
          errors.push(`${label}: ${taskId} mixed manifest ${field}`);
        }
      }
    }
  }
  return { errors, manifests, evidenceRealpaths: resolvedEvidenceRealpaths };
}

export async function compareEvalMatricesWithEvidence(
  baselineRows,
  currentRows,
  { workspaceRoot, baselineCsvPath = '', currentCsvPath = '', passK = 3, tolerance = 0 } = {},
) {
  const result = compareEvalMatrices(baselineRows, currentRows, { passK, tolerance });
  const errors = [...result.errors, ...validateDistinctCampaigns(baselineRows, currentRows)];
  const [baselineCampaign, currentCampaign] = await Promise.all([
    validateCampaignCsvAttestation(baselineCsvPath, baselineRows, workspaceRoot, 'baseline'),
    validateCampaignCsvAttestation(currentCsvPath, currentRows, workspaceRoot, 'current'),
  ]);
  errors.push(...baselineCampaign.errors, ...currentCampaign.errors);
  const sharedEvidence = await findSharedEvidenceRealpaths(baselineRows, currentRows, workspaceRoot);
  if (sharedEvidence.length > 0) {
    errors.push(`formal gate requires disjoint evidence; shared realpaths=${sharedEvidence.join(',')}`);
  }
  const currentProjectRoot = path.join(workspaceRoot, 'projects/chijie-browser');
  let currentDist = null;
  try {
    currentDist = await rebuildDistAndAttest(workspaceRoot, currentProjectRoot);
  } catch (error) {
    errors.push(`current: trusted rebuild failed: ${error.message}`);
  }

  const validatePair = async ({ baselineDist = null, baselineProjectRoot = '' } = {}) => {
    const [baselineEvidence, currentEvidence] = await Promise.all([
      validateEvidenceRows(baselineRows, {
        workspaceRoot,
        label: 'baseline',
        verifyLiveProvenance: true,
        bindToCurrentCheckout: false,
        trustedDist: baselineDist,
        trustedUnitProjectRoot: baselineProjectRoot,
        verifyTrustSignatures: true,
      }),
      validateEvidenceRows(currentRows, {
        workspaceRoot,
        label: 'current',
        verifyLiveProvenance: true,
        bindToCurrentCheckout: true,
        trustedDist: currentDist,
        trustedUnitProjectRoot: currentProjectRoot,
        verifyTrustSignatures: true,
      }),
    ]);
    return { baselineEvidence, currentEvidence };
  };

  const baselineSha = String(baselineRows?.[0]?.git_sha || '');
  const currentSha = String(currentRows?.[0]?.git_sha || '');
  let evidencePair;
  if (currentDist && baselineSha === currentSha) {
    evidencePair = await validatePair({ baselineDist: currentDist, baselineProjectRoot: currentProjectRoot });
  } else if (currentDist) {
    try {
      evidencePair = await withTrustedCommitCheckout(workspaceRoot, baselineSha, prepared =>
        validatePair({ baselineDist: prepared.dist, baselineProjectRoot: prepared.projectRoot }),
      );
    } catch (error) {
      errors.push(`baseline: trusted commit reconstruction failed: ${error.message}`);
    }
  }
  if (!evidencePair) evidencePair = await validatePair();
  const { baselineEvidence, currentEvidence } = evidencePair;
  errors.push(...baselineEvidence.errors, ...currentEvidence.errors);
  for (const taskId of Object.keys(result.baseline.tasks)) {
    const baselineRow = baselineRows.find(row => row.task_id === taskId);
    const currentRow = currentRows.find(row => row.task_id === taskId);
    if (!baselineRow || !currentRow) continue;
    const before = baselineEvidence.manifests.get(`${taskId}\u0000${baselineRow.attempt}`);
    const after = currentEvidence.manifests.get(`${taskId}\u0000${currentRow.attempt}`);
    if (!before || !after) continue;
    for (const field of ['task_definition_hash', 'evaluator_hash']) {
      if (before[field] !== after[field]) errors.push(`current: ${taskId} changed frozen manifest ${field}`);
    }
  }
  return { ...result, ok: errors.length === 0, errors };
}
