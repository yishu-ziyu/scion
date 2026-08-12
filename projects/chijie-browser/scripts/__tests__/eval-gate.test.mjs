import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  compareEvalMatrices,
  evalMetrics,
  parseEvalCsv,
  serializeEvalCsv,
  validateEvidenceRows,
  validateEvalRows,
  validateGatePolicy,
} from '../lib/eval-gate.mjs';
import { computeEvalArmHash, computeEvalRunId, evalArmTuple, hashAttestedFiles } from '../lib/eval-provenance.mjs';

function row(overrides = {}) {
  const campaignStamp = overrides.campaign_stamp || 'campaign-1';
  const taskId = overrides.task_id || 'LH-1';
  const attempt = String(overrides.attempt || '1');
  const base = {
    date: 'campaign-1',
    campaign_stamp: campaignStamp,
    task_id: taskId,
    attempt,
    git_sha: 'abc1234',
    model: 'MiniMax-M3',
    provider: 'minimax',
    provider_base_url: 'https://api.minimaxi.com/v1',
    feature_flags_hash: '5'.repeat(64),
    attach_mode: 'launched_chrome_for_testing',
    prompt_version: 'p1',
    policy_tag: 'baseline',
    outcome: 'verified_pass',
    false_complete: '0',
    wrong_tab: '0',
    unapproved_commit: '0',
    evidence_path: 'reports/run.json',
    ...overrides,
  };
  return {
    ...base,
    arm_hash: overrides.arm_hash || computeEvalArmHash(base),
    run_id: overrides.run_id || computeEvalRunId({ campaignStamp, taskId, attempt: Number(attempt) }),
  };
}

test('CSV parser reads matrix rows', () => {
  const parsed = parseEvalCsv('task_id,attempt,outcome,notes\nLH-1,2,verified_pass,"keeps, quoted comma"\n');
  assert.deepEqual(parsed, [{ task_id: 'LH-1', attempt: '2', outcome: 'verified_pass', notes: 'keeps, quoted comma' }]);
  const serialized = serializeEvalCsv(['task_id', 'notes'], [{ task_id: 'LH-1', notes: 'comma, quote " and\nline' }]);
  assert.equal(parseEvalCsv(serialized)[0].notes, 'comma, quote " and\nline');
  assert.throws(() => parseEvalCsv('task_id,notes\nLH-1,"unterminated\n'), /unterminated/);
  assert.throws(() => parseEvalCsv('task_id,notes\nLH-1,"closed"junk\n'), /closing quote/);
});

test('gate fails closed on false complete, wrong tab, or missing provenance', () => {
  assert(validateEvalRows([row({ false_complete: '1' })]).some(error => error.includes('false_complete=1')));
  assert(validateEvalRows([row({ wrong_tab: '1' })]).some(error => error.includes('wrong_tab=1')));
  assert(validateEvalRows([row({ evidence_path: '' })]).some(error => error.includes('missing evidence_path')));
  assert.equal(
    validateEvalRows([row({ attach_mode: 'user_chrome' })]).some(error => error.includes('attach_mode')),
    false,
  );
  assert(validateEvalRows([row({ attach_mode: 'banana' })]).some(error => error.includes('invalid attach_mode')));
  assert(validateEvalRows([row({ outcome: 'invalid_run' })]).some(error => error.includes('invalid_run')));
  assert(validateEvalRows([row(), row()]).some(error => error.includes('duplicate task attempt')));
  assert(validateEvalRows([row(), row({ attempt: '3' })]).some(error => error.includes('attempts must be continuous')));
  assert(
    validateEvalRows([row(), row({ attempt: '2', model: 'other' })]).some(error =>
      error.includes('mixed frozen model'),
    ),
  );
});

test('an honest fail row remains scoreable evidence instead of invalidating the campaign', () => {
  assert.deepEqual(validateEvalRows([row({ outcome: 'fail' })]), []);
  const metrics = evalMetrics([row({ outcome: 'fail' })], 1);
  assert.equal(metrics.total, 1);
  assert.equal(metrics.passes, 0);
  assert.equal(metrics.tsr, 0);
});

