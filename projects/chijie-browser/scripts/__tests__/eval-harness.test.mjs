import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  canonicalizeMatrixRow,
  evalIdentityKey,
  inferAttachMode,
  matrixProtocolCount,
  missingMatrixRow,
  parseMatrixRows,
  reconcileRunnerExit,
  uniqueEvalRows,
  validateRunnerMatrixRow,
} from '../lib/eval-harness.mjs';
import {
  FINAL_DELIVERABLE_SELECTOR,
  multiSourceDeliveryPass,
  productDeliverablePass,
  tabProvenanceWrongTab,
  wrongTabFromIds,
} from '../../chrome-extension/scripts/lib/eval-verification.mjs';
import { resolveEvalProxyArgs, validateEvalSeedReadback } from '../../chrome-extension/scripts/lib/eval-provider.mjs';

test('missing runner protocol is invalid even when the process exits zero', () => {
  const parsed = parseMatrixRows('runner completed successfully\n');
  assert.deepEqual(parsed, []);
  assert.equal(
    missingMatrixRow({
      taskId: 'LH-1',
      attempt: 2,
      model: 'MiniMax-M3',
      promptVersion: 'p1',
      policyTag: 'baseline',
      latencyMs: 10,
      exitCode: 0,
    }).outcome,
    'invalid_run',
  );
});

test('matrix identity replaces a legacy runner hard-coded attempt', () => {
  const row = canonicalizeMatrixRow(
    { task_id: 'stale', attempt: 1, model: 'stale', outcome: 'verified_pass' },
    {
      taskId: 'LH-1',
      attempt: 3,
      gitSha: 'abc123',
      model: 'MiniMax-M3',
      promptVersion: 'p1',
      policyTag: 'policy-a',
    },
  );
  assert.equal(row.task_id, 'LH-1');
  assert.equal(row.attempt, 3);
  assert.equal(row.model, 'MiniMax-M3');
});

test('non-zero process exit cannot retain a verified pass row', () => {
  const row = reconcileRunnerExit({ outcome: 'verified_pass', notes: 'claimed pass' }, 1);
  assert.equal(row.outcome, 'invalid_run');
  assert.equal(row.failure_class, 'harness_exit');
});

test('runner protocol requires one complete row with matching attempt and security provenance', () => {
  const row = {
    campaign_stamp: 'campaign-1',
    arm_hash: 'a'.repeat(64),
    run_id: 'b'.repeat(64),
    task_id: 'LH-1',
    attempt: 2,
    model: 'MiniMax-M3',
    provider: 'minimax',
    provider_base_url: 'https://api.minimaxi.com/v1',
    feature_flags_hash: '5'.repeat(64),
    attach_mode: 'unit',
    prompt_version: 'p1',
    policy_tag: 'baseline',
    outcome: 'verified_pass',
    false_complete: 0,
    wrong_tab: 0,
    unapproved_commit: 0,
  };
  assert.equal(matrixProtocolCount(`matrix_row ${JSON.stringify(row)}\nmatrix_row ${JSON.stringify(row)}`), 2);
  assert.deepEqual(validateRunnerMatrixRow(row, { taskId: 'LH-1', attempt: 2 }), []);
  assert(validateRunnerMatrixRow({ ...row, outcome: 'banana' }, { taskId: 'LH-1', attempt: 2 }).length > 0);
  assert(validateRunnerMatrixRow({ ...row, wrong_tab: '' }, { taskId: 'LH-1', attempt: 2 }).length > 0);
});

test('merge identity is complete but one task attempt cannot be overwritten by another arm', () => {
  const base = {
    task_id: 'LH-1',
    attempt: '1',
    git_sha: 'abc123',
    model: 'MiniMax-M3',
    prompt_version: 'p1',
    policy_tag: 'baseline',
    attach_mode: 'connected_cdp',
  };
  for (const field of ['task_id', 'attempt', 'git_sha', 'model', 'prompt_version', 'policy_tag', 'attach_mode']) {
    assert.notEqual(evalIdentityKey(base), evalIdentityKey({ ...base, [field]: `${base[field]}-other` }));
  }
  assert.throws(() => uniqueEvalRows([base, { ...base }]), /duplicate task attempt/);
  assert.throws(() => uniqueEvalRows([base, { ...base, model: 'attacker-model' }]), /duplicate task attempt/);
  assert.throws(() => uniqueEvalRows([]), /zero eval rows/);
});

