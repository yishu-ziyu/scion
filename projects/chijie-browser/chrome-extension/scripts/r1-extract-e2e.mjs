/**
 * R1 extract e2e — list page → CSV deliverable.
 *
 * Protocol:
 * - Load extension dist into Chrome for Testing (or CDP_URL attach)
 * - Open local /products fixture
 * - Goal: Extract products to a CSV table with name, price, rating
 * - Pass: task completed + body/receipt/deliverable contains header
 *   `name,price,rating` and ≥5 data rows
 *
 * Does not run form/media legs (those stay in action-agent-e2e.mjs).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, launch } from 'puppeteer-core';
import {
  attestRuntimeExtension,
  hasEvalApiKey,
  resolveChromeForEval,
  resolveEvalIdentity,
  seedEvalLlm,
} from './lib/eval-provider.mjs';
import { buildScopedTraceEvidence } from './lib/eval-trace-evidence.mjs';
import {
  FINAL_DELIVERABLE_SELECTOR,
  productDeliverablePass,
  tabProvenanceWrongTab,
  wrongTabFromIds,
} from './lib/eval-verification.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-r1-e2e-${process.pid}`);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 120_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const forceReset = process.env.FORCE_RESET === '1';
const isConnectMode = Boolean(connectUrl);
const reportDir = process.env.R1_REPORT_DIR || path.resolve(__dirname, '../../../../reports/nanobrowser/claw-30/R1');
const evalTaskId = process.env.EVAL_TASK_ID || '018-R1';
const promptVersion = process.env.PROMPT_VERSION || 'chijie-control-v0.3.0';
const policyTag = process.env.POLICY_TAG || 'baseline';
const evalIdentity = resolveEvalIdentity();
const model = evalIdentity.model;
const provider = evalIdentity.provider;
const providerBaseUrl = evalIdentity.base_url;
const featureFlagsHash = process.env.EVAL_FEATURE_FLAGS_HASH || '';
const attempt = Number(process.env.EVAL_ATTEMPT || 1);
const campaignStamp = process.env.EVAL_CAMPAIGN_STAMP || '';
const armHash = process.env.EVAL_ARM_HASH || '';
const runId = process.env.EVAL_RUN_ID || '';
const attachMode = connectUrl ? 'connected_cdp' : 'launched_chrome_for_testing';
const evidenceDir = process.env.EVIDENCE_DIR || '';
const traceDumpDir = process.env.TRACE_DUMP_DIR || '';

const GOAL = 'Extract products to a CSV table with name, price, rating';

let browser;
let ownsBrowser = false;
let panelPage;
let boundTab;
let rowEmitted = false;
let runStartedAt = 0;
let browserVersion = '';
let runtimeTaskId = '';
let terminalEvidence = null;
const tabSamples = [];

function resolveChromePath() {
  return resolveChromeForEval();
}

const chromePath = resolveChromePath();

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname !== '/products' && url.pathname !== '/') {
    response.writeHead(404);
    return response.end('not found');
  }
  const html = await readFile(path.resolve(__dirname, '../test/fixtures/products.html'));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function waitForTestId(page, testId) {
  return page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

async function setValue(page, testId, value) {
  await waitForTestId(page, testId);
  await page.evaluate(
    (tid, v) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) throw new Error(`missing ${tid}`);
      const proto =
        el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, v) : (el.value = v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    testId,
    value,
  );
}

async function click(page, testId) {
  await page.evaluate(tid => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) throw new Error(`missing ${tid}`);
    el.click();
  }, testId);
}

async function readActiveTab(panel) {
  try {
    return await panel.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tab ? { id: tab.id, url: tab.url || '', title: tab.title || '' } : null;
    });
  } catch {
    return null;
  }
}

function relativeEvidencePath(filePath) {
  return path.relative(path.resolve(__dirname, '../..'), filePath).replaceAll(path.sep, '/');
}

function writeRunnerEvidence(partial) {
  if (!evidenceDir) return '';
  mkdirSync(evidenceDir, { recursive: true });
  const safeTaskId = evalTaskId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outPath = path.join(evidenceDir, `${safeTaskId}-attempt-${attempt}-verification.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        task_id: evalTaskId,
        attempt,
        campaign_stamp: campaignStamp,
        arm_hash: armHash,
        run_id: runId,
        model,
        provider,
        provider_base_url: providerBaseUrl,
        feature_flags_hash: featureFlagsHash,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        attach_mode: attachMode,
        verifier: 'products_extract',
        ...partial,
      },
      null,
      2,
    ) + '\n',
  );
  return relativeEvidencePath(outPath);
}

function emitRow(partial) {
  rowEmitted = true;
  console.log(
    `matrix_row ${JSON.stringify({
      task_id: evalTaskId,
      attempt,
      campaign_stamp: campaignStamp,
      arm_hash: armHash,
      run_id: runId,
      model,
      provider,
      provider_base_url: providerBaseUrl,
      feature_flags_hash: featureFlagsHash,
      attach_mode: attachMode,
      prompt_version: promptVersion,
      policy_tag: policyTag,
      outcome: 'fail',
      false_complete: 0,
      wrong_tab: '',
      unapproved_commit: 0,
      latency_ms: runStartedAt ? Date.now() - runStartedAt : 0,
      failure_class: '',
      evidence_path: '',
      browser_version: browserVersion,
      ...partial,
    })}`,
  );
}

async function dumpPanel(panel, label) {
  const info = await panel.evaluate(() => ({
    status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
    testids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
    body: (document.body?.innerText || '').slice(0, 800),
  }));
  console.log(`[r1-e2e] ${label}`, JSON.stringify(info));
  return info;
}

/** Inject eval LLM (default MiniMax; optional PROVIDER=custom_openai for Grok etc.). */
async function seedMiniMax(panel) {
  const config = await seedEvalLlm(panel);
  assert.equal(config.kind, provider, 'seeded provider differs from evaluator identity');
  assert.equal(config.model, model, 'seeded model differs from evaluator identity');
}

