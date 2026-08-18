import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validateScopedTraceEvidence } from '../../chrome-extension/scripts/lib/eval-trace-evidence.mjs';
import {
  runtimeBundleAttestationPass,
  validateEvalRows,
  verificationEvidenceProtocolErrors,
  vitestMachineReportPass,
} from '../lib/eval-gate.mjs';
import {
  multiSourceDeliveryPass,
  productDeliverablePass,
  taskSpecificVerificationPass,
  taskUrlContractPass,
} from '../../chrome-extension/scripts/lib/eval-verification.mjs';
import {
  assertRealpathContained,
  classifyWorkspaceStatus,
  evaluatorPrefixes,
  expectedEvaluatorContract,
  readWorkspaceStatus,
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
    schema_version: 'chijie-eval-trace-v3',
    eval_task_id: '021-LH-04',
    attempt: 1,
    runtime_task_id: 'runtime-1',
    runtime_round_id: 'round-1',
    trace_task_id: 'runtime-1',
    bound_tab_id: 7,
    terminal_status: 'completed',
    outcome: 'verified_pass',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: 'receipt-1',
    has_runtime_receipt: true,
    runtime_receipt_id: 'receipt-1',
    receipt_count: 1,
    completion_result_count: 1,
    deliverable_count: 1,
    deliverable_required: true,
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
  outcome: 'verified_pass',
  deliverableRequired: true,
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
      path: `dist/${file.path}`,
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
      path: `dist/${file.path}`,
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
      final_deliverable: '',
    }),
    false,
  );
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
  assert.equal(
    taskSpecificVerificationPass('013-A01', {
      ...payload,
      final_deliverable: '标题：Wikipedia；域名：wikipedia.org',
    }),
    true,
  );
  assert.equal(
    taskSpecificVerificationPass('013-A01', {
      ...payload,
      final_deliverable: '标题：Wikipedia；域名：wikipedia.org.evil.example',
    }),
    false,
  );
});

test('B07 navigation completion does not invent a text deliverable', () => {
  const payload = {
    task_id: '013-B07',
    outcome: 'verified_pass',
    target_url: 'https://www.iana.org/help/example-domains',
    final_deliverable: '',
    navigation_evidence: [{ url: 'https://www.iana.org/help/example-domains', title: 'Example Domains' }],
  };
  assert.equal(taskSpecificVerificationPass('013-B07', payload), true);
});

