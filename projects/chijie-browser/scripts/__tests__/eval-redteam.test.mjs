import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateScopedTraceEvidence } from '../../chrome-extension/scripts/lib/eval-trace-evidence.mjs';
import { runtimeBundleAttestationPass, validateEvalRows, vitestMachineReportPass } from '../lib/eval-gate.mjs';
import {
  taskSpecificVerificationPass,
  taskUrlContractPass,
} from '../../chrome-extension/scripts/lib/eval-verification.mjs';
import {
  assertRealpathContained,
  classifyWorkspaceStatus,
  evaluatorPrefixes,
  expectedEvaluatorContract,
} from '../lib/eval-provenance.mjs';
import {
  browserProbePass,
  discoverChromeForTesting,
  resolveChromeForEval,
} from '../../chrome-extension/scripts/lib/eval-provider.mjs';

function row(overrides = {}) {
  return {
    date: 'campaign-1',
    task_id: '021-LH-04',
    attempt: '1',
    git_sha: 'a'.repeat(40),
    model: 'MiniMax-M3',
    provider: 'minimax',
    provider_base_url: 'https://api.minimaxi.com/v1',
    feature_flags_hash: 'b'.repeat(64),
    attach_mode: 'launched_chrome_for_testing',
    prompt_version: 'p1',
    policy_tag: 'baseline',
    outcome: 'verified_pass',
    false_complete: '0',
    wrong_tab: '0',
    unapproved_commit: '0',
    evidence_path: 'reports/matrix-run.json',
    ...overrides,
  };
}

function validTrace() {
  return {
    schema_version: 'chijie-eval-trace-v2',
    eval_task_id: '021-LH-04',
    attempt: 1,
    runtime_task_id: 'runtime-1',
    trace_task_id: 'runtime-1',
    bound_tab_id: 7,
    terminal_status: 'completed',
    receipt_count: 1,
    deliverable_count: 1,
    trace_terminal_status: 'completed',
    spans: [
      {
        id: 'observe-1',
        task_id: 'runtime-1',
        kind: 'observe',
        name: 'observe.dom',
        tab_id: 7,
        tab_sample_delta_ms: 20,
      },
      {
        id: 'act-1',
        task_id: 'runtime-1',
        kind: 'act',
        name: 'act.click',
        tab_id: 7,
        tab_sample_delta_ms: 20,
      },
      {
        id: 'observe-2',
        task_id: 'runtime-1',
        kind: 'reobserve',
        name: 'reobserve.dom',
        tab_id: 7,
        tab_sample_delta_ms: 20,
      },
      {
        id: 'act-2',
        task_id: 'runtime-1',
        kind: 'act',
        name: 'act.navigate',
        tab_id: 7,
        tab_sample_delta_ms: 20,
      },
    ],
    tab_events: [
      {
        captured_at: '2026-08-12T00:00:00.000Z',
        task_id: 'runtime-1',
        active_tab_id: 7,
        task_tab_id: 7,
        target_tab_ids: [7],
      },
    ],
  };
}

const traceContext = {
  evalTaskId: '021-LH-04',
  attempt: 1,
  runtimeTaskId: 'runtime-1',
  allowedTabIds: [7],
};

test('empty row sets and mixed global arms are never gateable', () => {
  assert(validateEvalRows([]).some(error => error.includes('no eval rows')));
  assert(
    validateEvalRows([row(), row({ task_id: '021-LH-03', provider: 'openai_compat' })]).some(error =>
      error.includes('mixed global provider'),
    ),
  );
  assert(
    validateEvalRows([row(), row({ task_id: '021-LH-03', feature_flags_hash: 'c'.repeat(64) })]).some(error =>
      error.includes('mixed global feature_flags_hash'),
    ),
  );
  assert(
    validateEvalRows([row(), row({ task_id: '021-LH-03', date: 'other-campaign' })]).some(error =>
      error.includes('mixed campaign date'),
    ),
  );
});

test('formal MiniMax labels cannot point at an attacker endpoint', () => {
  const errors = validateEvalRows([row({ provider_base_url: 'http://127.0.0.1:9999/v1' })]);
  assert(errors.some(error => error.includes('canonical MiniMax endpoint')));
  assert(
    validateEvalRows([
      row({
        policy_tag: 'renamed-to-hide-attack',
        model: 'other',
        provider: 'openai_compat',
        provider_base_url: 'http://127.0.0.1:9999/v1',
      }),
    ]).some(error => error.includes('formal gate requires MiniMax-M3')),
  );
});