async function openPanelForTarget(extensionId, target, { seed = false } = {}) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  if (seed) {
    await seedMiniMax(panel);
    await panel.reload({ waitUntil: 'domcontentloaded' });
  }
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await panel.evaluate(() => ({
      hasGoal: Boolean(document.querySelector('[data-testid="goal-input"]')),
      body: (document.body?.innerText || '').slice(0, 200),
    }));
    if (state.hasGoal) break;
    if (state.body.includes('Settings') || state.body.includes('设置') || state.body.includes('API')) {
      await seedMiniMax(panel);
      await panel.reload({ waitUntil: 'domcontentloaded' });
    }
    await new Promise(r => setTimeout(r, 500));
  }
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(r => setTimeout(r, 800));
  return panel;
}

async function ensureGoalSend(panel) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const state = await panel.evaluate(() => {
      const status = document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status');
      const hasSend = Boolean(document.querySelector('[data-testid="goal-send"]'));
      const stop = [...document.querySelectorAll('button')].find(button => /停止|Stop/i.test(button.textContent || ''));
      return { status, hasSend, hasStop: Boolean(stop) };
    });
    if (state.hasSend) return;
    if (state.hasStop && (state.status === 'running' || !state.status)) {
      await panel.evaluate(() => {
        const stop = [...document.querySelectorAll('button')].find(button =>
          /停止|Stop/i.test(button.textContent || ''),
        );
        stop?.click();
      });
    }
    await new Promise(r => setTimeout(r, 400));
  }
  await dumpPanel(panel, 'goal-send-missing');
  throw new Error('timeout waiting for goal-send');
}

async function sendGoal(panel, target, instruction) {
  await waitForTestId(panel, 'goal-input');
  await ensureGoalSend(panel);
  await setValue(panel, 'goal-input', instruction);
  const typed = await panel.$eval('[data-testid="goal-input"]', el => el.value);
  assert.equal(typed, instruction, 'goal input did not accept value');
  await target.bringToFront();
  await new Promise(r => setTimeout(r, 150));
  await ensureGoalSend(panel);
  await click(panel, 'goal-send');
}