test('O1 requires one scoped UI delivery cross-checked against the page effect', () => {
  const form = {
    label: 'form',
    terminal_status: 'completed',
    runtime_status: 'completed',
    ui_status: 'completed',
    receipt_id: 'receipt-1',
    receipt_count: 1,
    completion_result: 'Saved successfully',
    completion_result_count: 1,
    deliverable: 'Saved successfully',
    deliverable_count: 1,
    page_evidence: 'Saved successfully',
    expected_effect: 'Saved successfully',
    runtime_task_id: 'runtime-1',
    runtime_round_id: 'round-1',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: 'receipt-1',
    has_runtime_receipt: true,
    runtime_receipt_id: 'receipt-1',
    runtime_receipt_task_id: 'runtime-1',
    runtime_receipt_round_id: 'round-1',
    submit_count: 1,
    quiescence_ms: 2500,
    quiescence_confirmations: 3,
  };
  const payload = {
    task_id: '018-O1',
    outcome: 'verified_pass',
    terminal_status: 'completed',
    runtime_status: 'completed',
    ui_status: 'completed',
    runtime_task_id: 'runtime-1',
    runtime_round_id: 'round-1',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: 'receipt-1',
    has_runtime_receipt: true,
    runtime_receipt_id: 'receipt-1',
    runtime_receipt_task_id: 'runtime-1',
    runtime_receipt_round_id: 'round-1',
    receipt_count: 1,
    completion_result: 'Saved successfully',
    completion_result_count: 1,
    deliverable_count: 1,
    final_deliverable: 'Saved successfully',
    privacy_pass: true,
    scenario_evidence: [form],
  };
  assert.equal(taskSpecificVerificationPass('018-O1', payload), true);
  assert.deepEqual(
    [
      taskSpecificVerificationPass('018-O1', {
        ...payload,
        runtime_status: 'failed',
        ui_status: 'completed',
        scenario_evidence: [{ ...form, runtime_status: 'failed', ui_status: 'completed' }],
      }),
      taskSpecificVerificationPass('018-O1', {
        ...payload,
        runtime_receipt_task_id: 'old-task',
        runtime_receipt_round_id: 'old-round',
        scenario_evidence: [
          {
            ...form,
            runtime_receipt_task_id: 'old-task',
            runtime_receipt_round_id: 'old-round',
          },
        ],
      }),
    ],
    [false, false],
  );
  assert.deepEqual(
    verificationEvidenceProtocolErrors(payload, {
      outcome: 'verified_pass',
      runtimeTaskId: 'runtime-1',
      deliverableRequired: true,
    }),
    [],
  );
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

test('O1 rejects page success when the scoped UI card has no deliverable', () => {
  const form = {
    label: 'form',
    terminal_status: 'completed',
    receipt_id: 'receipt-1',
    receipt_count: 1,
    completion_result: 'Saved successfully',
    completion_result_count: 1,
    deliverable: '',
    deliverable_count: 0,
    page_evidence: 'Saved successfully',
    expected_effect: 'Saved successfully',
    runtime_task_id: 'runtime-1',
    runtime_round_id: 'round-1',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: 'receipt-1',
    has_runtime_receipt: true,
    runtime_receipt_id: 'receipt-1',
    submit_count: 1,
    quiescence_ms: 2500,
    quiescence_confirmations: 3,
  };
  const payload = {
    task_id: '018-O1',
    outcome: 'verified_pass',
    runtime_task_id: 'runtime-1',
    runtime_round_id: 'round-1',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: 'receipt-1',
    has_runtime_receipt: true,
    runtime_receipt_id: 'receipt-1',
    receipt_count: 1,
    completion_result: 'Saved successfully',
    completion_result_count: 1,
    deliverable_count: 0,
    final_deliverable: '',
    privacy_pass: true,
    scenario_evidence: [form],
  };

  assert.equal(taskSpecificVerificationPass('018-O1', payload), false);
  assert(
    verificationEvidenceProtocolErrors(payload, {
      outcome: 'verified_pass',
      runtimeTaskId: 'runtime-1',
      deliverableRequired: true,
    }).length > 0,
  );
});

test('O1 rejects a real UI deliverable when page evidence misses the expected effect', () => {
  const form = {
    label: 'form',
    terminal_status: 'completed',
    receipt_id: 'receipt-1',
    receipt_count: 1,
    completion_result: 'Saved successfully',
    completion_result_count: 1,
    deliverable: 'Saved successfully',
    deliverable_count: 1,
    page_evidence: 'Not saved',
    expected_effect: 'Saved successfully',
    runtime_task_id: 'runtime-1',
    runtime_round_id: 'round-1',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: 'receipt-1',
    has_runtime_receipt: true,
    runtime_receipt_id: 'receipt-1',
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

  assert.equal(taskSpecificVerificationPass('018-O1', payload), false);
});

test('product delivery rejects every contradictory highest-price claim regardless of order', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)].join('\n');
  const correct = '最贵商品是 Beta Keyboard，价格为 $25。';
  const wrong = '最贵商品是 Alpha Mouse，价格为 $10。';

  assert.equal(productDeliverablePass(`${table}\n${correct}`, products), true);
  assert.equal(productDeliverablePass(`${table}\n${correct}\n${wrong}`, products), false);
  assert.equal(productDeliverablePass(`${table}\n${wrong}\n${correct}`, products), false);
  assert.equal(productDeliverablePass(`${table}\n${correct}\n但 Beta Keyboard 不是最贵商品。`, products), false);
});

test('product delivery rejects every non-empty line outside the exact table and one conclusion', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)].join('\n');
  const correct = '最贵商品是 Beta Keyboard，价格为 $25。';

  assert.equal(productDeliverablePass(`${table}\n\n${correct}`, products), true);
  assert.equal(productDeliverablePass(`${table}\n${correct}\n实际上 Beta Keyboard 的价格只有 $1。`, products), false);
  assert.equal(productDeliverablePass(`${table}\n${correct}\n补充：Alpha Mouse 评分0。`, products), false);
});