test('matrix validation accepts a non-formal debug arm while the formal gate rejects it', () => {
  const debug = row({
    model: 'grok-4.5',
    provider: 'custom_openai',
    provider_base_url: 'http://127.0.0.1:8317/v1',
  });
  assert.equal(validateEvalRows([debug], 'debug', { formalPolicy: false }).length, 0);
  assert(
    validateEvalRows([debug], 'formal').some(error =>
      error.includes('formal gate requires MiniMax-M3 at the canonical MiniMax endpoint'),
    ),
  );
});

test('metrics report per-task TSR and empirical Pass^k', () => {
  const metrics = evalMetrics([row(), row({ attempt: '2' }), row({ attempt: '3', outcome: 'fail' })], 3);
  assert.equal(metrics.tasks['LH-1'].tsr, 2 / 3);
  assert.equal(metrics.tasks['LH-1'].pass_k, 0);
  assert.equal(metrics.pass_k, 0);
  assert.equal(evalMetrics([row(), row({ attempt: '2' })], 3).pass_k, null);
});

test('gate rejects a per-task reliability regression even when coverage remains', () => {
  const baseline = [row(), row({ attempt: '2' })];
  const current = [row({ git_sha: 'def4567' }), row({ attempt: '2', git_sha: 'def4567', outcome: 'fail' })];
  const result = compareEvalMatrices(baseline, current, { passK: 2 });
  assert.equal(result.ok, false);
  assert(result.errors.some(error => error.includes('TSR regressed')));
  assert(result.errors.some(error => error.includes('Pass^2 regressed')));
});

test('formal gate cannot compare one file or weaken k and tolerance', () => {
  assert.deepEqual(
    validateGatePolicy({ baselinePath: '/tmp/a.csv', currentPath: '/tmp/b.csv', passK: 3, tolerance: 0 }),
    [],
  );
  assert(
    validateGatePolicy({ baselinePath: '/tmp/a.csv', currentPath: '/tmp/a.csv', passK: 1, tolerance: 1 }).some(error =>
      error.includes('different files'),
    ),
  );
  assert(
    validateGatePolicy({ baselinePath: '/tmp/a.csv', currentPath: '/tmp/b.csv', passK: 1, tolerance: 0 }).some(error =>
      error.includes('PASS_K=3'),
    ),
  );
  assert(
    validateGatePolicy({ baselinePath: '/tmp/a.csv', currentPath: '/tmp/b.csv', passK: 3, tolerance: 0.1 }).some(
      error => error.includes('REGRESSION_TOLERANCE=0'),
    ),
  );
});

test('gate passes equal-or-better current results and rejects missing baseline tasks', () => {
  const baseline = [row(), row({ task_id: 'LH-2' })];
  const current = [row({ git_sha: 'def4567' }), row({ task_id: 'LH-2', git_sha: 'def4567' })];
  assert.equal(compareEvalMatrices(baseline, current, { passK: 1 }).ok, true);
  assert.equal(compareEvalMatrices(baseline, current.slice(0, 1), { passK: 1 }).ok, false);
  assert.equal(
    compareEvalMatrices(baseline, [...current, row({ task_id: 'LH-extra', git_sha: 'def4567' })], { passK: 1 }).ok,
    false,
  );
});

test('gate does not let fewer attempts masquerade as equal reliability', () => {
  const baseline = [row(), row({ attempt: '2' })];
  const current = [row({ git_sha: 'def4567' })];
  const result = compareEvalMatrices(baseline, current, { passK: 1 });
  assert(result.errors.some(error => error.includes('attempt coverage regressed')));
});

test('gate compares the same frozen model, prompt, policy, and attach mode', () => {
  const baseline = [row()];
  const current = [row({ git_sha: 'def4567', prompt_version: 'changed' })];
  const result = compareEvalMatrices(baseline, current, { passK: 1 });
  assert(result.errors.some(error => error.includes('changed frozen prompt_version')));
});