async function resetExtensionState(panel) {
  if (isConnectMode && !forceReset) {
    console.log('[r1-e2e] connect mode: skip wipe (set FORCE_RESET=1 to override)');
    return;
  }
  await panel.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const remove = Object.keys(all).filter(
      key =>
        key === 'task-runtime-v1' ||
        key === 'task-skill-save-v1' ||
        key === 'favorites' ||
        key.startsWith('chat_messages_') ||
        key.startsWith('chat_sessions'),
    );
    if (remove.length) await chrome.storage.local.remove(remove);
  });
}

/** Accept CSV header + ≥5 product data rows from one task-scoped deliverable only. */
function scoreCsvText(text) {
  if (!text) return { ok: false, dataRows: 0, hasHeader: false };
  const normalized = text.replace(/\r\n/g, '\n');
  const hasHeader = /name\s*,\s*price\s*,\s*rating/i.test(normalized);
  // Data rows: lines with comma + a price-like token ($ or digit)
  const dataRows = normalized
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !/^name\s*,\s*price\s*,\s*rating$/i.test(l) && /,/.test(l) && /\$|\d/.test(l));
  return { ok: hasHeader && dataRows.length >= 5, dataRows: dataRows.length, hasHeader };
}

async function readTaskIds(panel) {
  return panel.evaluate(async () => {
    const all = await chrome.storage.local.get(['task-runtime-v1']);
    return Object.keys(all['task-runtime-v1'] || {});
  });
}

async function readScopedTask(panel, priorTaskIds, expectedTabId) {
  return panel.evaluate(
    async ({ priorIds, tabId }) => {
      const all = await chrome.storage.local.get(['task-runtime-v1']);
      const prior = new Set(priorIds);
      const candidates = Object.values(all['task-runtime-v1'] || {}).filter(
        task => task && !prior.has(task.id) && task.activeTabId === tabId,
      );
      return candidates.map(task => {
        const rounds = task.rounds || [];
        const last = rounds[rounds.length - 1];
        const targetTabIds = [
          ...(task.targetRefs || []).map(ref => ref?.id),
          ...(last?.criteria || []).map(item => item?.targetRefId),
          ...(last?.evidence || []).map(item => item?.targetRefId),
          ...(last?.attempts || []).flatMap(item => [item?.targetRefId, item?.effect?.targetRefId]),
        ]
          .map(value => /^tab-(\d+)$/.exec(String(value || ''))?.[1])
          .filter(Boolean)
          .map(Number);
        return {
          taskId: task.id,
          status: task.status,
          activeTabId: task.activeTabId,
          receiptId: last?.receipt?.id || null,
          targetTabIds: [...new Set(targetTabIds)],
          updatedAt: task.updatedAt || last?.receipt?.verifiedAt || 0,
        };
      });
    },
    { priorIds: priorTaskIds, tabId: expectedTabId },
  );
}