test('product delivery rejects self-retraction or fabrication inside the sole highest-price conclusion', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)].join('\n');
  const retractedConclusions = [
    '最贵商品是 Beta Keyboard，价格为 $25。上述判断纯属编造。',
    '最贵商品是 Beta Keyboard，价格为 $25。这个结论我收回。',
    '最贵商品是 Beta Keyboard，价格为 $25。整份答案作废。',
    'The most expensive item is Beta Keyboard at $25; this claim was made up.',
  ];

  for (const conclusion of retractedConclusions) {
    assert.equal(productDeliverablePass(`${table}\n${conclusion}`, products), false, conclusion);
  }
});

test('product delivery applies uncertainty polarity within its conclusion clause', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)];
  const verify = conclusion => productDeliverablePass([...table, conclusion].join('\n'), products);
  const negativeCases = [
    '最贵商品是 Beta Keyboard，价格为 $25；该结论只是猜测。',
    'The most expensive item is Beta Keyboard at $25; this claim is bogus speculation.',
    '最贵商品是 Beta Keyboard，价格为 $25；该判断仅为推测。',
    'This is an uncorroborated assumption; the most expensive item is Beta Keyboard at $25; sourced.',
    '最贵商品是 Beta Keyboard，价格为 $25；该结论仍不确定。',
    '最贵商品是 Beta Keyboard，价格为 $25；以上内容都是瞎说。',
    '最贵商品是 Beta Keyboard，价格为 $25；我推翻这个结论。',
    '最贵商品是 Beta Keyboard，价格为 $25；我改口。',
    'The most expensive item is Beta Keyboard at $25; I rescind this conclusion.',
    'The most expensive item is Beta Keyboard at $25; I renounce this conclusion.',
    'The most expensive item is Beta Keyboard at $25; this is merely a theory.',
    '最贵商品是 Beta Keyboard，价格为 $25；这只是主观判断。',
    '最贵商品是 Beta Keyboard，价格为 $25；该结论未经核实。',
  ];
  const positiveControls = [
    '不要编造；以下来自页面：最贵商品是 Beta Keyboard，价格为 $25。',
    '以上数据并非错误；最贵商品是 Beta Keyboard，价格为 $25。',
    '不要说上述结论是编造的；最贵商品是 Beta Keyboard，价格为 $25。',
    '以上判断并非推测；最贵商品是 Beta Keyboard，价格为 $25。',
    'This is not an assumption: the most expensive item is Beta Keyboard at $25; sourced.',
    '该结论并非不确定；最贵商品是 Beta Keyboard，价格为 $25。',
    '以上内容没有错误；最贵商品是 Beta Keyboard，价格为 $25。',
    '我没有猜测；最贵商品是 Beta Keyboard，价格为 $25。',
    'I did not guess; the most expensive item is Beta Keyboard at $25.',
    'This is definitely not a guess; the most expensive item is Beta Keyboard at $25.',
  ];

  for (const conclusion of negativeCases) assert.equal(verify(conclusion), false, conclusion);
  for (const conclusion of positiveControls) assert.equal(verify(conclusion), true, conclusion);
});

test('product delivery scopes negation at commas and resolves highest-price denial by parity', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)];
  const verify = conclusion => productDeliverablePass([...table, conclusion].join('\n'), products);

  assert.equal(verify('没有读取折扣，以上结论错误；最贵商品是 Beta Keyboard，价格为 $25。'), false);
  assert.equal(verify('没有读取折扣；最贵商品是 Beta Keyboard，价格为 $25。'), true);
  assert.equal(verify('没有读取折扣并认为以上结论错误；最贵商品是 Beta Keyboard，价格为 $25。'), false);
  assert.equal(verify('没有读取折扣并报告最贵商品是 Beta Keyboard，价格为 $25。'), true);
  assert.equal(verify('Beta Keyboard 不是最贵商品，价格为 $25。'), false);
  assert.equal(verify('Beta Keyboard 并非不是最贵商品，价格为 $25。'), true);
});

test('product delivery permits only its bounded display title outside the exact tuple structure', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)].join('\n');
  const conclusion = '最贵商品是 Beta Keyboard，价格为 $25。';

  assert.equal(productDeliverablePass(`商品提取结果：\n${table}\n${conclusion}`, products), true);
  assert.equal(productDeliverablePass(`商品提取结果：\n${table}\n${conclusion}\nBeta 的折扣最大。`, products), false);
});

test('LH04 rejects extra contradictory source claims instead of ignoring observation three', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const deliverable = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ].join('\n');

  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable,
      navigationEvidence,
    }),
    true,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: `${deliverable}\n观察三：IANA 的示例域名不是用于文档或测试用途。`,
      navigationEvidence,
    }),
    false,
  );
});