test('task registry fixes LH04 and R1 to their evaluator contracts', () => {
  assert.deepEqual(expectedEvaluatorContract('021-LH-04'), {
    runner: ['chrome-extension/scripts/eval-public-task.mjs'],
    verifier: 'multi_source_delivery',
    gateable: true,
  });
  assert.equal(expectedEvaluatorContract('018-R1').runner[0], 'chrome-extension/scripts/r1-extract-e2e.mjs');
  assert.throws(() => expectedEvaluatorContract('UNKNOWN'), /absent from evaluator registry/);
});

test('runtime extension bundle must match attested local dist files', () => {
  const files = [
    { path: 'background.iife.js', sha256: 'a'.repeat(64) },
    { path: 'content/index.iife.js', sha256: 'd'.repeat(64) },
    { path: 'manifest.json', sha256: 'b'.repeat(64) },
    { path: 'side-panel/assets/index.css', sha256: 'e'.repeat(64) },
    { path: 'side-panel/assets/index.js', sha256: 'f'.repeat(64) },
    { path: 'side-panel/index.html', sha256: 'c'.repeat(64) },
  ];
  const bundleHash = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  const manifest = {
    runtime_critical_files: files.map(file => file.path),
    dist_files: files.map(file => ({
      path: `projects/chijie-browser/dist/${file.path}`,
      sha256: file.sha256,
      size: 1,
    })),
  };
  assert.equal(runtimeBundleAttestationPass({ files, bundle_hash: bundleHash }, manifest), true);
  assert.equal(
    runtimeBundleAttestationPass(
      {
        files: files.map((file, index) => (index === 0 ? { ...file, sha256: 'd'.repeat(64) } : file)),
        bundle_hash: bundleHash,
      },
      manifest,
    ),
    false,
  );
});

test('runtime bundle rejects an arbitrary valid-hash subset', () => {
  const critical = [
    { path: 'background.iife.js', sha256: 'a'.repeat(64) },
    { path: 'content/index.iife.js', sha256: 'b'.repeat(64) },
    { path: 'manifest.json', sha256: 'c'.repeat(64) },
    { path: 'side-panel/assets/index.css', sha256: '1'.repeat(64) },
    { path: 'side-panel/assets/index.js', sha256: '2'.repeat(64) },
    { path: 'side-panel/index.html', sha256: 'd'.repeat(64) },
  ];
  const manifest = {
    runtime_critical_files: critical.map(file => file.path),
    dist_files: critical.map(file => ({
      path: `projects/chijie-browser/dist/${file.path}`,
      sha256: file.sha256,
      size: 1,
    })),
  };
  const icons = [
    { path: 'icon-32.png', sha256: 'e'.repeat(64) },
    { path: 'icon-48.png', sha256: 'f'.repeat(64) },
    { path: 'logo.png', sha256: '0'.repeat(64) },
  ];
  assert.equal(
    runtimeBundleAttestationPass(
      { files: icons, bundle_hash: createHash('sha256').update(JSON.stringify(icons)).digest('hex') },
      manifest,
    ),
    false,
  );
});

test('public URL contracts reject cross-origin and query or fragment token spoofing', () => {
  assert.equal(taskUrlContractPass('013-B04', 'https://www.wikipedia.org.evil.example/'), false);
  assert.equal(taskUrlContractPass('013-B04', 'https://evil.example/?next=https://www.wikipedia.org'), false);
  assert.equal(taskUrlContractPass('013-B07', 'https://evil.example/#iana.org/help/example-domains'), false);
  assert.equal(taskUrlContractPass('013-A03', 'https://evil.example/?target=youtube.com'), false);
  assert.equal(taskUrlContractPass('013-B04', 'https://www.wikipedia.org/?next=https://evil.test'), false);
  assert.equal(taskUrlContractPass('013-B07', 'https://www.iana.org/help/example-domains?evil=1'), false);
  assert.equal(taskUrlContractPass('013-B05', 'https://en.wikipedia.org/wiki/Agent#bogus'), false);
  assert.equal(
    taskUrlContractPass('021-LH-01', 'https://en.wikipedia.org/wiki/Artificial_intelligence?oldid=evil'),
    false,
  );
  assert.equal(taskUrlContractPass('021-LH-02', 'https://en.wikipedia.org/wiki/Web_browser#fake'), false);
  assert.equal(taskUrlContractPass('013-B07', 'https://www.iana.org/help/example-domains'), true);
  assert.equal(taskUrlContractPass('013-A03', 'https://www.youtube.com/'), true);
});