async function waitExtractCompleted(panel, { priorTaskIds, expectedTabId, products }) {
  const start = Date.now();
  let seenRunning = false;
  let completedSince = 0;
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(deliverableSelector => {
      const status = document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status');
      const body = document.body?.innerText || '';
      const deliverables = [...document.querySelectorAll(deliverableSelector)];
      const receipts = [...document.querySelectorAll('[data-testid="completion-receipt"]')];
      return {
        status,
        body,
        deliverable: deliverables[0]?.textContent?.trim() || '',
        deliverableCount: deliverables.length,
        receiptCount: receipts.length,
      };
    }, FINAL_DELIVERABLE_SELECTOR);
    if (snap.status === 'running' || snap.status === 'waiting_user') {
      seenRunning = true;
    }

    const scopedTasks = await readScopedTask(panel, priorTaskIds, expectedTabId);
    const scopedTask = scopedTasks[0] || null;
    if (scopedTask) {
      const activeTab = await readActiveTab(panel);
      tabSamples.push({
        captured_at: new Date().toISOString(),
        task_id: scopedTask.taskId,
        active_tab_id: activeTab?.id ?? null,
        task_tab_id: scopedTask.activeTabId,
        target_tab_ids: scopedTask.targetTabIds,
      });
    }
    const scored = scoreCsvText(snap.deliverable);
    const oraclePass = productDeliverablePass(snap.deliverable, products);

    if ((Date.now() - start) % 8000 < 1600) {
      console.log(
        `[r1-e2e] poll status=${snap.status} header=${scored.hasHeader} rows=${scored.dataRows} scoped=${scopedTasks.length} seenRunning=${seenRunning}`,
      );
    }

    if (['failed', 'cancelled'].includes(snap.status) && seenRunning) {
      await dumpPanel(panel, `task-${snap.status}`);
      throw new Error(`task ${snap.status}: ${snap.body.slice(0, 300)}`);
    }

    if (
      snap.status === 'completed' &&
      seenRunning &&
      snap.deliverableCount === 1 &&
      snap.receiptCount === 1 &&
      scopedTasks.length === 1 &&
      scopedTask.status === 'completed' &&
      scopedTask.receiptId &&
      oraclePass
    ) {
      return {
        status: snap.status,
        receipt: true,
        scored,
        deliverable: snap.deliverable,
        receiptCount: snap.receiptCount,
        deliverableCount: snap.deliverableCount,
        storage: scopedTask,
      };
    }

    if (snap.status === 'completed' && seenRunning) {
      completedSince ||= Date.now();
      if (Date.now() - completedSince > 5000) {
        if (snap.deliverableCount !== 1 || snap.receiptCount !== 1 || scopedTasks.length !== 1) {
          throw new Error(
            `eval_invalid: task-scoped evidence count deliverable=${snap.deliverableCount} receipt=${snap.receiptCount} tasks=${scopedTasks.length}`,
          );
        }
        throw new Error(
          `completed but CSV missing (header=${scored.hasHeader} rows=${scored.dataRows} oracle=${oraclePass})`,
        );
      }
    } else {
      completedSince = 0;
    }

    await new Promise(r => setTimeout(r, 1200));
  }
  await dumpPanel(panel, 'extract-timeout');
  throw new Error('timeout waiting for completed extract with CSV');
}

async function resolveExtensionId() {
  if (process.env.EXTENSION_ID) return process.env.EXTENSION_ID;
  const worker = await browser.waitForTarget(
    target =>
      target.type() === 'service_worker' &&
      target.url().startsWith('chrome-extension://') &&
      target.url().includes('background'),
    { timeout: 30_000 },
  );
  return new URL(worker.url()).host;
}

