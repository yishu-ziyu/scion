/**
 * Generic public-site eval task (plan 019/020 Wave 3).
 *
 * Opens a real target URL, sends one frozen goal through the extension side
 * panel, waits for a verified receipt, and checks a machine-verifiable condition.
 *
 * Usage:
 *   EVAL_TASK_ID=013-B04 TARGET_URL=about:blank GOAL="打开 https://www.wikipedia.org" \
 *     VERIFY=url_starts_with EXPECTED=https://www.wikipedia.org node chrome-extension/scripts/eval-public-task.mjs
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, launch } from 'puppeteer-core';
import {
  attestRuntimeExtension,
  resolveChromeForEval,
  resolveEvalIdentity,
  resolveEvalProxyArgs,
  seedEvalLlm,
} from './lib/eval-provider.mjs';
import { buildScopedTraceEvidence } from './lib/eval-trace-evidence.mjs';
import {
  deliverableContainsAll,
  FINAL_DELIVERABLE_SELECTOR,
  multiSourceDeliveryPass,
  normalizeEvidenceText,
  productDeliverablePass,
  tabProvenanceWrongTab,
  taskUrlContractPass,
  wrongTabFromIds,
} from './lib/eval-verification.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-public-task-${process.pid}`);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 120_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const taskId = process.env.EVAL_TASK_ID || '013-public';
const targetUrl = process.env.TARGET_URL || 'https://example.com';
const goal = process.env.GOAL || '';
const verify = process.env.VERIFY || 'completed';
const expected = process.env.EXPECTED || '';
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
/** When set, dump chrome.storage eval-traces-v1 JSON after the run (Trace Gate evidence). */
const traceDumpDir = process.env.TRACE_DUMP_DIR || '';

let browser;
let ownsBrowser = false;
let fixtureServer;
/** Panel page kept for optional post-run storage dump. */
let panelPage;
let targetPage;
let boundTab;
let latestResult;
let rowEmitted = false;
let runStartedAt = 0;
const navigationEvidence = [];
const tabProvenance = [];
let captureQueue = Promise.resolve();
let browserVersion = '';
let priorTaskIds = [];
let runtimeTaskId = '';
let terminalEvidence = null;

function resolveChromePath() {
  return resolveChromeForEval();
}

/** Inject eval LLM (default MiniMax; optional PROVIDER=custom_openai for Grok etc.). */
async function seedMiniMax(panel) {
  const config = await seedEvalLlm(panel);
  assert.equal(config.kind, provider, 'seeded provider differs from evaluator identity');
  assert.equal(config.model, model, 'seeded model differs from evaluator identity');
}

async function waitForTestId(page, testId) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
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

