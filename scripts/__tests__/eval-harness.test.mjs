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
  completionProtocolErrors,
  COMPLETION_RESULT_SELECTOR,
  FINAL_DELIVERABLE_SELECTOR,
  initialNavigationRetryDecision,
  multiSourceDeliveryPass,
  navigateInitialTargetWithRetry,
  productDeliverablePass,
  productOracleRows,
  r1ProductDeliverablePass,
  scopedCompletionSnapshot,
  tabProvenanceWrongTab,
  taskSpecificVerificationPass,
  verifierRequiresTextDeliverable,
  wrongTabFromIds,
} from '../../chrome-extension/scripts/lib/eval-verification.mjs';
import { resolveEvalProxyArgs, validateEvalSeedReadback } from '../../chrome-extension/scripts/lib/eval-provider.mjs';
import { recordNavigationEvidence } from '../../chrome-extension/scripts/eval-public-task.mjs';

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
  const valid = ['```csv', 'name,price,rating', ...rows, '```', '最贵商品是 dynamic-4，价格为 $5。'].join('\n');
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

test('product oracle accepts the real six-row formatter output and only its fixed CSV prefix', () => {
  const products = [
    { name: 'Alpha Wireless Headphones', price: '$49.99', rating: '4.5' },
    { name: 'Beta Mechanical Keyboard', price: '$89.00', rating: '4.8' },
    { name: 'Gamma USB-C Hub', price: '$34.50', rating: '4.2' },
    { name: 'Delta Desk Lamp', price: '$27.99', rating: '4.0' },
    { name: 'Epsilon Notebook Stand', price: '$19.95', rating: '4.6' },
    { name: 'Zeta Webcam Cover', price: '$8.49', rating: '3.9' },
  ];
  const table = ['name,price,rating', ...products.map(product => `${product.name},${product.price},${product.rating}`)];
  const conclusion = '最贵商品是 Beta Mechanical Keyboard，价格为 $89.00。';
  const formatterOutput = [`已提取 ${products.length} 件商品（CSV）：`, ...table].join('\n');
  const deliverable = `${formatterOutput}\n${conclusion}`;

  assert.equal(deliverable.split('\n').length, 9);
  assert.equal(productDeliverablePass(deliverable, products), true);
  assert.equal(productDeliverablePass([...table, conclusion].join('\n'), products), true);
  assert.equal(productDeliverablePass(deliverable.replace('已提取 6 件', '已提取 5 件'), products), false);
  assert.equal(productDeliverablePass(deliverable.replace('（CSV）', '（Markdown）'), products), false);
  assert.equal(productDeliverablePass(`商品提取结果：\n${table.join('\n')}\n${conclusion}`, products), true);
  assert.equal(productDeliverablePass(`商品提取结果：\n${deliverable}`, products), true);
  assert.equal(productDeliverablePass(`任意分析标题：\n${table.join('\n')}\n${conclusion}`, products), false);
  const wrapped = [{ name: '', price: '', rating: '' }, ...products];
  assert.equal(productOracleRows(wrapped).length, 6);
  assert.equal(productDeliverablePass(deliverable, wrapped), true);
  assert.equal(productDeliverablePass(deliverable.replace(/\n/g, ' '), products), false);
});