test('Chrome resolver discovers Puppeteer CfT and fails closed on stable Chrome', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'eval-chrome-home-'));
  try {
    const executable = path.join(
      home,
      '.cache/puppeteer/chrome/mac_arm-151.0.7922.47/chrome-mac-arm64',
      'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    );
    await mkdir(path.dirname(executable), { recursive: true });
    await writeFile(executable, '#!/bin/sh\necho "Google Chrome for Testing 151.0.7922.47"\n');
    await chmod(executable, 0o755);
    assert.equal(discoverChromeForTesting(home, 'darwin'), executable);
    assert.throws(() => resolveChromeForEval('', home), /Chrome for Testing or Chromium is required/);
    assert.equal(
      browserProbePass(
        executable,
        {
          product: 'Google Chrome for Testing',
          version: '151.0.7922.47',
          binary_format: 'mach-o',
          bundle_id: 'com.google.chrome.for.testing',
          bundle_version: '151.0.7922.47',
        },
        'darwin',
      ),
      true,
    );

    const stable = path.join(home, 'Google Chrome.app/Contents/MacOS/Google Chrome');
    await mkdir(path.dirname(stable), { recursive: true });
    await writeFile(stable, '#!/bin/sh\n');
    await chmod(stable, 0o755);
    assert.throws(() => resolveChromeForEval(stable, home), /not stable Chrome/);

    const fake = path.join(home, 'fake-Chromium');
    await writeFile(fake, '#!/bin/sh\nexit 0\n');
    await chmod(fake, 0o755);
    assert.throws(() => resolveChromeForEval(fake, home), /not stable Chrome/);
    const productNamedFake = path.join(home, 'Chromium.app/Contents/MacOS/Chromium');
    await mkdir(path.dirname(productNamedFake), { recursive: true });
    await writeFile(productNamedFake, '#!/bin/sh\nexit 0\n');
    await chmod(productNamedFake, 0o755);
    assert.throws(() => resolveChromeForEval(productNamedFake, home), /not stable Chrome/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test('gate-owned task verifier rejects an ungrounded LH04 JSON claim', () => {
  const forged = {
    task_id: '021-LH-04',
    outcome: 'verified_pass',
    target_url: 'https://en.wikipedia.org/wiki/Web_browser',
    final_deliverable: 'x',
    navigation_evidence: [],
  };
  assert.equal(taskSpecificVerificationPass('021-LH-04', forged), false);
});

test('A02 requires an affirmative answer instead of matching 是 inside a negation', () => {
  const base = {
    task_id: '013-A02',
    outcome: 'verified_pass',
    target_url: 'https://www.bilibili.com/',
    navigation_evidence: [{ url: 'https://www.bilibili.com/', title: '哔哩哔哩' }],
  };
  assert.equal(
    taskSpecificVerificationPass('013-A02', { ...base, final_deliverable: '不是，host 是 bilibili.com' }),
    false,
  );
  assert.equal(
    taskSpecificVerificationPass('013-A02', { ...base, final_deliverable: '是，host 是 bilibili.com' }),
    true,
  );
});

test('A01 rejects title and host tokens embedded in a negative claim', () => {
  const payload = {
    task_id: '013-A01',
    outcome: 'verified_pass',
    target_url: 'https://www.wikipedia.org/',
    navigation_evidence: [{ url: 'https://www.wikipedia.org/', title: 'Wikipedia' }],
  };
  assert.equal(
    taskSpecificVerificationPass('013-A01', {
      ...payload,
      final_deliverable: '标题不是 Wikipedia，域名不是 www.wikipedia.org。',
    }),
    false,
  );
  assert.equal(
    taskSpecificVerificationPass('013-A01', {
      ...payload,
      final_deliverable: '标题是 Wikipedia，域名是 www.wikipedia.org。',
    }),
    true,
  );
});

test('O1 accepts exactly one stable form task and rejects form plus skill composites', () => {
  const form = {
    label: 'form',
    terminal_status: 'completed',
    receipt_id: 'receipt-1',
    deliverable: 'Saved successfully',
    runtime_task_id: 'runtime-1',
    submit_count: 1,
    quiescence_ms: 2500,
    quiescence_confirmations: 3,
  };
  const payload = {
    task_id: '018-O1',
    outcome: 'verified_pass',
    runtime_task_id: 'runtime-1',
    receipt_count: 1,
    deliverable_count: 1,
    final_deliverable: 'Saved successfully',
    privacy_pass: true,
    scenario_evidence: [form],
  };
  assert.equal(taskSpecificVerificationPass('018-O1', payload), true);
  assert.equal(
    taskSpecificVerificationPass('018-O1', {
      ...payload,
      receipt_count: 2,
      deliverable_count: 2,
      scenario_evidence: [form, { ...form, label: 'skill', receipt_id: 'receipt-2' }],
    }),
    false,
  );
});

test('unit proof requires a complete Vitest JSON report for the registered suite', () => {
  const suite = 'src/background/browser/kernel/__tests__/022-kernel-parity.test.ts';
  assert.equal(vitestMachineReportPass({ success: true, numTotalTests: 1 }, [suite]), false);
  assert.equal(
    vitestMachineReportPass(
      {
        success: true,
        numTotalTests: 1,
        numPassedTests: 1,
        numFailedTests: 0,
        numPendingTests: 0,
        testResults: [
          {
            name: `/tmp/chrome-extension/${suite}`,
            status: 'passed',
            assertionResults: [{ status: 'passed' }],
          },
        ],
      },
      [suite],
    ),
    true,
  );
});

test('unit evaluator hash scope includes every registered suite source file', () => {
  const contract = expectedEvaluatorContract('022-DIFF-01');
  const prefixes = evaluatorPrefixes({
    runner: contract.runner,
    verifier: contract.verifier,
    taskId: '022-DIFF-01',
    suiteFiles: contract.suite_files,
  });
  for (const suite of contract.suite_files) {
    assert(prefixes.includes(`projects/chijie-browser/chrome-extension/${suite}`));
  }
});

test('all observe, action, and active-tab trace evidence stays task scoped', () => {
  assert.deepEqual(validateScopedTraceEvidence(validTrace(), traceContext), []);
  const wrongActive = validTrace();
  wrongActive.tab_events[0].active_tab_id = 999;
  assert(validateScopedTraceEvidence(wrongActive, traceContext).some(error => error.includes('wrong tab')));
  const crossTask = validTrace();
  crossTask.spans[1].task_id = 'other-task';
  assert(validateScopedTraceEvidence(crossTask, traceContext).some(error => error.includes('cross-task')));
  const reversedEvents = validTrace();
  reversedEvents.tab_events.push({
    ...reversedEvents.tab_events[0],
    captured_at: '2026-08-11T23:59:59.000Z',
  });
  assert(validateScopedTraceEvidence(reversedEvents, traceContext).some(error => error.includes('not ordered')));
});

test('an empty or receipt-less trace cannot certify completion', () => {
  const trace = validTrace();
  trace.spans = [];
  trace.receipt_count = 0;
  const errors = validateScopedTraceEvidence(trace, traceContext);
  assert(errors.some(error => error.includes('receipt/deliverable')));
  assert(errors.some(error => error.includes('trace is empty')));
});

test('one handwritten observe span cannot certify a multi-source LH04 run', () => {
  const trace = validTrace();
  trace.spans = trace.spans.slice(0, 1);
  assert(
    validateScopedTraceEvidence(trace, traceContext).some(error =>
      error.includes('multi-source observe/action sequence'),
    ),
  );
});

test('untracked source blocks formal provenance while explicit root artifacts do not', () => {
  const classified = classifyWorkspaceStatus([
    { code: '??', path: '.omo/state.json' },
    { code: '??', path: 'clicky/session.json' },
    { code: '??', path: 'reports/eval/run.json' },
    { code: '??', path: 'projects/chijie-browser/scripts/attack.mjs' },
  ]);
  assert.deepEqual(classified.allowedUntracked, ['.omo/state.json', 'clicky/session.json', 'reports/eval/run.json']);
  assert.deepEqual(classified.blocking, [{ code: '??', path: 'projects/chijie-browser/scripts/attack.mjs' }]);
});

test('realpath containment rejects an in-workspace symlink to outside evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-realpath-root-'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'eval-realpath-outside-'));
  try {
    await mkdir(path.join(root, 'reports'), { recursive: true });
    await writeFile(path.join(outside, 'matrix-run.json'), '{}\n');
    const link = path.join(root, 'reports', 'matrix-run.json');
    await symlink(path.join(outside, 'matrix-run.json'), link);
    await assert.rejects(() => assertRealpathContained(root, link), /realpath escapes workspace/);
  } finally {
    await Promise.all([rm(root, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]);
  }
});