function writeEvidence(partial) {
  if (!evidenceDir) return '';
  mkdirSync(evidenceDir, { recursive: true });
  const safeTaskId = taskId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outPath = path.join(evidenceDir, `${safeTaskId}-attempt-${attempt}-verification.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        task_id: taskId,
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
        verifier: verify,
        expected,
        ...partial,
      },
      null,
      2,
    ) + '\n',
  );
  return path.relative(path.resolve(__dirname, '../..'), outPath).replaceAll(path.sep, '/');
}

function emitRow(partial) {
  rowEmitted = true;
  console.log(
    `matrix_row ${JSON.stringify({
      task_id: taskId,
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

async function capturePageEvidence(target) {
  try {
    const observed = await target.evaluate(() => {
      const firstParagraph =
        document.querySelector('#mw-content-text .mw-parser-output > p:not(.mw-empty-elt)')?.textContent ||
        document.querySelector('main p')?.textContent ||
        '';
      return {
        url: location.href,
        title: document.title,
        first_paragraph: firstParagraph,
      };
    });
    const normalized = {
      url: observed.url,
      title: normalizeEvidenceText(observed.title),
      first_paragraph: normalizeEvidenceText(observed.first_paragraph),
      captured_at: new Date().toISOString(),
    };
    const existing = navigationEvidence.find(item => item.url === normalized.url);
    if (existing) Object.assign(existing, { ...normalized, captured_at: existing.captured_at });
    else navigationEvidence.push(normalized);
  } catch {
    // Navigation can destroy an execution context. A later poll retries capture.
  }
}

async function captureTabProvenance(panel, label) {
  try {
    const observed = await panel.evaluate(async priorIds => {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const stored = await chrome.storage.local.get(['task-runtime-v1']);
      const prior = new Set(priorIds);
      const tasks = Object.values(stored['task-runtime-v1'] || {}).filter(task => task && !prior.has(task.id));
      const task = tasks.length === 1 ? tasks[0] : null;
      const round = task?.rounds?.at?.(-1) || task?.rounds?.[task.rounds.length - 1];
      const refIds = [
        ...(task?.targetRefs || []).map(ref => ref?.id),
        ...(round?.criteria || []).map(criterion => criterion?.targetRefId),
        ...(round?.evidence || []).map(evidence => evidence?.targetRefId),
        ...(round?.attempts || []).flatMap(action => [action?.targetRefId, action?.effect?.targetRefId]),
      ];
      const targetTabIds = refIds
        .map(value => /^tab-(\d+)$/.exec(String(value || ''))?.[1])
        .filter(Boolean)
        .map(Number);
      return {
        active_tab_id: active?.id ?? null,
        task_tab_id: task?.activeTabId ?? null,
        target_tab_ids: [...new Set(targetTabIds)],
        task_id: task?.id ?? null,
        candidate_count: tasks.length,
      };
    }, priorTaskIds);
    tabProvenance.push({
      captured_at: new Date().toISOString(),
      label,
      ...observed,
      scope_invalid: observed.candidate_count > 1,
    });
  } catch {
    tabProvenance.push({ captured_at: new Date().toISOString(), label, unavailable: true });
  }
}

function queuePageEvidence(target) {
  captureQueue = captureQueue.then(() => capturePageEvidence(target));
}

async function openPanelForTarget(extensionId, target) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await seedMiniMax(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hasGoal = await panel.evaluate(() => Boolean(document.querySelector('[data-testid="goal-input"]')));
    if (hasGoal) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 800));
  return panel;
}

async function sendGoal(panel, target) {
  await waitForTestId(panel, 'goal-send');
  await setValue(panel, 'goal-input', goal);
  const typed = await panel.$eval('[data-testid="goal-input"]', el => el.value);
  assert.equal(typed, goal, 'goal input did not accept value');
  await panel.waitForFunction(
    () => {
      const button = document.querySelector('[data-testid="goal-send"]');
      return Boolean(button && !button.disabled);
    },
    { timeout: 30_000 },
  );
  await target.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 150));
  await click(panel, 'goal-send');
  await new Promise(resolve => setTimeout(resolve, 1000));
  const afterClick = await panel.evaluate(() => ({
    status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
    body: (document.body?.innerText || '').slice(0, 200),
  }));
  console.log('[public-task] after click', JSON.stringify(afterClick));
  console.log('[public-task] goal sent', goal.slice(0, 80));
}

async function waitCompleted(panel, target) {
  const start = Date.now();
  let seenRunning = false;
  let completedSince = 0;
  while (Date.now() - start < timeout) {
    await capturePageEvidence(target);
    await captureTabProvenance(panel, 'poll');
    const snap = await panel.evaluate(deliverableSelector => {
      const deliverables = [...document.querySelectorAll(deliverableSelector)];
      const receipts = [...document.querySelectorAll('[data-testid="completion-receipt"]')];
      return {
        status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
        receipt: receipts.length === 1,
        receiptCount: receipts.length,
        deliverableCount: deliverables.length,
        answer: deliverables[0]?.textContent?.trim() || '',
        body: document.body?.innerText || '',
      };
    }, FINAL_DELIVERABLE_SELECTOR);
    if ((Date.now() - start) % 10_000 < 1200) {
      console.log(`[public-task] wait status=${snap.status} url=${target.url()}`);
    }
    if (snap.status === 'running' || snap.status === 'waiting_user') {
      seenRunning = true;
    }
    if (snap.status === 'waiting_user') {
      throw new Error(`login_wall: ${snap.body.slice(0, 200)}`);
    }
    if (seenRunning && snap.status === 'completed' && snap.receiptCount === 1 && snap.deliverableCount === 1) {
      return snap;
    }
    if (snap.status === 'completed') {
      completedSince ||= Date.now();
      if (Date.now() - completedSince > 5000) {
        throw new Error(
          `invalid_evidence_selector: completed receipt_count=${snap.receiptCount} deliverable_count=${snap.deliverableCount}`,
        );
      }
    } else {
      completedSince = 0;
    }
    if (['failed', 'cancelled'].includes(snap.status) && seenRunning) {
      if (process.env.EXPECT_FAILURE === '1') {
        return { ...snap, expectedFailure: true };
      }
      throw new Error(`${snap.status}: ${snap.body.slice(0, 300)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error(
    `timeout status=${await panel.evaluate(() => document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'))}`,
  );
}

function splitExpectedPair(value) {
  const text = String(value || '');
  const sep = text.includes('||') ? '||' : '|';
  const index = text.indexOf(sep);
  if (index < 0) return { left: text, right: '' };
  return {
    left: text.slice(0, index).trim(),
    right: text.slice(index + sep.length).trim(),
  };
}

async function pageTextContains(target, needle) {
  if (!needle) return false;
  return target.evaluate(expected => {
    const pageText = document.body?.innerText || '';
    return pageText.includes(expected);
  }, needle);
}

async function readProductsOracle(target) {
  return target.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="product-"]')].map(element => ({
      name: element.getAttribute('data-name') || '',
      price: element.getAttribute('data-price') || '',
      rating: element.getAttribute('data-rating') || '',
    })),
  );
}