test('LH04 rejects every free-form line outside its fixed five-line delivery', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const deliverable = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ].join('\n');
  const verify = candidate =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: candidate,
      navigationEvidence,
    });

  assert.equal(verify(deliverable), true);
  assert.equal(
    verify(
      [
        'IANA 标题：Example Domains；完整URL：https://www.iana.org/help/example-domains',
        'Wikipedia 标题：Web browser；完整URL：https://en.wikipedia.org/wiki/Web_browser',
        `Wikipedia 首段第一句：${definition}`,
        '',
        '观察一：IANA 解释了示例域名用于文档和测试。',
        '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
      ].join('\n'),
    ),
    true,
  );
  assert.equal(verify(`${deliverable}\n实际上网页浏览器是一种纸质书，与软件和网络无关。`), false);
  assert.equal(verify(`${deliverable}\n补充：今天阳光很好。`), false);
});

test('LH04 rejects self-fabrication appended inside either required observation', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const lines = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ];
  const verify = candidate =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: candidate.join('\n'),
      navigationEvidence,
    });

  assert.equal(verify(lines), true);
  assert.equal(verify(lines.with(3, `${lines[3]}这段话纯属虚构。`)), false);
  assert.equal(verify(lines.with(4, `${lines[4]}这只是我编的。`)), false);
});

test('LH04 applies uncertainty polarity to both required observation fields', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const base = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名保留用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ];
  const verify = lines =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: lines.join('\n'),
      navigationEvidence,
    });
  const negativeCases = [
    base.with(3, `${base[3]}该观察未经核实。`),
    base.with(4, `${base[4]}This observation is just a guess.`),
    base.with(3, `${base[3]}此说法纯属臆测。`),
    base.with(4, `${base[4]}以上内容是胡编乱造的。`),
    base.with(3, `${base[3]}我撤回这个观察。`),
    base.with(4, `${base[4]}该观察待查证。`),
    base.with(3, `${base[3]}This observation is an unconfirmed conjecture.`),
  ];
  const positiveControls = [
    base.with(3, `观察一：不要编造；以下来自页面：IANA 解释了示例域名保留用于文档和测试。`),
    base.with(4, `观察二：以上数据并非错误；Wikipedia 将浏览器定义为访问网站的应用软件。`),
    base.with(4, `观察二：不要说上述结论是编造的；Wikipedia 将浏览器定义为访问网站的应用软件。`),
    base.with(3, `观察一：该观察并非推测；IANA 解释了示例域名保留用于文档和测试。`),
    base.with(4, `观察二：This is not a conjecture; Wikipedia 将浏览器定义为访问网站的应用软件。`),
  ];

  for (const lines of negativeCases) assert.equal(verify(lines), false, lines.join(' | '));
  for (const lines of positiveControls) assert.equal(verify(lines), true, lines.join(' | '));
});

test('LH04 scopes an unrelated negation away from a later global observation retraction', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const base = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名保留用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ];
  const verify = lines =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: lines.join('\n'),
      navigationEvidence,
    });

  assert.equal(verify(base.with(3, `观察一：没有读取折扣；${base[3].slice(4)}`)), true);
  assert.equal(verify(base.with(3, `观察一：没有读取折扣，以上观察错误；${base[3].slice(4)}`)), false);
  assert.equal(verify(base.with(3, `观察一：没有读取折扣并认为以上观察错误；${base[3].slice(4)}`)), false);
  assert.equal(verify(base.with(3, `观察一：没有读取折扣并报告${base[3].slice(4)}`)), true);
  assert.equal(verify(base.with(4, `观察二：没有读取折扣；${base[4].slice(4)}`)), true);
  assert.equal(verify(base.with(4, `观察二：没有读取折扣，以上观察错误；${base[4].slice(4)}`)), false);
});

