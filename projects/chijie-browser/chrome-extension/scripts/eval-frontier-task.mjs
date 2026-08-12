/**
 * Frontier Eval v1 runner — outcome-only scoring (no Kernel/Skill introspection).
 *
 * Serves multi-page frontier fixtures, optional interrupt / wrong-tab stress,
 * and verifies user-visible success only.
 *
 * Env:
 *   EVAL_TASK_ID, GOAL, VERIFY, EXPECTED
 *   TARGET_URL=fixture://frontier/hub.html | absolute URL
 *   EXTENSION_PATH  override dist (baseline vs current)
 *   INTERRUPT_AFTER_MS  reload sidepanel mid-run (F3)
 *   WRONG_TAB_AFTER_MS  open distractor tab mid-run (F4)
 *   E2E_TIMEOUT_MS, TRACE_DUMP_DIR, POLICY_TAG, PROMPT_VERSION, MODEL
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
  expectedParts,
  FINAL_DELIVERABLE_SELECTOR,
  tabProvenanceWrongTab,
  wrongTabFromIds,
} from './lib/eval-verification.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultExtensionPath = path.resolve(__dirname, '../../dist');
const extensionPath = process.env.EXTENSION_PATH ? path.resolve(process.env.EXTENSION_PATH) : defaultExtensionPath;
const profilePath = path.join(os.tmpdir(), `scion-frontier-${process.pid}`);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 240_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const taskId = process.env.EVAL_TASK_ID || 'F-frontier';
const targetUrl = process.env.TARGET_URL || 'fixture://frontier/hub.html';
const goal = process.env.GOAL || '';
const verify = process.env.VERIFY || 'body_contains_all';
const expected = process.env.EXPECTED || '';
const promptVersion = process.env.PROMPT_VERSION || 'chijie-control-v0.3.0';
const policyTag = process.env.POLICY_TAG || 'frontier_v1';
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
const interruptAfterMs = Number(process.env.INTERRUPT_AFTER_MS || 0);
const wrongTabAfterMs = Number(process.env.WRONG_TAB_AFTER_MS || 0);
const forbidBody = process.env.FORBID_BODY || '';
const traceDumpDir = process.env.TRACE_DUMP_DIR || '';

const frontierRoot = path.resolve(__dirname, '../test/fixtures/frontier');

let browser;
let ownsBrowser = false;
let fixtureServer;
let panelPage;
let fixtureOrigin = '';
let distractorOpened = false;
let interruptFired = false;
let targetPage;
let boundTab;
let latestResult;
let rowEmitted = false;
let runStartedAt = 0;
let browserVersion = '';
const tabProvenance = [];
let priorTaskIds = [];
let runtimeTaskId = '';
let terminalEvidence = null;

function resolveChromePath() {
  return resolveChromeForEval();
}

function contentType(filePath) {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'text/plain; charset=utf-8';
}

async function startFrontierServer() {
  const server = http.createServer((req, res) => {
    try {
      let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
      if (urlPath === '/') urlPath = '/hub.html';
      const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
      const filePath = path.join(frontierRoot, safe);
      if (!filePath.startsWith(frontierRoot) || !existsSync(filePath)) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
        return;
      }
      res.writeHead(200, { 'content-type': contentType(filePath) });
      res.end(readFileSync(filePath));
    } catch (error) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end(String(error));
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  fixtureOrigin = `http://127.0.0.1:${port}`;
  return server;
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

async function openPanelForTarget(extensionId, target) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  const config = await seedEvalLlm(panel);
  assert.equal(config.kind, provider, 'seeded provider differs from evaluator identity');
  assert.equal(config.model, model, 'seeded model differs from evaluator identity');
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
  console.log('[frontier] goal sent', goal.slice(0, 100));
}

async function maybeStress(panel, target, startedAt) {
  const now = Date.now() - startedAt;
  if (wrongTabAfterMs > 0 && !distractorOpened && now >= wrongTabAfterMs) {
    distractorOpened = true;
    const decoy = await browser.newPage();
    await decoy.goto('https://example.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
    await decoy.bringToFront();
    console.log('[frontier] WRONG_TAB stress: opened example.com as active tab');
    await new Promise(resolve => setTimeout(resolve, 800));
    // leave decoy active — agent must rebind or not false-complete on wrong page
  }
  if (interruptAfterMs > 0 && !interruptFired && now >= interruptAfterMs) {
    interruptFired = true;
    // Transient page disruption (keep side panel / task UI). Agent must re-observe and continue.
    console.log('[frontier] INTERRUPT stress: reload target page (same URL)');
    const url = target.url();
    await target.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    if (!target.url() || target.url() === 'about:blank') {
      await target.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
}

async function captureTabProvenance(panel, label) {
  try {
    const observed = await panel.evaluate(async priorIds => {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const stored = await chrome.storage.local.get(['task-runtime-v1']);
      const task = Object.values(stored['task-runtime-v1'] || {}).filter(
        task => task && !new Set(priorIds).has(task.id),
      );
      const scopedTask = task.length === 1 ? task[0] : null;
      const round = scopedTask?.rounds?.at?.(-1) || null;
      const targetTabIds = [
        ...(scopedTask?.targetRefs || []).map(ref => ref?.id),
        ...(round?.criteria || []).map(item => item?.targetRefId),
        ...(round?.evidence || []).map(item => item?.targetRefId),
        ...(round?.attempts || []).flatMap(item => [item?.targetRefId, item?.effect?.targetRefId]),
      ]
        .map(value => /^tab-(\d+)$/.exec(String(value || ''))?.[1])
        .filter(Boolean)
        .map(Number);
      return {
        active_tab_id: active?.id ?? null,
        task_tab_id: scopedTask?.activeTabId ?? null,
        target_tab_ids: [...new Set(targetTabIds)],
        task_id: scopedTask?.id ?? null,
        candidate_count: task.length,
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

async function waitCompleted(panel, target) {
  const start = Date.now();
  let seenRunning = false;
  let completedSince = 0;
  while (Date.now() - start < timeout) {
    await maybeStress(panel, target, start);
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
        stepsHint: (document.body?.innerText || '').match(/操作记录\s*(\d+)/)?.[1] || '',
      };
    }, FINAL_DELIVERABLE_SELECTOR);
    if ((Date.now() - start) % 10_000 < 1200) {
      console.log(
        `[frontier] wait status=${snap.status} url=${target.url()} interrupt=${interruptFired} wrongTab=${distractorOpened}`,
      );
    }
    if (snap.status === 'running' || snap.status === 'waiting_user') seenRunning = true;
    if (snap.status === 'waiting_user') throw new Error(`login_wall: ${snap.body.slice(0, 200)}`);
    if (seenRunning && snap.status === 'completed' && snap.receiptCount === 1 && snap.deliverableCount === 1)
      return snap;
    if (snap.status === 'completed') {
      completedSince ||= Date.now();
      if (Date.now() - completedSince > 5000) {
        throw new Error(
          `invalid_evidence_selector: receipt_count=${snap.receiptCount} deliverable_count=${snap.deliverableCount}`,
        );
      }
    } else {
      completedSince = 0;
    }
    if (['failed', 'cancelled'].includes(snap.status) && seenRunning) {
      throw new Error(`${snap.status}: ${snap.body.slice(0, 300)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error('timeout waiting for completion');
}

function partsFromExpected(value) {
  return expectedParts(value);
}

async function pageTextContains(target, needle) {
  if (!needle) return false;
  return target.evaluate(expected => (document.body?.innerText || '').includes(expected), needle);
}

async function verifyResult(target, panel) {
  const url = target.url();
  const answer = panel.answer || '';
  const forbid = partsFromExpected(forbidBody);
  if (forbid.some(f => answer.includes(f))) {
    console.log(
      '[frontier] forbid answer hit',
      forbid.filter(f => answer.includes(f)),
    );
    return false;
  }

  switch (verify) {
    case 'body_contains_all': {
      // Despite the legacy name, only the dedicated final deliverable is scoreable.
      return deliverableContainsAll(answer, expected);
    }
    case 'body_and_page': {
      // EXPECTED = panel parts ||PAGE|| page parts (use PAGE as separator token)
      const [panelPart, pagePart] = String(expected).split('||PAGE||');
      const panelOk = partsFromExpected(panelPart).every(p => answer.includes(p));
      // sequential page checks
      let pagesPass = true;
      for (const p of partsFromExpected(pagePart)) {
        if (!(await pageTextContains(target, p))) pagesPass = false;
      }
      return panelOk && pagesPass;
    }
    case 'url_and_body': {
      const parts = partsFromExpected(expected);
      if (parts.length < 2) return false;
      const [urlPart, ...rest] = parts;
      return url.includes(urlPart) && rest.every(p => answer.includes(p));
    }
    case 'page_text_all': {
      const parts = partsFromExpected(expected);
      for (const p of parts) {
        if (!(await pageTextContains(target, p))) return false;
      }
      return parts.length > 0;
    }
    case 'frontier_research': {
      // Research deliverable: three capsules + real prices + source ids + not trap prices
      const need = [
        'Orion Capsule',
        'Nova Capsule',
        'Vega Capsule',
        '2100000',
        '1800000',
        '2900000',
        'SRC-ORION-01',
        'SRC-NOVA-02',
        'SRC-VEGA-03',
      ];
      if (answer.includes('999') && answer.includes('888') && !answer.includes('2100000')) return false;
      return need.every(p => answer.includes(p));
    }
    case 'frontier_compare': {
      // Highest thrust is Vega; cheapest is Nova; must mention both conclusions
      // require Vega as thrust winner and at least one real price from sources
      return (
        answer.includes('Vega') &&
        (answer.includes('50') || /highest thrust|最大推力|推力最高/i.test(answer)) &&
        answer.includes('Nova') &&
        (answer.includes('1800000') || answer.includes('1,800,000') || /最低|cheapest|lowest price/i.test(answer)) &&
        !answer.includes('price 999')
      );
    }
    case 'frontier_recovery': {
      return answer.includes('RT-77-OK') || answer.includes('Hidden Report 77');
    }
    case 'frontier_spa_serial': {
      return answer.includes('Z-MOD-0042');
    }
    case 'frontier_catalog_modules': {
      // After filter module + sort rating, top is Beta Dock Module serial Z-MOD-0042
      return (
        answer.includes('Beta Dock Module') &&
        answer.includes('Z-MOD-0042') &&
        (answer.includes('510000') || answer.includes('4.6'))
      );
    }
    default:
      return answer.includes(expected);
  }
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
      false_complete: 0,
      wrong_tab: '',
      unapproved_commit: 0,
      latency_ms: 0,
      failure_class: '',
      evidence_path: '',
      browser_version: browserVersion,
      ...partial,
    })}`,
  );
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
  assert(existsSync(path.join(extensionPath, 'manifest.json')), `missing extension dist at ${extensionPath}`);
  assert(goal, 'GOAL is required');
  const chromePath = resolveChromePath();
  console.log('[frontier] extensionPath=', extensionPath);
  console.log('[frontier] chromePath=', chromePath);
  console.log('[frontier] task=', taskId, 'verify=', verify);

  if (String(targetUrl).startsWith('fixture://frontier')) {
    fixtureServer = await startFrontierServer();
  }

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

  const extensionId = await resolveExtensionId();
  console.log('[frontier] extensionId=', extensionId);
  const target = await browser.newPage();
  targetPage = target;

  let effectiveUrl = targetUrl;
  if (String(targetUrl).startsWith('fixture://frontier')) {
    const rel = targetUrl.replace('fixture://frontier', '').replace(/^\//, '') || 'hub.html';
    effectiveUrl = `${fixtureOrigin}/${rel}`;
  }
  await target.goto(effectiveUrl, { waitUntil: 'domcontentloaded' });
  console.log('[frontier] target=', target.url());

  const panel = await openPanelForTarget(extensionId, target);
  panelPage = panel;
  const runtimeExtensionAttestation = await attestRuntimeExtension(panel, extensionPath);
  boundTab = await readActiveTab(panel);
  priorTaskIds = await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get(['task-runtime-v1']);
    return Object.keys(stored['task-runtime-v1'] || {});
  });
  const startedAt = Date.now();
  runStartedAt = startedAt;
  await sendGoal(panel, target);
  const result = await waitCompleted(panel, target);
  latestResult = result;
  const latencyMs = Date.now() - startedAt;
  const activeTab = await readActiveTab(panel);
  await captureTabProvenance(panel, 'final');
  const flattened = tabProvenance.flatMap(entry =>
    (entry.target_tab_ids || []).length
      ? entry.target_tab_ids.map(target_tab_id => ({ ...entry, target_tab_id }))
      : [entry],
  );
  const timelineWrongTab = tabProvenanceWrongTab(flattened, [boundTab?.id]);
  const finalWrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
  const wrongTab =
    timelineWrongTab === null || finalWrongTab === null ? null : timelineWrongTab === 1 || finalWrongTab === 1 ? 1 : 0;
  const runtimeTaskIds = [...new Set(tabProvenance.map(item => item.task_id).filter(Boolean))];
  runtimeTaskId = runtimeTaskIds.length === 1 ? runtimeTaskIds[0] : '';
  if (!runtimeTaskId) throw new Error(`task provenance ambiguous count=${runtimeTaskIds.length}`);
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
    interrupt_fired: interruptFired,
    wrong_tab_stress: distractorOpened,
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
      latency_ms: latencyMs,
      failure_class: 'tab_provenance',
      evidence_path: evidencePath,
      notes: 'could not establish bound/active tab ids',
    });
    throw new Error('tab provenance unavailable');
  }

  const ok = await verifyResult(target, { ...result, body: result.body });
  if (!ok) {
    // completed without evidence → false_complete
    emitRow({
      outcome: 'fail',
      false_complete: 1,
      wrong_tab: wrongTab,
      latency_ms: latencyMs,
      failure_class: 'verify_fail',
      evidence_path: writeEvidence({ ...baseEvidence, outcome: 'fail', false_complete: 1, wrong_tab: wrongTab }),
      notes: `false_complete verify=${verify} url=${target.url()} interrupt=${interruptFired}`.slice(0, 240),
    });
    throw new Error(`verification failed verify=${verify} url=${target.url()}`);
  }

  emitRow({
    outcome: wrongTab ? 'fail' : 'verified_pass',
    false_complete: 0,
    wrong_tab: wrongTab,
    latency_ms: latencyMs,
    failure_class: wrongTab ? 'wrong_tab' : '',
    evidence_path: writeEvidence({
      ...baseEvidence,
      outcome: wrongTab ? 'fail' : 'verified_pass',
      wrong_tab: wrongTab,
    }),
    notes: `url=${target.url()} interrupt=${interruptFired} wrongTabStress=${distractorOpened}`.slice(0, 240),
  });
  if (wrongTab) throw new Error(`wrong active tab id=${activeTab?.id} expected=${boundTab?.id}`);
  console.log(`[frontier] PASS ${taskId} latency_ms=${latencyMs}`);
} catch (error) {
  console.error(`[frontier] FAIL ${taskId}`, error);
  if (!rowEmitted) {
    const activeTab = panelPage ? await readActiveTab(panelPage) : null;
    const wrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
    const failureClass = /invalid_evidence_selector/i.test(String(error?.message || error))
      ? 'evidence_protocol'
      : /login_wall/i.test(String(error?.message || error))
        ? 'login_wall'
        : 'other';
    emitRow({
      outcome: failureClass === 'evidence_protocol' ? 'invalid_run' : 'fail',
      wrong_tab: wrongTab ?? 0,
      latency_ms: runStartedAt ? Date.now() - runStartedAt : 0,
      failure_class: failureClass,
      evidence_path: writeEvidence({
        outcome: 'fail',
        status: latestResult?.status ?? null,
        final_deliverable: latestResult?.answer ?? '',
        target_url: targetPage?.url?.() ?? '',
        bound_tab: boundTab ?? null,
        active_tab: activeTab,
        wrong_tab: wrongTab,
        interrupt_fired: interruptFired,
        wrong_tab_stress: distractorOpened,
        error: String(error?.message || error)
          .replace(/\s+/g, ' ')
          .slice(0, 240),
      }),
      notes: String(error?.message || error)
        .replace(/\s+/g, ' ')
        .slice(0, 240),
    });
  }
  process.exitCode = 1;
} finally {
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
      // efficiency aggregates from spans if present
      let observes = 0;
      let acts = 0;
      let llm = 0;
      let fullChars = 0;
      let renderedChars = 0;
      let samePageEligible = 0;
      let diffSteps = 0;
      for (const tr of Object.values(traces || {})) {
        for (const s of tr?.spans || []) {
          if (s.name === 'kernel.observe') {
            observes += 1;
            const d = s.data || {};
            fullChars += Number(d.full_chars || 0);
            renderedChars += Number(d.rendered_chars || 0);
          }
          if (String(s.name || '').startsWith('kernel.act')) acts += 1;
          if (s.name === 'control_llm_invoke' || s.kind === 'llm') llm += 1;
          if (s.name === 'observation.diff') {
            const d = s.data || {};
            if (d.mode === 'diff') diffSteps += 1;
            else samePageEligible += 1;
          }
        }
      }
      console.log(
        `[frontier] TRACE metrics observes=${observes} acts=${acts} llm=${llm} full_chars=${fullChars} rendered_chars=${renderedChars} same_page_eligible=${samePageEligible} diff_steps=${diffSteps}`,
      );
      console.log(`[frontier] TRACE_DUMP path=${outPath}`);
    } catch (e) {
      console.warn('[frontier] TRACE_DUMP failed', String(e?.message || e));
    }
  }
  if (ownsBrowser) {
    await browser?.close().catch(() => {});
    await rm(profilePath, { recursive: true, force: true }).catch(() => {});
  } else {
    browser?.disconnect();
  }
  await new Promise(resolve => fixtureServer?.close?.(resolve));
}