test('fixture oracle requires an exact CSV tuple set plus the correct highest-price conclusion', () => {
  const promptText = 'Return all products as name,price,rating and state the most expensive item';
  const products = Array.from({ length: 5 }, (_, index) => ({
    name: `dynamic-${index}`,
    price: `$${index + 1}`,
    rating: `${4 + index / 10}`,
  }));
  const rows = products.map(product => `${product.name},${product.price},${product.rating}`);
  const valid = [
    '已提取 5 件商品：',
    '```csv',
    'name,price,rating',
    ...rows,
    '```',
    '最贵商品是 dynamic-4，价格为 $5。',
  ].join('\n');
  assert.equal(FINAL_DELIVERABLE_SELECTOR, '[data-testid="completion-deliverable-copy"]');
  assert.equal(productDeliverablePass(valid, products), true);
  assert.equal(productDeliverablePass(promptText, products), false);
  assert.equal(productDeliverablePass(`name,price,rating\n${products[0].name},$1,4`, products), false);
  assert.equal(
    productDeliverablePass(`name,price,rating\n${rows.join('\n')}\n最贵商品是 dynamic-3，价格为 $4。`, products),
    false,
  );
  assert.equal(productDeliverablePass(`name,price,rating\n${rows.join('\n')}`, products), false);
  for (const forgedPrice of ['$5.001', '$5.009', '$5.00x', '$50']) {
    assert.equal(
      productDeliverablePass(
        `name,price,rating\n${rows.join('\n')}\n最贵商品是 dynamic-4，价格为 ${forgedPrice}。`,
        products,
      ),
      false,
    );
  }
});

test('fixture oracle rejects token bags, wrong columns, duplicates, and fabricated CSV rows', () => {
  const products = Array.from({ length: 5 }, (_, index) => ({
    name: `product-${index}`,
    price: `$${index + 1}`,
    rating: `${4 + index / 10}`,
  }));
  const rows = products.map(product => `${product.name},${product.price},${product.rating}`);
  const conclusion = '最贵商品是 product-4，价格为 $5。';
  const tokenBag = [
    'name,price,rating',
    products.map(product => product.name).join(','),
    products.map(product => product.price).join(','),
    products.map(product => product.rating).join(','),
    conclusion,
  ].join('\n');
  const wrongColumns = [
    'name,price,rating',
    ...products.map(product => `${product.name},${product.rating},${product.price}`),
    conclusion,
  ].join('\n');
  const duplicate = ['name,price,rating', rows[0], rows[0], ...rows.slice(2), conclusion].join('\n');
  const extraRow = ['name,price,rating', ...rows, 'fabricated,$999,5.0', conclusion].join('\n');
  const hiddenExtraRow = ['name,price,rating', ...rows, '', 'fabricated,$999,5.0', conclusion].join('\n');
  const negatedConclusion = ['name,price,rating', ...rows, 'product-4 并非最贵商品，它的价格是 $5。'].join('\n');
  const contradictoryConclusion = [
    'name,price,rating',
    ...rows,
    '最贵商品是 product-3，价格为 $4；product-4 的价格是 $5。',
  ].join('\n');
  const globallyRetracted = ['name,price,rating', ...rows, conclusion, '以上表格数据全部都是错误的。'].join('\n');

  for (const deliverable of [
    tokenBag,
    wrongColumns,
    duplicate,
    extraRow,
    hiddenExtraRow,
    negatedConclusion,
    contradictoryConclusion,
    globallyRetracted,
  ]) {
    assert.equal(productDeliverablePass(deliverable, products), false);
  }
});