test('LH04 distinguishes forbidden IANA disposition facts from their explicit negation', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const base = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名保留用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ];
  const verify = ianaObservation =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: base.with(3, `观察一：${ianaObservation}`).join('\n'),
      navigationEvidence,
    });

  assert.equal(verify('IANA 说明示例域名用于注册分配，也用于文档和测试。'), false);
  assert.equal(verify('IANA 说明示例域名保留用于文档测试，也可以转让。'), false);
  assert.equal(verify('IANA 说明示例域名保留用于文档和测试，不可注册或转让。'), true);
  assert.equal(verify('IANA 说明示例域名不用于注册或分配，只保留供文档测试。'), true);
  assert.equal(verify('IANA 说明示例域名不能被注册、分配或转让，只保留供文档测试。'), true);
  assert.equal(verify('IANA 说明示例域名用于文档测试，不能注册，但可以转让。'), false);
  assert.equal(verify('IANA 说明示例域名用于文档，但不用于测试，且不可注册。'), true);
  assert.equal(verify('IANA 说明示例域名不用于文档，只用于测试，且不可分配。'), true);
  assert.equal(verify('IANA 将示例域名保留作产品文档中的占位示例，而且这些域名不可注册。'), true);
  assert.equal(verify('IANA 把示例域名供自动化测试使用，并明确禁止分配。'), true);
  assert.equal(verify('文档示例所需的域名由 IANA 作为示例域名保留，不可注册。'), true);
  assert.equal(verify('IANA 说明示例域名不是不用于文档，且不可注册。'), true);
  assert.equal(verify('IANA 说明示例域名保留用于文档，并非不能注册。'), false);
  assert.equal(verify('IANA 说明示例域名保留用于测试，不是不得转让。'), false);
  assert.equal(verify('IANA 说明示例域名未禁止用于文档，且不可注册。'), false);
});

test('LH04 permits only a bounded title and URL-only source footer around five unique facts', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const core = [
    '观察一：IANA 解释了示例域名保留用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
  ];
  const verify = lines =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: lines.join('\n'),
      navigationEvidence,
    });

  assert.equal(
    verify([
      '双来源交付：',
      ...core,
      '来源：https://www.iana.org/help/example-domains；https://en.wikipedia.org/wiki/Web_browser',
    ]),
    true,
  );
  assert.equal(verify(['双来源交付：IANA 与 Wikipedia 均可信', ...core]), false);
  assert.equal(verify([...core, '来源：https://www.iana.org/help/example-domains']), false);
  assert.equal(
    verify([
      ...core,
      '来源：https://www.iana.org/help/example-domains；https://en.wikipedia.org/wiki/Web_browser；均已核实',
    ]),
    false,
  );
});

test('LH04 classifies its five required lines uniquely without imposing presentation order', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const ianaLine = 'Example Domains https://www.iana.org/help/example-domains';
  const wikipediaLine = 'Web browser https://en.wikipedia.org/wiki/Web_browser';
  const firstObservation = '观察一：IANA 解释了示例域名用于文档和测试。';
  const secondObservation = '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-13T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: definition,
      captured_at: '2026-08-13T01:00:01.000Z',
    },
  ];
  const verify = lines =>
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: lines.join('\n'),
      navigationEvidence,
    });

  assert.equal(verify([firstObservation, secondObservation, ianaLine, wikipediaLine, definition]), true);
  assert.equal(verify([firstObservation, secondObservation, ianaLine, ianaLine, definition]), false);
  assert.equal(verify([firstObservation, secondObservation, ianaLine, definition]), false);
  assert.equal(verify([firstObservation, firstObservation, ianaLine, wikipediaLine, definition]), false);
});

test('LH04 accepts a corrected IANA-to-Wikipedia subsequence but not Wiki-to-IANA only', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const wiki = {
    url: 'https://en.wikipedia.org/wiki/Web_browser',
    title: 'Web browser - Wikipedia',
    first_paragraph: definition,
  };
  const iana = {
    url: 'https://www.iana.org/help/example-domains',
    title: 'Example Domains',
  };
  const deliverable = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ].join('\n');
  const correctedSequence = [
    { ...wiki, captured_at: '2026-08-13T01:00:00.000Z' },
    { ...iana, captured_at: '2026-08-13T01:00:01.000Z' },
    { ...wiki, captured_at: '2026-08-13T01:00:02.000Z' },
  ];

  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: wiki.url,
      deliverable,
      navigationEvidence: correctedSequence,
    }),
    true,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: wiki.url,
      deliverable,
      navigationEvidence: correctedSequence.slice(0, 2),
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: wiki.url,
      deliverable: deliverable.replace(definition, 'A web browser is a musical instrument.'),
      navigationEvidence: correctedSequence,
    }),
    false,
  );
  const contradictoryDefinition = 'A web browser is a musical instrument used for performing songs in a concert hall.';
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: wiki.url,
      deliverable: deliverable.replace(definition, contradictoryDefinition),
      navigationEvidence: [
        correctedSequence[0],
        correctedSequence[1],
        { ...correctedSequence[2], first_paragraph: contradictoryDefinition },
      ],
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
    assert(prefixes.includes(`chrome-extension/${suite}`));
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
  assert(errors.some(error => error.includes('completion cardinality')));
  assert(errors.some(error => error.includes('trace is empty')));
});

