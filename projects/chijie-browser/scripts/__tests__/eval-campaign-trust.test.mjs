import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, link, mkdtemp, mkdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  findSharedEvidenceRealpaths,
  serializeEvalCsv,
  validateCampaignCsvAttestation,
  validateDistinctCampaigns,
  validateEvalRows,
} from '../lib/eval-gate.mjs';
import { uniqueEvalRows } from '../lib/eval-harness.mjs';
import {
  assertSafeCampaignStamp,
  computeEvalArmHash,
  computeEvalRunId,
  evalArmTuple,
  expectedRunEvidenceRelativeDir,
  ensureEvalTrustKey,
  readEvalTrustKey,
  signEvalPayload,
  verifyEvalPayloadSignature,
  withTrustedCommitCheckout,
} from '../lib/eval-provenance.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const matrixScript = path.join(projectRoot, 'scripts/eval-matrix.mjs');

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout || '').trim();
}

function armInput(overrides = {}) {
  return {
    git_sha: 'a'.repeat(40),
    model: 'MiniMax-M3',
    provider: 'minimax',
    provider_base_url: 'https://api.minimaxi.com/v1',
    feature_flags_hash: 'b'.repeat(64),
    prompt_version: 'p1',
    policy_tag: 'baseline',
    attach_mode: 'unit',
    ...overrides,
  };
}

function row(overrides = {}) {
  const campaignStamp = overrides.campaign_stamp || '2026-08-13T010203Z-baseline';
  const taskId = overrides.task_id || '022-KERNEL-01';
  const attempt = String(overrides.attempt || 1);
  const arm = evalArmTuple({ ...armInput(), ...overrides });
  return {
    date: campaignStamp,
    campaign_stamp: campaignStamp,
    arm_hash: computeEvalArmHash(arm),
    run_id: computeEvalRunId({ campaignStamp, taskId, attempt: Number(attempt) }),
    task_id: taskId,
    attempt,
    ...arm,
    outcome: 'verified_pass',
    false_complete: '0',
    wrong_tab: '0',
    unapproved_commit: '0',
    evidence_path: `reports/nanobrowser/eval/artifacts/${campaignStamp}/${taskId}/attempt-${attempt}/matrix-run.json`,
    ...overrides,
  };
}

test('campaign, arm, and run identities are strict and independently recomputable', () => {
  assert.equal(assertSafeCampaignStamp('2026-08-13T010203Z-baseline'), '2026-08-13T010203Z-baseline');
  for (const attack of ['../escape', 'a/b', '/absolute', '.', '..', ' space ', '测试', 'x'.repeat(65)]) {
    assert.throws(() => assertSafeCampaignStamp(attack), /campaign stamp/i);
  }
  const arm = evalArmTuple(armInput());
  assert.deepEqual(Object.keys(arm), [
    'git_sha',
    'model',
    'provider',
    'provider_base_url',
    'feature_flags_hash',
    'prompt_version',
    'policy_tag',
    'attach_mode',
  ]);
  assert.match(computeEvalArmHash(arm), /^[0-9a-f]{64}$/);
  assert.notEqual(computeEvalArmHash(arm), computeEvalArmHash({ ...arm, model: 'other' }));
  assert.match(
    computeEvalRunId({ campaignStamp: '2026-08-13T010203Z-baseline', taskId: '022-KERNEL-01', attempt: 1 }),
    /^[0-9a-f]{64}$/,
  );
  assert.equal(
    expectedRunEvidenceRelativeDir('2026-08-13T010203Z-baseline', '022-KERNEL-01', 1),
    'reports/nanobrowser/eval/artifacts/2026-08-13T010203Z-baseline/022-KERNEL-01/attempt-1',
  );
  assert.throws(() => expectedRunEvidenceRelativeDir('2026-08-13T010203Z-baseline', '../escape', 1), /task id/i);
});