test('R1 accepts the real CSV or Markdown formatter table without weakening LH03', () => {
  const products = [
    { name: 'Alpha Wireless Headphones', price: '$49.99', rating: '4.5' },
    { name: 'Beta Mechanical Keyboard', price: '$89.00', rating: '4.8' },
    { name: 'Gamma USB-C Hub', price: '$34.50', rating: '4.2' },
    { name: 'Delta Desk Lamp', price: '$27.99', rating: '4.0' },
    { name: 'Epsilon Notebook Stand', price: '$19.95', rating: '4.6' },
    { name: 'Zeta Webcam Cover', price: '$8.49', rating: '3.9' },
  ];
  const csvRows = products.map(product => `${product.name},${product.price},${product.rating}`);
  const csv = [`已提取 ${products.length} 件商品（CSV）：`, 'name,price,rating', ...csvRows].join('\n');
  const markdown = [
    `已提取 ${products.length} 件商品（Markdown）：`,
    '| name | price | rating |',
    '| --- | --- | --- |',
    ...products.map(product => `| ${product.name} | ${product.price} | ${product.rating} |`),
  ].join('\n');
  const payload = final_deliverable => ({
    task_id: '018-R1',
    outcome: 'verified_pass',
    final_deliverable,
    source_products: products,
  });

  assert.equal(taskSpecificVerificationPass('018-R1', payload(csv)), true);
  assert.equal(taskSpecificVerificationPass('018-R1', payload(markdown)), true);
  assert.equal(taskSpecificVerificationPass('018-R1', payload(csv.replace(csvRows[2], 'forged,$999,5'))), false);
  assert.equal(taskSpecificVerificationPass('018-R1', payload(csv.replace(`${csvRows[2]}\n`, ''))), false);
  assert.equal(
    taskSpecificVerificationPass('021-LH-03', {
      ...payload(csv),
      task_id: '021-LH-03',
    }),
    false,
  );
});