async function verifyResult(target, panel) {
  const url = target.url();
  const answer = panel.answer || '';
  switch (verify) {
    case 'url_starts_with':
      return taskUrlContractPass(taskId, url);
    case 'url_contains':
      return taskUrlContractPass(taskId, url);
    case 'host_equals': {
      try {
        return new URL(url).host === expected;
      } catch {
        return false;
      }
    }
    case 'body_contains':
      return answer.includes(expected);
    case 'answer_contains':
      return answer.includes(expected);
    case 'body_contains_all':
      // Despite the legacy name, only the dedicated final deliverable is scoreable.
      return deliverableContainsAll(answer, expected);
    case 'products_extract':
      return productDeliverablePass(answer, await readProductsOracle(target));
    case 'page_text':
      // Target page DOM text (not side-panel answer). Good for multi-phase nav + extract.
      return pageTextContains(target, expected);
    case 'url_and_page_text': {
      // EXPECTED = "url_substr||page_text_substr"
      const { left: urlPart, right: textPart } = splitExpectedPair(expected);
      if (!urlPart || !textPart) return false;
      if (!taskUrlContractPass(taskId, url)) return false;
      return pageTextContains(target, textPart);
    }
    case 'url_and_body': {
      // EXPECTED = "url_substr||panel_answer_substr" — nav + deliverable both required.
      const { left: urlPart, right: answerPart } = splitExpectedPair(expected);
      if (!urlPart || !answerPart) return false;
      return taskUrlContractPass(taskId, url) && answer.includes(answerPart);
    }
    case 'multi_source_delivery': {
      await captureQueue;
      await capturePageEvidence(target);
      return multiSourceDeliveryPass({
        finalUrl: url,
        deliverable: answer,
        navigationEvidence,
      });
    }
    case 'scroll_bottom':
      return target.evaluate(() => {
        const documentElement = document.documentElement;
        return documentElement.scrollTop + window.innerHeight >= documentElement.scrollHeight - 300;
      });
    case 'media_paused':
      return target.evaluate(() => {
        const video = document.querySelector('video');
        return video ? video.paused : false;
      });
    case 'media_playing':
      return target.evaluate(() => {
        const video = document.querySelector('video');
        return video ? !video.paused : false;
      });
    case 'completed':
      return Boolean(panel.receipt);
    default:
      return false;
  }
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

try {
  assert(existsSync(path.join(extensionPath, 'manifest.json')), 'missing extension dist');
  assert(goal, 'GOAL is required');
  const chromePath = resolveChromePath();
  console.log('[public-task] extensionPath=', extensionPath);
  console.log('[public-task] chromePath=', chromePath);
  if (connectUrl) {
    browser = await connect({ browserURL: connectUrl, defaultViewport: null });
  } else {
    browser = await launch({
      executablePath: chromePath,
      headless: process.env.HEADLESS !== 'false',
      userDataDir: profilePath,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        ...resolveEvalProxyArgs(),
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--disable-features=DisableLoadExtensionCommandLineSwitch',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-default-apps',
        '--disable-background-timer-throttling',
      ],
    });
    ownsBrowser = true;
  }
  browserVersion = await browser.version().catch(() => '');
  console.log('[public-task] browser launched');

  const extensionId = await resolveExtensionId();
  console.log('[public-task] extensionId=', extensionId);
  const target = await browser.newPage();
  targetPage = target;
  target.on('domcontentloaded', () => queuePageEvidence(target));
  target.on('load', () => queuePageEvidence(target));
  let effectiveTargetUrl = targetUrl;
  if (targetUrl === 'fixture://error') {
    fixtureServer = http.createServer((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><body><h1>Server Error</h1></body></html>');
    });
    await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
    effectiveTargetUrl = `http://127.0.0.1:${fixtureServer.address().port}/error`;
  } else if (targetUrl === 'fixture://products') {
    const productsHtml = readFileSync(path.resolve(__dirname, '../test/fixtures/products.html'), 'utf8');
    fixtureServer = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end(productsHtml);
    });
    await new Promise(resolve => fixtureServer.listen(0, '127.0.0.1', resolve));
    effectiveTargetUrl = `http://127.0.0.1:${fixtureServer.address().port}/products`;
  }
  await target.goto(effectiveTargetUrl, { waitUntil: 'domcontentloaded' });
  await capturePageEvidence(target);
  console.log('[public-task] target=', target.url());
  const panel = await openPanelForTarget(extensionId, target);
  panelPage = panel;
  const runtimeExtensionAttestation = await attestRuntimeExtension(panel, extensionPath);
  boundTab = await readActiveTab(panel);
  priorTaskIds = await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get(['task-runtime-v1']);
    return Object.keys(stored['task-runtime-v1'] || {});
  });
  console.log('[public-task] panel ready');
  const startedAt = Date.now();
  runStartedAt = startedAt;
  await sendGoal(panel, target);
  await new Promise(resolve => setTimeout(resolve, 500));
  const result = await waitCompleted(panel, target);
  latestResult = result;
  const activeTab = await readActiveTab(panel);
  await captureTabProvenance(panel, 'final');
  const flattenedTabProvenance = tabProvenance.flatMap(entry => {
    const base = { ...entry, target_tab_ids: undefined };
    const targets = entry.target_tab_ids || [];
    return targets.length ? targets.map(target_tab_id => ({ ...base, target_tab_id })) : [base];
  });
  const timelineWrongTab = tabProvenanceWrongTab(flattenedTabProvenance, [boundTab?.id]);
  const finalWrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
  const wrongTab =
    timelineWrongTab === null || finalWrongTab === null ? null : timelineWrongTab === 1 || finalWrongTab === 1 ? 1 : 0;
  const runtimeTaskIds = [...new Set(tabProvenance.map(item => item.task_id).filter(Boolean))];
  runtimeTaskId = runtimeTaskIds.length === 1 ? runtimeTaskIds[0] : '';
  if (!runtimeTaskId) throw new Error(`task provenance ambiguous count=${runtimeTaskIds.length}`);
  const pageState = await target.evaluate(() => {
    const video = document.querySelector('video, audio');
    return {
      scroll: {
        top: document.documentElement.scrollTop,
        viewport: window.innerHeight,
        height: document.documentElement.scrollHeight,
      },
      media_paused: video ? video.paused : null,
    };
  });
  const sourceProducts = ['products_extract'].includes(verify) ? await readProductsOracle(target) : [];
  const baseEvidence = {
    status: result.status,
    terminal_status: result.status,
    receipt: result.receipt,
    receipt_count: result.receiptCount,
    deliverable_count: result.deliverableCount,
    final_deliverable: result.answer,
    runtime_task_id: runtimeTaskId,
    target_url: target.url(),
    bound_tab: boundTab ?? null,
    active_tab: activeTab ?? null,
    navigation_evidence: navigationEvidence,
    page_state: pageState,
    source_products: sourceProducts,
    tab_provenance: tabProvenance,
    attach_attestation: {
      mode: attachMode,
      connect_url_present: Boolean(connectUrl),
      owns_browser: ownsBrowser,
      ...runtimeExtensionAttestation,
    },
  };
  terminalEvidence = baseEvidence;
  if (wrongTab === null) {
    const evidencePath = writeEvidence({ ...baseEvidence, outcome: 'invalid_run', wrong_tab: null });
    emitRow({
      outcome: 'invalid_run',
      wrong_tab: '',
      latency_ms: Date.now() - startedAt,
      failure_class: 'tab_provenance',
      evidence_path: evidencePath,
      notes: 'could not establish bound/active tab ids',
    });
    throw new Error('tab provenance unavailable');
  }
  if (process.env.EXPECT_FAILURE === '1') {
    if (!result.expectedFailure || !['failed', 'cancelled'].includes(result.status)) {
      throw new Error(`expected negative failure but status=${result.status}`);
    }
    const evidencePath = writeEvidence({
      ...baseEvidence,
      outcome: wrongTab ? 'fail' : 'verified_pass',
      wrong_tab: wrongTab,
    });
    emitRow({
      outcome: wrongTab ? 'fail' : 'verified_pass',
      wrong_tab: wrongTab,
      latency_ms: Date.now() - startedAt,
      failure_class: wrongTab ? 'wrong_tab' : 'expected_failure',
      evidence_path: evidencePath,
      notes: wrongTab ? 'negative task ended on an unrelated active tab' : 'negative task failed honestly',
    });
    if (wrongTab) throw new Error('wrong active tab after expected failure');
    console.log(`[public-task] PASS negative ${taskId}`);
  } else {
    const ok = await verifyResult(target, { ...result, body: result.body });
    if (!ok) {
      // Agent claimed completed but evidence failed → false_complete for matrix.
      const latencyMs = Date.now() - startedAt;
      const evidencePath = writeEvidence({ ...baseEvidence, outcome: 'fail', wrong_tab: wrongTab, false_complete: 1 });
      emitRow({
        outcome: 'fail',
        false_complete: 1,
        wrong_tab: wrongTab,
        latency_ms: latencyMs,
        failure_class: 'verify_fail',
        evidence_path: evidencePath,
        notes: `false_complete verify=${verify} expected=${expected} url=${target.url()}`,
      });
      throw new Error(`verification failed verify=${verify} expected=${expected} url=${target.url()}`);
    }
    const evidencePath = writeEvidence({
      ...baseEvidence,
      outcome: wrongTab ? 'fail' : 'verified_pass',
      wrong_tab: wrongTab,
    });
    emitRow({
      outcome: wrongTab ? 'fail' : 'verified_pass',
      false_complete: 0,
      wrong_tab: wrongTab,
      latency_ms: Date.now() - startedAt,
      failure_class: wrongTab ? 'wrong_tab' : '',
      evidence_path: evidencePath,
      notes: `url=${target.url()}`,
    });
    if (wrongTab) throw new Error(`wrong active tab id=${activeTab?.id} expected=${boundTab?.id}`);
    console.log(`[public-task] PASS ${taskId} url=${target.url()}`);
  }
} catch (error) {
  console.error(`[public-task] FAIL ${taskId}`, error);
  if (!rowEmitted) {
    const failureClass = /invalid_evidence_selector/i.test(String(error?.message || error))
      ? 'evidence_protocol'
      : /login_wall/i.test(String(error?.message || error))
        ? 'login_wall'
        : 'other';
    const activeTab = panelPage ? await readActiveTab(panelPage) : null;
    const wrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
    const evidencePath = writeEvidence({
      outcome: failureClass === 'evidence_protocol' ? 'invalid_run' : 'fail',
      status: latestResult?.status ?? null,
      final_deliverable: latestResult?.answer ?? '',
      target_url: targetPage?.url?.() ?? '',
      bound_tab: boundTab ?? null,
      active_tab: activeTab,
      wrong_tab: wrongTab,
      error: String(error?.message || error)
        .replace(/\s+/g, ' ')
        .slice(0, 240),
    });
    emitRow({
      outcome: 'fail',
      wrong_tab: wrongTab ?? 0,
      latency_ms: runStartedAt ? Date.now() - runStartedAt : 0,
      failure_class: failureClass,
      evidence_path: evidencePath,
      notes: String(error?.message || error)
        .replace(/\s+/g, ' ')
        .slice(0, 240),
    });
  }
  process.exitCode = 1;
} finally {
  // Trace Gate: dump real eval-traces-v1 before tearing down the browser.
  if (traceDumpDir && panelPage) {
    try {
      const traces = await panelPage.evaluate(async () => {
        const key = 'eval-traces-v1';
        const stored = await chrome.storage.local.get([key]);
        return stored?.[key] ?? {};
      });
      mkdirSync(traceDumpDir, { recursive: true });
      const traceEvidence = buildScopedTraceEvidence({
        rawTraces: traces,
        evalTaskId: taskId,
        attempt,
        campaignStamp,
        armHash,
        runId,
        runtimeTaskId,
        boundTabId: boundTab?.id,
        terminalStatus: terminalEvidence?.terminal_status,
        receiptCount: terminalEvidence?.receipt_count,
        deliverableCount: terminalEvidence?.deliverable_count,
        tabSamples: tabProvenance,
      });
      const outPath = path.join(traceDumpDir, `${taskId}-attempt-${attempt}-trace.json`);
      writeFileSync(outPath, JSON.stringify(traceEvidence, null, 2));
      // Compact summary for logs (names only — no page body)
      const names = [];
      for (const t of Object.values(traces || {})) {
        for (const s of t?.spans || []) names.push(s.name);
      }
      console.log(`[public-task] TRACE_DUMP path=${outPath} spans=${names.join(',')}`);
    } catch (dumpErr) {
      console.warn('[public-task] TRACE_DUMP failed', String(dumpErr?.message || dumpErr));
    }
  }
  if (ownsBrowser) {
    await browser?.close().catch(() => {});
    await rm(profilePath, { recursive: true, force: true }).catch(() => {});
  } else {
    browser?.disconnect();
  }
  if (fixtureServer) {
    await new Promise(resolve => fixtureServer.close(resolve));
  }
}