test('matrix rejects unsafe MATRIX_STAMP before creating artifacts', () => {
  const result = spawnSync(process.execPath, [matrixScript], {
    cwd: projectRoot,
    encoding: 'utf8',
    env: { ...process.env, DRY_RUN: '1', TASKS: '021-LH-04', MATRIX_STAMP: '../escape' },
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /campaign stamp/i);
});

test('CSV identity rejects fake dates, forged arm hashes, and caller-selected run ids', () => {
  const valid = row();
  assert.deepEqual(validateEvalRows([valid]), []);
  assert(validateEvalRows([{ ...valid, date: 'fake-date' }]).some(error => error.includes('campaign')));
  assert(validateEvalRows([{ ...valid, arm_hash: '0'.repeat(64) }]).some(error => error.includes('arm_hash')));
  assert(validateEvalRows([{ ...valid, run_id: '1'.repeat(64) }]).some(error => error.includes('run_id')));
});

test('harness conformance preserves two independent 3-attempt arms without presenting product A/B scores', () => {
  const campaigns = [
    {
      campaign_stamp: '2026-08-13T010203Z-arm-a',
      model: 'MiniMax-M3',
      provider: 'minimax',
      provider_base_url: 'https://api.minimaxi.com/v1',
      policy_tag: 'arm-a',
    },
    {
      campaign_stamp: '2026-08-13T020304Z-arm-b',
      model: 'debug-model',
      provider: 'custom_openai',
      provider_base_url: 'http://127.0.0.1:8317/v1',
      policy_tag: 'arm-b',
    },
  ].map(config =>
    Array.from({ length: 3 }, (_, index) => {
      const taskAttempt = row({ ...config, date: config.campaign_stamp, attempt: String(index + 1) });
      taskAttempt.arm_hash = computeEvalArmHash(taskAttempt);
      taskAttempt.run_id = computeEvalRunId({
        campaignStamp: taskAttempt.campaign_stamp,
        taskId: taskAttempt.task_id,
        attempt: Number(taskAttempt.attempt),
      });
      return taskAttempt;
    }),
  );
  for (const campaign of campaigns) {
    assert.equal(uniqueEvalRows(campaign).length, 3);
    assert.deepEqual(validateEvalRows(campaign, 'harness-conformance', { formalPolicy: false }), []);
    assert.deepEqual(
      campaign.map(item => Number(item.attempt)),
      [1, 2, 3],
    );
  }
  assert.equal([...campaigns[0], ...campaigns[1]].length, 6);
  assert(
    validateEvalRows(
      [campaigns[0][0], { ...campaigns[1][1], date: campaigns[0][0].date, campaign_stamp: campaigns[0][0].date }],
      'harness-conformance',
      { formalPolicy: false },
    ).some(error => /mixed global|arm_hash|run_id/.test(error)),
  );
  assert.throws(() => uniqueEvalRows([campaigns[0][0], { ...campaigns[0][0] }]), /duplicate task attempt/);
  for (const forged of [
    { ...campaigns[0][0], campaign_stamp: '../fake' },
    { ...campaigns[0][0], arm_hash: '0'.repeat(64) },
    { ...campaigns[0][0], run_id: '1'.repeat(64) },
  ]) {
    assert(validateEvalRows([forged], 'harness-conformance', { formalPolicy: false }).length > 0);
  }
});

test('formal comparison requires distinct campaigns and disjoint real evidence', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-campaign-evidence-'));
  try {
    const sharedRelative = 'reports/nanobrowser/eval/artifacts/shared/matrix-run.json';
    await mkdir(path.dirname(path.join(workspaceRoot, sharedRelative)), { recursive: true });
    await writeFile(path.join(workspaceRoot, sharedRelative), '{}\n');
    const baseline = row({ evidence_path: sharedRelative });
    const currentSameCampaign = row({ evidence_path: sharedRelative });
    assert(validateDistinctCampaigns([baseline], [currentSameCampaign]).some(error => error.includes('distinct')));

    const current = row({
      date: '2026-08-13T020304Z-current',
      campaign_stamp: '2026-08-13T020304Z-current',
      evidence_path: sharedRelative,
    });
    current.run_id = computeEvalRunId({
      campaignStamp: current.campaign_stamp,
      taskId: current.task_id,
      attempt: Number(current.attempt),
    });
    assert.deepEqual(validateDistinctCampaigns([baseline], [current]), []);
    const shared = await findSharedEvidenceRealpaths([baseline], [current], workspaceRoot);
    assert.equal(shared.length, 1);
    assert.equal(shared[0], await realpath(path.join(workspaceRoot, sharedRelative)));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('formal comparison rejects different evidence paths backed by the same inode', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-campaign-hardlink-'));
  try {
    const baselineRelative = 'reports/nanobrowser/eval/artifacts/baseline/evidence.json';
    const currentRelative = 'reports/nanobrowser/eval/artifacts/current/evidence.json';
    await mkdir(path.dirname(path.join(workspaceRoot, baselineRelative)), { recursive: true });
    await mkdir(path.dirname(path.join(workspaceRoot, currentRelative)), { recursive: true });
    await writeFile(path.join(workspaceRoot, baselineRelative), '{}\n');
    await link(path.join(workspaceRoot, baselineRelative), path.join(workspaceRoot, currentRelative));

    assert.notEqual(
      await realpath(path.join(workspaceRoot, baselineRelative)),
      await realpath(path.join(workspaceRoot, currentRelative)),
    );
    const shared = await findSharedEvidenceRealpaths(
      [row({ evidence_path: baselineRelative })],
      [row({ evidence_path: currentRelative })],
      workspaceRoot,
    );
    assert.deepEqual(shared, [await realpath(path.join(workspaceRoot, baselineRelative))]);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('local trust key is permission-restricted and detects any signed payload mutation', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'eval-trust-home-'));
  try {
    const key = await ensureEvalTrustKey(home);
    const keyPath = path.join(home, '.config/chijie/eval-trust.key');
    assert.equal((await stat(keyPath)).mode & 0o077, 0);
    const signed = signEvalPayload({ schema_version: 'fixture-v1', value: 1 }, key, 'fixture_hmac');
    assert.equal(verifyEvalPayloadSignature(signed, key, 'fixture_hmac'), true);
    assert.equal(verifyEvalPayloadSignature({ ...signed, value: 2 }, key, 'fixture_hmac'), false);
    await chmod(keyPath, 0o644);
    await assert.rejects(() => readEvalTrustKey(home), /0600/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('campaign attestation binds canonical CSV bytes and exact manifest closure', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-campaign-attestation-'));
  const home = await mkdtemp(path.join(os.tmpdir(), 'eval-campaign-key-'));
  try {
    const key = await ensureEvalTrustKey(home);
    const evalRow = row();
    const reportDir = path.join(workspaceRoot, 'reports/nanobrowser/eval');
    const runDir = path.join(reportDir, 'artifacts', evalRow.campaign_stamp, evalRow.task_id, 'attempt-1');
    await mkdir(runDir, { recursive: true });
    const manifestRelative = `${expectedRunEvidenceRelativeDir(
      evalRow.campaign_stamp,
      evalRow.task_id,
      1,
    )}/matrix-run.json`;
    const manifestPath = path.join(workspaceRoot, manifestRelative);
    await writeFile(manifestPath, '{"run":"fixture"}\n');
    evalRow.evidence_path = manifestRelative;
    const headers = Object.keys(evalRow);
    const csv = serializeEvalCsv(headers, [evalRow]);
    const csvRelative = `reports/nanobrowser/eval/${evalRow.campaign_stamp}-eval-matrix.csv`;
    const csvPath = path.join(workspaceRoot, csvRelative);
    await writeFile(csvPath, csv);
    const summaryRelative = `reports/nanobrowser/eval/${evalRow.campaign_stamp}-eval-summary.md`;
    const summary = `# Harness conformance ${evalRow.campaign_stamp}\n\nRun: ${evalRow.run_id}\n`;
    await writeFile(path.join(workspaceRoot, summaryRelative), summary);
    const manifestHash = createHash('sha256')
      .update(await readFile(manifestPath))
      .digest('hex');
    const campaign = signEvalPayload(
      {
        schema_version: 'chijie-eval-campaign-v1',
        campaign_stamp: evalRow.campaign_stamp,
        git_sha: evalRow.git_sha,
        arm_hash: evalRow.arm_hash,
        arm_tuple: evalArmTuple(evalRow),
        row_count: 1,
        csv_path: csvRelative,
        csv_sha256: createHash('sha256').update(csv).digest('hex'),
        summary_path: summaryRelative,
        summary_sha256: createHash('sha256').update(summary).digest('hex'),
        manifests: [{ run_id: evalRow.run_id, path: manifestRelative, sha256: manifestHash }],
        created_at: '2026-08-13T00:00:00.000Z',
      },
      key,
      'campaign_hmac',
    );
    await writeFile(path.join(reportDir, `${evalRow.campaign_stamp}-eval-campaign.json`), JSON.stringify(campaign));
    assert.deepEqual(
      (await validateCampaignCsvAttestation(csvPath, [evalRow], workspaceRoot, 'fixture', key)).errors,
      [],
    );
    await writeFile(csvPath, `${csv}# copied-and-edited\n`);
    assert(
      (await validateCampaignCsvAttestation(csvPath, [evalRow], workspaceRoot, 'fixture', key)).errors.some(error =>
        error.includes('differs CSV'),
      ),
    );
    await writeFile(csvPath, csv);
    await writeFile(path.join(workspaceRoot, summaryRelative), `${summary}\nforged summary\n`);
    assert(
      (await validateCampaignCsvAttestation(csvPath, [evalRow], workspaceRoot, 'fixture', key)).errors.some(error =>
        error.includes('summary hash mismatch'),
      ),
    );
  } finally {
    await Promise.all([
      rm(workspaceRoot, { recursive: true, force: true }),
      rm(home, { recursive: true, force: true }),
    ]);
  }
});

test('trusted baseline checkout is detached at the recorded SHA and is always removed', async () => {
  const repository = await mkdtemp(path.join(os.tmpdir(), 'eval-baseline-repo-'));
  let worktreeRoot = '';
  try {
    git(repository, ['init']);
    git(repository, ['config', 'user.name', 'Eval Test']);
    git(repository, ['config', 'user.email', 'eval@example.test']);
    await writeFile(path.join(repository, 'marker.txt'), 'recorded baseline\n');
    git(repository, ['add', 'marker.txt']);
    git(repository, ['commit', '-m', 'baseline']);
    const sha = git(repository, ['rev-parse', 'HEAD']);
    const observed = await withTrustedCommitCheckout(
      repository,
      sha,
      async prepared => {
        worktreeRoot = prepared.worktreeRoot;
        return readFile(path.join(prepared.worktreeRoot, 'marker.txt'), 'utf8');
      },
      {
        prepare: async ({ worktreeRoot: checkout }) => ({ worktreeRoot: checkout, trusted: true }),
      },
    );
    assert.equal(observed, 'recorded baseline\n');
    assert(!git(repository, ['worktree', 'list', '--porcelain']).includes(worktreeRoot));
  } finally {
    await rm(repository, { recursive: true, force: true });
  }
});