test('product oracle allows provenance and anti-fabrication wording that does not retract its conclusion', () => {
  const products = [
    { name: 'Alpha Mouse', price: '$10', rating: '4.1' },
    { name: 'Beta Keyboard', price: '$25', rating: '4.8' },
    { name: 'Gamma Stand', price: '$18', rating: '4.4' },
    { name: 'Delta Hub', price: '$15', rating: '4.2' },
    { name: 'Epsilon Cable', price: '$8', rating: '4.0' },
  ];
  const table = ['name,price,rating', ...products.map(item => `${item.name},${item.price},${item.rating}`)];

  assert.equal(
    productDeliverablePass(
      [...table, '不要编造；以下来自页面：最贵商品是 Beta Keyboard，价格为 $25。'].join('\n'),
      products,
    ),
    true,
  );
  assert.equal(
    productDeliverablePass(
      [...table, 'Do not fabricate; from the page: the most expensive item is Beta Keyboard at $25; sourced.'].join(
        '\n',
      ),
      products,
    ),
    true,
  );
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
  assert.match(source, /scopedCompletionSnapshot/);
  assert.match(source, /completionProtocolErrors/);
  assert.match(source, /data-task-id/);
  assert.match(source, /data-round-id/);
  assert.match(source, /data-receipt-id/);
  assert.match(source, /priorReceiptIds/);
  assert.match(source, /scopedTasks\.length > 1/);
  assert.match(source, /newReceiptIds\.length !== 1/);
  assert.match(source, /card\.querySelectorAll\(deliverableSelector\)/);
  assert.match(source, /deliverableRequired: true/);
  assert.match(source, /completion_result_count: result\.completionResultCount/);
  assert.match(source, /productOracleRows/);
  assert.doesNotMatch(source, /\[data-testid\^="product-"\]/);
  assert.doesNotMatch(source, /seenRunning/);
  assert.doesNotMatch(source, /document\.querySelectorAll\(deliverableSelector\)/);
  assert.doesNotMatch(source, /instructionSummary/);
  assert.doesNotMatch(source, /scoreCsvText\(snap\.body/);
});

test('R1 runner applies its own R1 verifier to real formatter CSV and Markdown', () => {
  const source = readFileSync(new URL('../../chrome-extension/scripts/r1-extract-e2e.mjs', import.meta.url), 'utf8');
  const verifierName = /const oraclePass = (\w+)\(snap\.answer, products\)/.exec(source)?.[1];
  assert.equal(verifierName, 'r1ProductDeliverablePass');
  assert.doesNotMatch(source, /\bproductDeliverablePass\b/);

  const products = [
    { name: 'Alpha Wireless Headphones', price: '$49.99', rating: '4.5' },
    { name: 'Beta Mechanical Keyboard', price: '$89.00', rating: '4.8' },
    { name: 'Gamma USB-C Hub', price: '$34.50', rating: '4.2' },
    { name: 'Delta Desk Lamp', price: '$27.99', rating: '4.0' },
    { name: 'Epsilon Notebook Stand', price: '$19.95', rating: '4.6' },
    { name: 'Zeta Webcam Cover', price: '$8.49', rating: '3.9' },
  ];
  const verifier = { r1ProductDeliverablePass }[verifierName];
  const csvRows = products.map(product => `${product.name},${product.price},${product.rating}`);
  const csv = [`已提取 ${products.length} 件商品（CSV）：`, 'name,price,rating', ...csvRows].join('\n');
  const markdown = [
    `已提取 ${products.length} 件商品（Markdown）：`,
    '| name | price | rating |',
    '| --- | --- | --- |',
    ...products.map(product => `| ${product.name} | ${product.price} | ${product.rating} |`),
  ].join('\n');

  assert.equal(verifier(csv, products), true);
  assert.equal(verifier(markdown, products), true);
  assert.equal(verifier(csv.replace(`${csvRows[2]}\n`, ''), products), false);
  assert.equal(verifier(csv.replace(csvRows[2], 'forged,$999,5'), products), false);
});

test('R1 honest failures and timeouts keep their new task and current card identity', () => {
  const source = readFileSync(new URL('../../chrome-extension/scripts/r1-extract-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /runtimeTaskId = scopedTask\.taskId/);
  assert.match(source, /latestResult = snap/);
  assert.match(source, /runtimeTaskSnapshot = runtimeTask/);
  assert.match(source, /terminal_status: latestResult\?\.status \?\? runtimeTaskSnapshot\?\.status/);
  assert.match(source, /scoped_card_count: latestResult\?\.scopedCardCount/);
  assert.match(source, /ui_task_id: latestResult\?\.uiTaskId/);
  assert.match(source, /ui_round_id: latestResult\?\.uiRoundId/);
  assert.match(source, /visible_receipt_id: latestResult\?\.visibleReceiptId/);
  assert.match(source, /runtime_task_id: runtimeTaskId/);
});

test('action runner records the unique visible completion result', () => {
  const source = readFileSync(new URL('../../chrome-extension/scripts/action-agent-e2e.mjs', import.meta.url), 'utf8');
  assert.match(source, /querySelectorAll\('\[data-testid="completion-result"\]'\)/);
  assert.match(source, /completionResultCount === 1/);
  assert.match(source, /completion_result_count: scenarios\.reduce/);
});

test('public and frontier body_contains_all score only the unique final deliverable', () => {
  for (const relative of [
    '../../chrome-extension/scripts/eval-public-task.mjs',
    '../../chrome-extension/scripts/eval-frontier-task.mjs',
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
    assert.match(source, /card\.querySelectorAll\(deliverableSelector\)/);
    assert.match(source, /card\.querySelectorAll\(completionResultSelector\)/);
    assert.match(source, /data-task-id/);
    assert.match(source, /data-round-id/);
    assert.match(source, /data-receipt-id/);
    assert.match(source, /navigateInitialTargetWithRetry/);
    assert.match(source, /initial_navigation_attempts/);
    assert.match(source, /initial_navigation_error_categories/);
    assert.match(source, /case 'body_contains_all':[\s\S]{0,240}return deliverableContainsAll\(answer, expected\)/);
    assert.doesNotMatch(source, /deliverableContainsAll\((?:body|goal|prompt)/);
    assert.doesNotMatch(source, /seenRunning/);
    assert.doesNotMatch(source, /wrong_tab:\s*wrongTab\s*\?\?\s*0/);
    assert.match(source, /wrong_tab:\s*wrongTab\s*\?\?\s*''/);
    assert.match(source, /priorReceiptIds/);
    assert.match(source, /runtimeTaskSnapshot/);
    if (relative.endsWith('eval-public-task.mjs')) {
      assert.match(source, /productOracleRows/);
      assert.doesNotMatch(source, /\[data-testid\^="product-"\]/);
    }
  }
});

test('completion protocol accepts a fast new receipt and separates result from optional deliverable', () => {
  assert.equal(COMPLETION_RESULT_SELECTOR, '[data-testid="completion-result"]');
  const runtimeTask = {
    id: 'new-task',
    status: 'completed',
    roundId: 'round-1',
    receipt: { id: 'new-receipt', taskId: 'new-task', roundId: 'round-1' },
  };
  const base = {
    status: 'completed',
    scopedCardCount: 1,
    uiTaskId: 'new-task',
    uiRoundId: 'round-1',
    receiptCount: 1,
    visibleReceiptId: 'new-receipt',
    resultCount: 1,
    resultText: '已到达目标页',
    deliverableCount: 0,
    deliverableText: '',
    deliverableRequired: false,
    runtimeTask,
    priorReceiptIds: ['old-receipt'],
  };
  assert.deepEqual(completionProtocolErrors(base), []);
  assert(
    completionProtocolErrors({
      ...base,
      runtimeTask: { ...runtimeTask, receipt: { ...runtimeTask.receipt, id: 'old-receipt' } },
    }).some(error => error.includes('stale')),
  );
  assert(completionProtocolErrors({ ...base, receiptCount: 2 }).some(error => error.includes('receipt_count')));
  assert(completionProtocolErrors({ ...base, resultCount: 2 }).some(error => error.includes('completion_result')));
  assert(completionProtocolErrors({ ...base, deliverableCount: 2 }).some(error => error.includes('deliverable_count')));
  assert(completionProtocolErrors({ ...base, uiRoundId: 'old-round' }).some(error => error.includes('UI task/round')));
  assert(
    completionProtocolErrors({
      ...base,
      runtimeTask: { ...runtimeTask, receipt: { ...runtimeTask.receipt, roundId: 'old-round' } },
    }).some(error => error.includes('receipt ownership')),
  );
  assert(
    completionProtocolErrors({ ...base, deliverableRequired: true }).some(error => error.includes('deliverable_count')),
  );
  assert.equal(verifierRequiresTextDeliverable('url_contains'), false);
  assert.equal(verifierRequiresTextDeliverable('body_contains'), true);
  assert(
    completionProtocolErrors({
      ...base,
      status: 'failed',
      runtimeTask: { ...runtimeTask, status: 'failed' },
      receiptCount: 0,
      visibleReceiptId: '',
      resultCount: 0,
      resultText: '',
      deliverableCount: 0,
    }).some(error => error.includes('retains runtime receipt')),
  );
});

test('completion snapshot ignores stale cards and rejects a stale visible receipt', () => {
  const runtimeTask = {
    id: 'new-task',
    status: 'completed',
    roundId: 'new-round',
    receipt: { id: 'new-receipt', taskId: 'new-task', roundId: 'new-round' },
  };
  const staleCard = {
    taskId: 'old-task',
    roundId: 'old-round',
    status: 'completed',
    receiptIds: ['old-receipt'],
    resultTexts: ['旧结果'],
    deliverableTexts: ['旧成果'],
  };
  const currentCard = {
    taskId: 'new-task',
    roundId: 'new-round',
    status: 'completed',
    receiptIds: ['new-receipt'],
    resultTexts: ['新结果'],
    deliverableTexts: [],
  };
  const snap = scopedCompletionSnapshot([staleCard, currentCard], runtimeTask);
  assert.equal(snap.scopedCardCount, 1);
  assert.equal(snap.resultText, '新结果');
  assert.equal(snap.visibleReceiptId, 'new-receipt');
  const base = {
    ...snap,
    deliverableText: snap.answer,
    deliverableRequired: false,
    runtimeTask,
    priorReceiptIds: ['old-receipt'],
  };
  assert.deepEqual(completionProtocolErrors(base), []);
  assert(
    completionProtocolErrors({ ...base, visibleReceiptId: 'old-receipt' }).some(error =>
      error.includes('visible receipt ownership'),
    ),
  );
  assert(
    completionProtocolErrors({
      ...scopedCompletionSnapshot([staleCard], runtimeTask),
      deliverableText: '',
      deliverableRequired: false,
      runtimeTask,
      priorReceiptIds: ['old-receipt'],
    }).some(error => error.includes('scoped_card_count')),
  );
  assert(
    completionProtocolErrors({
      ...base,
      ...scopedCompletionSnapshot([currentCard, { ...currentCard }], runtimeTask),
    }).some(error => error.includes('scoped_card_count')),
  );
});

test('initial navigation retries exactly one connection-closed error and preserves failure history', async () => {
  assert.deepEqual(initialNavigationRetryDecision(new Error('net::ERR_CONNECTION_CLOSED at https://a.test'), 1), {
    errorCategory: 'ERR_CONNECTION_CLOSED',
    retry: true,
  });
  for (const error of [
    new Error('net::ERR_CONNECTION_RESET at https://a.test'),
    new Error('net::ERR_CONNECTION_CLOSED_FAKE at https://a.test'),
    new Error('generic navigation failure'),
  ]) {
    assert.equal(initialNavigationRetryDecision(error, 1).retry, false);
  }
  assert.equal(initialNavigationRetryDecision(new Error('net::ERR_CONNECTION_CLOSED'), 2).retry, false);

  let nonRetryCalls = 0;
  await assert.rejects(
    navigateInitialTargetWithRetry({
      url: 'https://a.test',
      navigate: async () => {
        nonRetryCalls += 1;
        throw new Error('net::ERR_CONNECTION_RESET at https://a.test');
      },
      wait: async () => {},
    }),
    /ERR_CONNECTION_RESET/,
  );
  assert.equal(nonRetryCalls, 1);

  const calls = [];
  const states = [];
  const recovered = await navigateInitialTargetWithRetry({
    url: 'https://a.test',
    navigate: async url => {
      calls.push(url);
      if (calls.length === 1) throw new Error('net::ERR_CONNECTION_CLOSED at https://a.test');
    },
    wait: async () => {},
    onState: state => states.push(state),
  });
  assert.deepEqual(calls, ['https://a.test', 'https://a.test']);
  assert.deepEqual(recovered, { attempts: 2, errorCategories: ['ERR_CONNECTION_CLOSED'] });
  assert.deepEqual(states.at(-1), { attempts: 2, errorCategories: ['ERR_CONNECTION_CLOSED'] });

  const failures = [];
  await assert.rejects(
    navigateInitialTargetWithRetry({
      url: 'https://a.test',
      navigate: async () => {
        failures.push('attempt');
        throw new Error('net::ERR_CONNECTION_CLOSED at https://a.test');
      },
      wait: async () => {},
      onState: state => states.push(state),
    }),
    /ERR_CONNECTION_CLOSED/,
  );
  assert.equal(failures.length, 2);
  assert.deepEqual(states.at(-1), {
    attempts: 2,
    errorCategories: ['ERR_CONNECTION_CLOSED', 'ERR_CONNECTION_CLOSED'],
  });
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
    '观察一：IANA 解释了示例域名保留用于文档和测试。',
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
      deliverable: `双来源交付：\n${deliverable}\n来源：https://www.iana.org/help/example-domains；https://en.wikipedia.org/wiki/Web_browser`,
      navigationEvidence,
    }),
    true,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: `双来源交付：\n${deliverable}\n来源：https://www.iana.org/help/example-domains；https://en.wikipedia.org/wiki/Web_browser\n结论：两个来源都非常权威。`,
      navigationEvidence,
    }),
    false,
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
      deliverable: deliverable.replace(
        '观察一：IANA 解释了示例域名保留用于文档和测试。',
        '观察一：不要编造；以下来自页面：IANA 解释了示例域名保留用于文档和测试。',
      ),
      navigationEvidence,
    }),
    true,
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
        .replace('观察一：IANA 解释了示例域名保留用于文档和测试。', '观察一：IANA 的示例域名完全不用于文档或测试用途。')
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
      deliverable: deliverable.replace('观察一：IANA 解释了示例域名保留用于文档和测试。', '观察一：'),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable
        .replace('观察一：IANA 解释了示例域名保留用于文档和测试。', '观察一：今天天气晴朗适合出门散步和运动。')
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
        .replace('观察一：IANA 解释了示例域名保留用于文档和测试。', `观察一：${repeatedObservation}`)
        .replace('观察二：Wikipedia 将浏览器定义为访问网站的应用。', `观察二：${repeatedObservation}`),
      navigationEvidence,
    }),
    false,
  );
  assert.equal(
    multiSourceDeliveryPass({
      finalUrl: 'https://en.wikipedia.org/wiki/Web_browser',
      deliverable: deliverable.replace(
        '观察一：IANA 解释了示例域名保留用于文档和测试。',
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

test('public evidence records navigation events without inflating consecutive polls', () => {
  const definition = 'A web browser, often shortened to browser, is an application for accessing websites.';
  const wiki = {
    url: 'https://en.wikipedia.org/wiki/Web_browser',
    title: 'Web browser - Wikipedia',
    first_paragraph: definition,
  };
  const iana = {
    url: 'https://www.iana.org/help/example-domains',
    title: 'Example Domains',
    first_paragraph: '',
  };
  const deliverable = [
    'Example Domains https://www.iana.org/help/example-domains',
    'Web browser https://en.wikipedia.org/wiki/Web_browser',
    definition,
    '观察一：IANA 解释了示例域名用于文档和测试。',
    '观察二：Wikipedia 将浏览器定义为访问网站的应用软件。',
  ].join('\n');

  const corrected = [];
  recordNavigationEvidence(corrected, { ...wiki, captured_at: '2026-08-13T01:00:00.000Z' });
  recordNavigationEvidence(corrected, { ...iana, captured_at: '2026-08-13T01:00:01.000Z' });
  recordNavigationEvidence(corrected, { ...wiki, captured_at: '2026-08-13T01:00:02.000Z' });
  assert.deepEqual(
    corrected.map(item => [item.sequence, item.url, item.captured_at]),
    [
      [1, wiki.url, '2026-08-13T01:00:00.000Z'],
      [2, iana.url, '2026-08-13T01:00:01.000Z'],
      [3, wiki.url, '2026-08-13T01:00:02.000Z'],
    ],
  );
  assert.equal(multiSourceDeliveryPass({ finalUrl: wiki.url, deliverable, navigationEvidence: corrected }), true);
  assert.equal(
    multiSourceDeliveryPass({ finalUrl: wiki.url, deliverable, navigationEvidence: corrected.slice(0, 2) }),
    false,
  );

  const repeatedPolls = [];
  recordNavigationEvidence(repeatedPolls, { ...iana, title: '', captured_at: '2026-08-13T01:00:00.000Z' });
  recordNavigationEvidence(repeatedPolls, { ...iana, captured_at: '2026-08-13T01:00:01.000Z' });
  recordNavigationEvidence(repeatedPolls, { ...iana, captured_at: '2026-08-13T01:00:02.000Z' });
  assert.equal(repeatedPolls.length, 1);
  assert.equal(repeatedPolls[0].title, 'Example Domains');
  assert.equal(repeatedPolls[0].captured_at, '2026-08-13T01:00:00.000Z');

  recordNavigationEvidence(repeatedPolls, { ...wiki, captured_at: '2026-08-13T01:00:00.000Z' });
  assert.equal(repeatedPolls.length, 2);
  assert.equal(repeatedPolls[1].sequence, 2);
  assert.equal(repeatedPolls[1].captured_at, '2026-08-13T01:00:00.001Z');
  assert.equal(multiSourceDeliveryPass({ finalUrl: wiki.url, deliverable, navigationEvidence: repeatedPolls }), true);
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