function writeReport(payload) {
  mkdirSync(reportDir, { recursive: true });
  const safeTaskId = evalTaskId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const logPath = path.join(reportDir, `${safeTaskId}-attempt-${attempt}-e2e-r1-extract.json`);
  writeFileSync(logPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('[r1-e2e] report=', logPath);
  return logPath;
}

try {
  assert(existsSync(path.join(extensionPath, 'manifest.json')), `missing extension dist at ${extensionPath}`);
  console.log('[r1-e2e] extensionPath=', extensionPath);
  console.log('[r1-e2e] origin=', origin);
  console.log('[r1-e2e] hasEvalApiKey=', hasEvalApiKey());

  if (connectUrl) {
    console.log('[r1-e2e] connect mode', connectUrl);
    browser = await connect({ browserURL: connectUrl, defaultViewport: null });
    ownsBrowser = false;
  } else {
    console.log('[r1-e2e] chromePath=', chromePath);
    browser = await launch({
      executablePath: chromePath,
      headless: process.env.HEADLESS !== 'false',
      userDataDir: profilePath,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-background-timer-throttling',
      ],
    });
    ownsBrowser = true;
  }
  browserVersion = await browser.version().catch(() => '');

  console.log('[r1-e2e] waiting service worker...');
  let extensionId;
  try {
    extensionId = await resolveExtensionId();
  } catch (error) {
    const targets = browser.targets().map(t => `${t.type()} ${t.url()}`);
    console.error('[r1-e2e] targets after SW wait:', targets);
    throw error;
  }
  console.log('[r1-e2e] extensionId=', extensionId);

  const target = await browser.newPage();
  await target.goto(`${origin}/products`, { waitUntil: 'domcontentloaded' });
  // Sanity: fixture has ≥5 products in DOM.
  const productCount = await target.$$eval('[data-testid^="product-"]', els => els.length);
  assert.ok(productCount >= 5, `fixture must list ≥5 products, got ${productCount}`);
  const products = await target.$$eval('[data-testid^="product-"]', elements =>
    elements.map(element => ({
      name: element.getAttribute('data-name') || '',
      price: element.getAttribute('data-price') || '',
      rating: element.getAttribute('data-rating') || '',
    })),
  );

  const panel = await openPanelForTarget(extensionId, target, { seed: true });
  panelPage = panel;
  const runtimeExtensionAttestation = await attestRuntimeExtension(panel, extensionPath);
  await resetExtensionState(panel);
  await seedMiniMax(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(r => setTimeout(r, 500));

  boundTab = await readActiveTab(panel);
  if (!Number.isInteger(boundTab?.id)) throw new Error('tab provenance unavailable');
  const priorTaskIds = await readTaskIds(panel);
  runStartedAt = Date.now();
  await sendGoal(panel, target, GOAL);
  await dumpPanel(panel, 'after-send');

  const result = await waitExtractCompleted(panel, { priorTaskIds, expectedTabId: boundTab.id, products });
  runtimeTaskId = result.storage?.taskId || '';
  if (!runtimeTaskId) throw new Error('task provenance unavailable');
  const activeTab = await readActiveTab(panel);
  const taskTabEntries = (result.storage?.targetTabIds || []).map(target_tab_id => ({
    task_tab_id: result.storage.activeTabId,
    target_tab_id,
  }));
  if (taskTabEntries.length === 0) taskTabEntries.push({ task_tab_id: result.storage?.activeTabId });
  const taskWrongTab = tabProvenanceWrongTab(taskTabEntries, [boundTab?.id]);
  const finalWrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
  const wrongTab = taskWrongTab === 1 || finalWrongTab === 1 ? 1 : (taskWrongTab ?? finalWrongTab);
  if (wrongTab === null) throw new Error('tab provenance unavailable');
  console.log(
    `[r1-e2e] PASS status=${result.status} header=${result.scored.hasHeader} dataRows=${result.scored.dataRows}`,
  );
  const reportPath = writeReport({
    status: wrongTab ? 'fail' : 'pass',
    attempt,
    attachMode,
    goal: GOAL,
    origin,
    productCount,
    scored: result.scored,
    deliverableSlice: (result.deliverable || '').slice(0, 800),
    storageStatus: result.storage?.status || null,
    receipt: result.receipt,
    taskId: result.storage?.taskId || null,
    tabProvenance: taskTabEntries,
    boundTab,
    activeTab,
    wrongTab,
    at: new Date().toISOString(),
  });
  const runnerEvidencePath = writeRunnerEvidence({
    outcome: wrongTab ? 'fail' : 'verified_pass',
    status: result.status,
    terminal_status: result.status,
    rows: result.scored.dataRows,
    receipt: result.receipt,
    receipt_count: result.receiptCount,
    deliverable_count: result.deliverableCount,
    final_deliverable: result.deliverable,
    source_products: products,
    runtime_task_id: runtimeTaskId,
    tab_provenance: tabSamples,
    bound_tab: boundTab,
    active_tab: activeTab,
    attach_attestation: {
      mode: attachMode,
      connect_url_present: Boolean(connectUrl),
      owns_browser: ownsBrowser,
      ...runtimeExtensionAttestation,
    },
    wrong_tab: wrongTab,
    report_path: relativeEvidencePath(reportPath),
  });
  terminalEvidence = {
    terminal_status: result.status,
    receipt_count: result.receiptCount,
    deliverable_count: result.deliverableCount,
  };
  emitRow({
    outcome: wrongTab ? 'fail' : 'verified_pass',
    wrong_tab: wrongTab,
    latency_ms: Date.now() - runStartedAt,
    failure_class: wrongTab ? 'wrong_tab' : '',
    evidence_path: [runnerEvidencePath, relativeEvidencePath(reportPath)].filter(Boolean).join(';'),
    notes: `rows=${result.scored.dataRows}`,
  });
  if (wrongTab) throw new Error(`wrong active tab id=${activeTab.id} expected=${boundTab.id}`);

  console.log(`r1-extract-e2e PASS report=${reportPath}`);
} catch (error) {
  console.error('[r1-e2e] FAIL', error);
  const activeTab = panelPage ? await readActiveTab(panelPage) : null;
  const wrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
  const errorText = String(error?.stack || error).slice(0, 200);
  const falseComplete = /completed but CSV missing/i.test(errorText) ? 1 : 0;
  const failureClass = /eval_invalid:/i.test(errorText)
    ? 'evidence_protocol'
    : /tab provenance/i.test(errorText)
      ? 'tab_provenance'
      : /wrong active tab/i.test(errorText)
        ? 'wrong_tab'
        : falseComplete
          ? 'verify_fail'
          : 'other';
  let reportPath = '';
  try {
    reportPath = writeReport({
      status: 'fail',
      attempt,
      attachMode,
      goal: GOAL,
      error: String(error?.stack || error),
      boundTab: boundTab ?? null,
      activeTab,
      wrongTab,
      falseComplete,
      at: new Date().toISOString(),
    });
  } catch {
    /* ignore report write failure */
  }
  if (!rowEmitted) {
    const runnerEvidencePath = writeRunnerEvidence({
      outcome: ['tab_provenance', 'evidence_protocol'].includes(failureClass) ? 'invalid_run' : 'fail',
      bound_tab: boundTab ?? null,
      active_tab: activeTab,
      wrong_tab: wrongTab,
      false_complete: falseComplete,
      report_path: reportPath ? relativeEvidencePath(reportPath) : '',
      error: errorText,
    });
    emitRow({
      outcome: ['tab_provenance', 'evidence_protocol'].includes(failureClass) ? 'invalid_run' : 'fail',
      false_complete: falseComplete,
      wrong_tab: wrongTab ?? '',
      failure_class: failureClass,
      evidence_path: [runnerEvidencePath, reportPath ? relativeEvidencePath(reportPath) : ''].filter(Boolean).join(';'),
      notes: errorText,
    });
  }
  process.exitCode = 1;
} finally {
  if (traceDumpDir && panelPage) {
    try {
      const traces = await panelPage.evaluate(async () => {
        const stored = await chrome.storage.local.get(['eval-traces-v1']);
        return stored['eval-traces-v1'] || {};
      });
      const traceEvidence = buildScopedTraceEvidence({
        rawTraces: traces,
        evalTaskId,
        attempt,
        campaignStamp,
        armHash,
        runId,
        runtimeTaskId,
        boundTabId: boundTab?.id,
        terminalStatus: terminalEvidence?.terminal_status,
        receiptCount: terminalEvidence?.receipt_count,
        deliverableCount: terminalEvidence?.deliverable_count,
        tabSamples,
      });
      mkdirSync(traceDumpDir, { recursive: true });
      writeFileSync(
        path.join(traceDumpDir, `${evalTaskId}-attempt-${attempt}-trace.json`),
        JSON.stringify(traceEvidence, null, 2),
      );
    } catch (error) {
      console.warn('[r1-e2e] TRACE_DUMP failed', String(error?.message || error));
    }
  }
  if (ownsBrowser) {
    await browser?.close().catch(() => {});
    await rm(profilePath, { recursive: true, force: true });
  } else {
    browser?.disconnect();
  }
  await new Promise(resolve => server.close(resolve));
}