test('an honest failed task keeps strict identity without pretending it completed', () => {
  const trace = validTrace();
  Object.assign(trace, {
    terminal_status: 'failed',
    trace_terminal_status: 'failed',
    outcome: 'fail',
    visible_receipt_id: '',
    has_runtime_receipt: false,
    runtime_receipt_id: '',
    receipt_count: 0,
    completion_result_count: 0,
    deliverable_count: 0,
  });
  trace.spans = trace.spans.slice(0, 1);
  assert.deepEqual(validateScopedTraceEvidence(trace, { ...traceContext, outcome: 'fail' }), []);
  trace.has_runtime_receipt = true;
  trace.runtime_receipt_id = 'hidden-receipt';
  assert(
    validateScopedTraceEvidence(trace, { ...traceContext, outcome: 'fail' }).some(error =>
      error.includes('retains receipt'),
    ),
  );
  trace.has_runtime_receipt = false;
  trace.runtime_receipt_id = '';
  trace.runtime_task_id = 'other-task';
  assert(
    validateScopedTraceEvidence(trace, { ...traceContext, outcome: 'fail' }).some(error =>
      error.includes('runtime identity'),
    ),
  );
});

test('a timed-out running task remains attributable failure evidence', () => {
  const trace = validTrace();
  Object.assign(trace, {
    terminal_status: 'running',
    trace_terminal_status: null,
    outcome: 'fail',
    visible_receipt_id: '',
    has_runtime_receipt: false,
    runtime_receipt_id: '',
    receipt_count: 0,
    completion_result_count: 0,
    deliverable_count: 0,
  });
  trace.spans = trace.spans.slice(0, 1);
  assert.deepEqual(validateScopedTraceEvidence(trace, { ...traceContext, outcome: 'fail' }), []);
});

test('gate rejects contradictory or unscoped honest-failure verification evidence', () => {
  const payload = {
    terminal_status: 'failed',
    runtime_round_id: 'round-1',
    scoped_card_count: 1,
    ui_task_id: 'runtime-1',
    ui_round_id: 'round-1',
    visible_receipt_id: '',
    has_runtime_receipt: false,
    runtime_receipt_id: '',
    receipt_count: 0,
    completion_result_count: 0,
    deliverable_count: 0,
  };
  const context = { outcome: 'fail', runtimeTaskId: 'runtime-1', deliverableRequired: true };
  assert.deepEqual(verificationEvidenceProtocolErrors(payload, context), []);
  for (const forged of [
    { ...payload, has_runtime_receipt: true, runtime_receipt_id: 'hidden-receipt' },
    { ...payload, visible_receipt_id: 'old-receipt' },
    { ...payload, scoped_card_count: 0 },
    { ...payload, scoped_card_count: 2 },
    { ...payload, ui_task_id: 'old-task' },
    { ...payload, ui_round_id: 'old-round' },
  ]) {
    assert(verificationEvidenceProtocolErrors(forged, context).length > 0);
  }
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
    { code: '??', path: 'scripts/attack.mjs' },
  ]);
  assert.deepEqual(classified.allowedUntracked, ['.omo/state.json', 'clicky/session.json', 'reports/eval/run.json']);
  assert.deepEqual(classified.blocking, [{ code: '??', path: 'scripts/attack.mjs' }]);
});

test('empty directories do not make a committed checkout look dirty', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eval-empty-directories-'));
  try {
    const initialized = spawnSync('git', ['init', '--quiet'], { cwd: root, encoding: 'utf8' });
    assert.equal(initialized.status, 0, initialized.stderr);
    await mkdir(path.join(root, 'empty', 'nested'), { recursive: true });
    assert.deepEqual(readWorkspaceStatus(root), { allowedUntracked: [], blocking: [] });

    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'untracked.ts'), 'export {}\n');
    assert.deepEqual(readWorkspaceStatus(root).blocking, [{ code: '??', path: 'src/untracked.ts' }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