test('evidence gate validates manifest identity, provenance, paths, and hashes', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'eval-gate-'));
  try {
    const runDir = path.join(workspaceRoot, 'reports/nanobrowser/eval/artifacts/campaign-1/022-KERNEL-01/attempt-1');
    await mkdir(runDir, { recursive: true });
    const prefix = 'reports/nanobrowser/eval/artifacts/campaign-1/022-KERNEL-01/attempt-1';
    const evidenceRelative = `${prefix}/022-KERNEL-01-attempt-1-unit-report.json`;
    const outputRelative = `${prefix}/022-KERNEL-01-attempt-1-unit-output.log`;
    const buildRelative = `${prefix}/build-attestation.json`;
    const manifestRelative = `${prefix}/matrix-run.json`;
    const evalRow = row({
      task_id: '022-KERNEL-01',
      attach_mode: 'unit',
      evidence_path: `${manifestRelative};${evidenceRelative};${outputRelative};${buildRelative}`,
    });
    const suiteFiles = ['src/background/browser/kernel/__tests__/022-kernel-parity.test.ts'];
    const output =
      JSON.stringify({
        success: true,
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [
          {
            name: `/tmp/chrome-extension/${suiteFiles[0]}`,
            status: 'passed',
            assertionResults: [{ status: 'passed' }],
          },
        ],
      }) + '\n';
    await writeFile(path.join(workspaceRoot, outputRelative), output);
    const evidence =
      JSON.stringify({
        schema_version: 'chijie-eval-unit-v1',
        task_id: evalRow.task_id,
        attempt: 1,
        campaign_stamp: evalRow.campaign_stamp,
        arm_hash: evalRow.arm_hash,
        run_id: evalRow.run_id,
        outcome: 'verified_pass',
        terminal_status: 'completed',
        exit_code: 0,
        command: ['pnpm', '-F', 'chrome-extension', 'exec', 'vitest', 'run', ...suiteFiles, '--reporter=json'],
        reporter: 'vitest-json-v1',
        suite_files: suiteFiles,
        test_count: 1,
        stdout_path: outputRelative,
        stdout_sha256: createHash('sha256').update(output).digest('hex'),
      }) + '\n';
    await writeFile(path.join(workspaceRoot, evidenceRelative), evidence);
    const hash = createHash('sha256').update(evidence).digest('hex');
    const distFiles = [{ path: 'projects/chijie-browser/dist/manifest.json', sha256: 'b'.repeat(64), size: 10 }];
    const distHash = hashAttestedFiles(distFiles);
    const build =
      JSON.stringify({
        schema_version: 'chijie-eval-build-v1',
        git_sha: evalRow.git_sha,
        git_branch: 'test',
        source_hash: '1'.repeat(64),
        dist_hash: distHash,
        extension_version: '0.3.0',
        build_command: 'pnpm build',
        build_exit_code: 0,
        dist_files: distFiles,
        runtime_critical_files: [
          'manifest.json',
          'background.iife.js',
          'content/index.iife.js',
          'side-panel/index.html',
        ],
      }) + '\n';
    await writeFile(path.join(workspaceRoot, buildRelative), build);
    const manifest = {
      schema_version: 'chijie-eval-run-v2',
      campaign_stamp: evalRow.campaign_stamp,
      arm_hash: evalRow.arm_hash,
      run_id: evalRow.run_id,
      arm_tuple: evalArmTuple(evalRow),
      trust_key_id: '5'.repeat(64),
      run_hmac: '6'.repeat(64),
      eval_level: 'L1',
      seed: 'not_applicable_no_provider_seed',
      persona_id: 'not_applicable_l1',
      persona_version: 'not_applicable_l1',
      simulator_model: 'not_applicable_l1',
      simulator_prompt_version: 'not_applicable_l1',
      profile_or_fixture_id: 'not_applicable_unit',
      start_url: 'not_applicable_unit',
      bound_tab_id: 'not_applicable_unit',
      side_effect_verdict: 'not_applicable_unit',
      task_id: evalRow.task_id,
      attempt: 1,
      git_sha: evalRow.git_sha,
      git_branch: 'test',
      model: evalRow.model,
      provider: evalRow.provider,
      provider_base_url: evalRow.provider_base_url,
      feature_flags_hash: evalRow.feature_flags_hash,
      attach_mode: evalRow.attach_mode,
      prompt_version: evalRow.prompt_version,
      policy_tag: evalRow.policy_tag,
      outcome: evalRow.outcome,
      false_complete: 0,
      wrong_tab: 0,
      unapproved_commit: 0,
      dirty_state: 'clean',
      dirty_policy: 'tracked-and-untracked-with-root-allowlist',
      untracked_exclusions: [`${prefix}/`],
      dist_source_state: 'current',
      source_hash: '1'.repeat(64),
      dist_hash: distHash,
      dist_files: distFiles,
      runtime_critical_files: ['manifest.json', 'background.iife.js', 'content/index.iife.js', 'side-panel/index.html'],
      extension_version: '0.3.0',
      browser_version: 'not_applicable',
      task_definition_hash: '3'.repeat(64),
      evaluator_hash: '4'.repeat(64),
      runner: ['scripts/eval-022-unit-gates.mjs'],
      verifier: 'unit',
      runtime_task_id: 'unit:022-KERNEL-01:1',
      allowed_tab_ids: [],
      build_attestation_path: buildRelative,
      exit_code: 0,
      matrix_row_count: 1,
      trace_requested: false,
      trace_dump_dir: prefix,
      evidence_files: [
        { path: evidenceRelative, sha256: hash, kind: 'unit_report' },
        {
          path: outputRelative,
          sha256: createHash('sha256').update(output).digest('hex'),
          kind: 'evidence',
        },
        {
          path: buildRelative,
          sha256: createHash('sha256').update(build).digest('hex'),
          kind: 'build_attestation',
        },
      ],
    };
    await writeFile(path.join(workspaceRoot, manifestRelative), JSON.stringify(manifest));
    assert.deepEqual(
      (await validateEvidenceRows([evalRow], { workspaceRoot, verifyLiveProvenance: false })).errors,
      [],
    );

    const forgedManifest = JSON.parse(JSON.stringify(manifest));
    forgedManifest.runner = ['chrome-extension/scripts/eval-public-task.mjs'];
    forgedManifest.verifier = 'body_contains';
    await writeFile(path.join(workspaceRoot, manifestRelative), JSON.stringify(forgedManifest));
    const forgedErrors = (await validateEvidenceRows([evalRow], { workspaceRoot, verifyLiveProvenance: false })).errors;
    assert(forgedErrors.some(error => error.includes('runner does not match evaluator registry')));
    assert(forgedErrors.some(error => error.includes('verifier does not match evaluator registry')));
    await writeFile(path.join(workspaceRoot, manifestRelative), JSON.stringify(manifest));

    const fakePersonaManifest = { ...manifest, persona_id: 'claimed-l2-persona' };
    await writeFile(path.join(workspaceRoot, manifestRelative), JSON.stringify(fakePersonaManifest));
    assert(
      (await validateEvidenceRows([evalRow], { workspaceRoot, verifyLiveProvenance: false })).errors.some(error =>
        error.includes('L1 seed/persona/simulator applicability'),
      ),
    );
    await writeFile(path.join(workspaceRoot, manifestRelative), JSON.stringify(manifest));

    await writeFile(path.join(workspaceRoot, evidenceRelative), 'tampered');
    assert(
      (await validateEvidenceRows([evalRow], { workspaceRoot, verifyLiveProvenance: false })).errors.some(error =>
        error.includes('hash mismatch'),
      ),
    );
    assert(
      (
        await validateEvidenceRows([row({ evidence_path: 'reports/banana/matrix-run.json' })], {
          workspaceRoot,
          verifyLiveProvenance: false,
        })
      ).errors.some(error => error.includes('invalid manifest')),
    );
    assert(
      (
        await validateEvidenceRows([row({ evidence_path: '/absolute/matrix-run.json' })], {
          workspaceRoot,
          verifyLiveProvenance: false,
        })
      ).errors.some(error => error.includes('absolute evidence path')),
    );
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});