test('R1 scorer only reads one task-scoped deliverable and a matching receipt', () => {
  const source = readFileSync(new URL('../../chrome-extension/scripts/r1-extract-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /FINAL_DELIVERABLE_SELECTOR/);
  assert.match(source, /readScopedTask/);
  assert.match(source, /deliverableCount === 1/);
  assert.match(source, /receiptCount === 1/);
  assert.doesNotMatch(source, /instructionSummary/);
  assert.doesNotMatch(source, /scoreCsvText\(snap\.body/);
});

test('public and frontier body_contains_all score only the unique final deliverable', () => {
  for (const relative of [
    '../../chrome-extension/scripts/eval-public-task.mjs',
    '../../chrome-extension/scripts/eval-frontier-task.mjs',
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /document\.querySelectorAll\(deliverableSelector\)/);
    assert.match(source, /case 'body_contains_all':[\s\S]{0,240}return deliverableContainsAll\(answer, expected\)/);
    assert.doesNotMatch(source, /deliverableContainsAll\((?:body|goal|prompt)/);
  }
});

test('wrong-tab metric uses observed bound and active tab ids', () => {
  assert.equal(wrongTabFromIds(12, 12), 0);
  assert.equal(wrongTabFromIds(12, 13), 1);
  assert.equal(wrongTabFromIds(12, undefined), null);
  assert.equal(tabProvenanceWrongTab([{ task_tab_id: 12, target_tab_id: 12 }], [12]), 0);
  assert.equal(tabProvenanceWrongTab([{ task_tab_id: 12, target_tab_id: 13 }], [12]), 1);
  assert.equal(tabProvenanceWrongTab([{ active_tab_id: 13 }], [12]), null);
  assert.equal(tabProvenanceWrongTab([{ active_tab_id: 13, enforce_active: true }], [12]), 1);
});

test('multi-source regression requires real visits plus the complete final deliverable', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const navigationEvidence = [
    {
      url: 'https://www.iana.org/help/example-domains',
      title: 'Example Domains',
      captured_at: '2026-08-12T01:00:00.000Z',
    },
    {
      url: 'https://en.wikipedia.org/wiki/Web_browser',
      title: 'Web browser - Wikipedia',
      first_paragraph: `${definition} Users access content over the World Wide Web.`,
      captured_at: '2026-08-12T01:00:01.000Z',
    },
  ];
  const deliverable = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名的用途。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用。',
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
      deliverable,
      navigationEvidence: navigationEvidence.slice(1),
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: `${deliverable}\n以上观察均为错误，未实际访问这些页面。`,
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable
        .replace('观察一：IANA 解释了示例域名的用途。', '观察一：IANA 的示例域名完全不用于文档或测试用途。')
        .replace(
          '观察二：Wikipedia 将浏览器定义为访问网站的应用。',
          '观察二：Wikipedia 说浏览器不是访问网站网页的软件应用。',
        ),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable,
      navigationEvidence: [...navigationEvidence].reverse(),
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable.replace('观察一：IANA 解释了示例域名的用途。', '观察一：'),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable
        .replace('观察一：IANA 解释了示例域名的用途。', '观察一：今天天气晴朗适合出门散步和运动。')
        .replace('观察二：Wikipedia 将浏览器定义为访问网站的应用。', '观察二：今天天气晴朗适合出门散步和运动。'),
      navigationEvidence,
    }),
    false,
  );
  const repeatedObservation = 'IANA 说明示例域名用于文档，Wikipedia 将浏览器定义为访问网站的应用。';
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable
        .replace('观察一：IANA 解释了示例域名的用途。', `观察一：${repeatedObservation}`)
        .replace('观察二：Wikipedia 将浏览器定义为访问网站的应用。', `观察二：${repeatedObservation}`),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable.replace(
        '观察一：IANA 解释了示例域名的用途。',
        '观察一：Wikipedia 将浏览器定义为访问网站的应用。',
      ),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable.replace(
        '观察二：Wikipedia 将浏览器定义为访问网站的应用。',
        '观察二：IANA 解释了示例域名用于文档和测试。',
      ),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: '',
      navigationEvidence,
    }),
    false,
  );
});

test('attach mode distinguishes isolated launch, CDP attach, and unit runners', () => {
  assert.equal(
    inferAttachMode({ script: ['chrome-extension/scripts/eval-public-task.mjs'] }),
    'launched_chrome_for_testing',
  );
  assert.equal(inferAttachMode({ connectUrl: 'http://127.0.0.1:9222' }), 'connected_cdp');
  assert.equal(inferAttachMode({ script: ['scripts/eval-022-unit-gates.mjs'] }), 'unit');
});

test('provider identity is accepted only after storage readback matches both agents and flags', () => {
  const cfg = {
    providerId: 'minimax',
    model: 'MiniMax-M3',
    baseUrl: 'https://api.minimaxi.com/v1',
    type: 'custom_openai',
  };
  const flags = { enableObservationDiff: false };
  const observed = {
    planner_provider_id: 'minimax',
    planner_model: 'MiniMax-M3',
    navigator_provider_id: 'minimax',
    navigator_model: 'MiniMax-M3',
    provider_base_url: 'https://api.minimaxi.com/v1',
    provider_type: 'custom_openai',
    feature_flags: flags,
  };
  assert.deepEqual(validateEvalSeedReadback(cfg, observed, flags), []);
  assert.deepEqual(
    validateEvalSeedReadback(
      cfg,
      { ...observed, feature_flags: { second: true, first: false } },
      {
        first: false,
        second: true,
      },
    ),
    [],
  );
  assert(
    validateEvalSeedReadback(cfg, { ...observed, feature_flags: { ...flags, unexpected: true } }, flags).includes(
      'feature flags',
    ),
  );
  assert(validateEvalSeedReadback(cfg, { ...observed, planner_model: 'spoofed' }, flags).includes('planner model'));
  assert(
    validateEvalSeedReadback(cfg, { ...observed, provider_base_url: 'http://127.0.0.1:9999/v1' }, flags).includes(
      'provider base URL',
    ),
  );
});

test('browser evals inherit a safe proxy without exposing credentials', () => {
  assert.deepEqual(resolveEvalProxyArgs({ HTTPS_PROXY: 'http://127.0.0.1:7897' }), [
    '--proxy-server=http://127.0.0.1:7897',
  ]);
  assert.deepEqual(resolveEvalProxyArgs({ https_proxy: 'socks5://localhost:1080' }), [
    '--proxy-server=socks5://localhost:1080',
  ]);
  assert.deepEqual(resolveEvalProxyArgs({}), []);
  assert.throws(() => resolveEvalProxyArgs({ HTTPS_PROXY: 'ftp://127.0.0.1:21' }), /unsupported protocol/);
  assert.throws(() => resolveEvalProxyArgs({ HTTPS_PROXY: 'http://name:secret@127.0.0.1:7897' }), /credentials/);
});
