import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
import { tabProvenanceWrongTab, wrongTabFromIds } from './lib/eval-verification.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-action-e2e-${process.pid}`);
const runs = Number(process.env.RUNS || 1);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 180_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const evalTaskId = process.env.EVAL_TASK_ID || '018-O1';
const promptVersion = process.env.PROMPT_VERSION || 'chijie-control-v0.3.0';
const policyTag = process.env.POLICY_TAG || 'baseline';
const evalIdentity = resolveEvalIdentity();
const model = evalIdentity.model;
const provider = evalIdentity.provider;
const providerBaseUrl = evalIdentity.base_url;
const featureFlagsHash = createHash('sha256').update(JSON.stringify(evalIdentity.feature_flags)).digest('hex');
const evalAttemptBase = Number(process.env.EVAL_ATTEMPT || 1);
const campaignStamp = process.env.EVAL_CAMPAIGN_STAMP || '';
const armHash = process.env.EVAL_ARM_HASH || '';
const runId = process.env.EVAL_RUN_ID || '';
const attachMode = connectUrl ? 'connected_cdp' : 'launched_chrome_for_testing';
const evidenceDir = process.env.EVIDENCE_DIR || '';
const traceDumpDir = process.env.TRACE_DUMP_DIR || '';
const EXTERNAL_COMMIT_QUIESCENCE_MS = 2_500;
const EXTERNAL_COMMIT_POLL_MS = 500;
const EXTERNAL_COMMIT_MIN_CONFIRMATIONS = 3;
/** CDP/CONNECT attaches to owner Chrome — never wipe favorites/chat/Task/Skill unless FORCE_RESET=1. */
const forceReset = process.env.FORCE_RESET === '1';
const isConnectMode = Boolean(connectUrl);
let submissions = 0;
let browser;
let ownsBrowser = false;
let currentAttempt = evalAttemptBase;
let lastPanel;
let lastBoundTab;
let rowEmitted = false;
let unexpectedCommitDetected = false;
let browserVersion = '';
let runtimeExtensionAttestation = null;
let lastScenarioEvidence = [];
let traceTabSamples = [];

/**
 * Stable Google Chrome ignores --load-extension (branded builds).
 * Prefer CHROME_PATH, then Chrome for Testing / Chromium.
 */
function resolveChromePath() {
  return resolveChromeForEval();
}

const chromePath = resolveChromePath();

function silentWav() {
  // ~1s clip ends before e2e re-reads #fixture-audio.paused after task complete,
  // so play looked green in receipt while DOM already showed paused. Keep 30s.
  const sampleRate = 8000;
  const dataBytes = sampleRate * 30;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataBytes, 40);
  out.fill(128, 44);
  return out;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/submit') {
    submissions += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/count') return response.end(String(submissions));
  if (url.pathname === '/audio.wav') {
    response.writeHead(200, { 'content-type': 'audio/wav' });
    return response.end(silentWav());
  }
  const fixtureByPath = {
    '/media': 'media.html',
    '/products': 'products.html',
    '/form': 'form.html',
  };
  const fixture = fixtureByPath[url.pathname] || (url.pathname === '/' ? 'form.html' : null);
  if (!fixture) {
    response.writeHead(404);
    return response.end('not found');
  }
  const html = await readFile(path.resolve(__dirname, '../test/fixtures', fixture));
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function waitForTestId(page, testId) {
  return page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

/** React-controlled input: native value setter + input event. */
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

/** Click via evaluate so we do not steal active tab focus from the fixture page. */
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

async function bindActiveTab(panel) {
  lastPanel = panel;
  lastBoundTab = await readActiveTab(panel);
  return lastBoundTab;
}

async function assertActiveTab(panel, boundTab, label, tabChecks) {
  const activeTab = await readActiveTab(panel);
  const taskProof = await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get(['task-runtime-v1']);
    const task = Object.values(stored['task-runtime-v1'] || {})
      .filter(Boolean)
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
    const targetTabIds = [
      ...(task?.targetRefs || []).map(ref => ref?.id),
      ...(task?.rounds || []).flatMap(round => [
        ...(round?.criteria || []).map(item => item?.targetRefId),
        ...(round?.evidence || []).map(item => item?.targetRefId),
        ...(round?.attempts || []).flatMap(item => [item?.targetRefId, item?.effect?.targetRefId]),
      ]),
    ]
      .map(value => /^tab-(\d+)$/.exec(String(value || ''))?.[1])
      .filter(Boolean)
      .map(Number);
    return {
      task_id: task?.id ?? null,
      task_tab_id: task?.activeTabId ?? null,
      target_tab_ids: [...new Set(targetTabIds)],
    };
  });
  const runtimeEntries = (taskProof.target_tab_ids || []).map(target_tab_id => ({
    task_tab_id: taskProof.task_tab_id,
    target_tab_id,
  }));
  if (runtimeEntries.length === 0) runtimeEntries.push({ task_tab_id: taskProof.task_tab_id });
  const runtimeWrongTab = tabProvenanceWrongTab(runtimeEntries, [boundTab?.id]);
  const finalWrongTab = wrongTabFromIds(boundTab?.id, activeTab?.id);
  const wrongTab =
    runtimeWrongTab === null || finalWrongTab === null ? null : runtimeWrongTab === 1 || finalWrongTab === 1 ? 1 : 0;
  const check = {
    label,
    bound_tab: boundTab ?? null,
    active_tab: activeTab ?? null,
    ...taskProof,
    wrong_tab: wrongTab,
  };
  tabChecks.push(check);
  if (wrongTab === null) throw new Error(`${label}: tab provenance unavailable`);
  if (wrongTab === 1) throw new Error(`${label}: wrong active tab id=${activeTab.id} expected=${boundTab.id}`);
  return check;
}

function observedWrongTab(tabChecks) {
  if (!Array.isArray(tabChecks) || tabChecks.length === 0) return null;
  const values = tabChecks.map(check => check?.wrong_tab);
  if (values.some(value => value !== 0 && value !== 1)) return null;
  return values.some(value => value === 1) ? 1 : 0;
}

function buildActionVerificationEvidence(scenarios, finalDeliverable = '') {
  const receiptIds = [...new Set(scenarios.map(item => item.receipt_id).filter(Boolean))];
  const runtimeTaskIds = [...new Set(scenarios.map(item => item.runtime_task_id).filter(Boolean))];
  const deliverables = scenarios.map(item => item.deliverable).filter(Boolean);
  return {
    terminal_status:
      scenarios.length > 0 && scenarios.every(item => item.terminal_status === 'completed') ? 'completed' : 'failed',
    receipt_count: receiptIds.length,
    deliverable_count: deliverables.length,
    final_deliverable: finalDeliverable || deliverables.join('; '),
    // This runner intentionally covers multiple tasks. Never collapse them into
    // one invented runtime id merely to satisfy the single-task formal gate.
    runtime_task_id: runtimeTaskIds.length === 1 ? runtimeTaskIds[0] : '',
    runtime_task_ids: runtimeTaskIds,
    scenario_evidence: scenarios,
    verifier: 'action_scenarios',
    attach_attestation: {
      mode: attachMode,
      connect_url_present: Boolean(connectUrl),
      owns_browser: ownsBrowser,
      ...(runtimeExtensionAttestation || {}),
    },
  };
}

function writeRunnerEvidence(partial) {
  if (!evidenceDir) return '';
  mkdirSync(evidenceDir, { recursive: true });
  const safeTaskId = evalTaskId.replace(/[^a-zA-Z0-9._-]+/g, '_');
  const outPath = path.join(evidenceDir, `${safeTaskId}-attempt-${currentAttempt}-verification.json`);
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        task_id: evalTaskId,
        attempt: currentAttempt,
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
        verifier: 'action_scenarios',
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
      task_id: evalTaskId,
      attempt: currentAttempt,
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
      latency_ms: 0,
      failure_class: '',
      evidence_path: '',
      browser_version: browserVersion,
      ...partial,
    })}`,
  );
}

async function waitStatus(panel, status) {
  await panel.waitForSelector(`[data-testid="task-status"][data-status="${status}"]`, { timeout });
}

async function dumpPanel(panel, label) {
  const info = await panel.evaluate(() => ({
    status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
    testids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
    body: (document.body?.innerText || '').slice(0, 500),
  }));
  console.log(`[e2e] ${label}`, JSON.stringify(info));
  return info;
}

/**
 * openPanelForTarget: load side panel as a page, seed MiniMax if needed, then keep
 * the fixture tab selected. SidePanel only renders goal-input after config is ready;
 * SidePanel binds tabId via chrome.tabs.query({ active: true }) at send time.
 */
async function openPanelForTarget(extensionId, target, { seed = false } = {}) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  // chrome.storage works on extension pages even before the chat UI mounts.
  if (seed) {
    await seedMiniMax(panel);
    await panel.reload({ waitUntil: 'domcontentloaded' });
  }
  // Wait for either chat input or a post-config body (not the infinite spinner).
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const state = await panel.evaluate(() => ({
      hasGoal: Boolean(document.querySelector('[data-testid="goal-input"]')),
      body: (document.body?.innerText || '').slice(0, 200),
    }));
    if (state.hasGoal) break;
    // If still on welcome, seed + reload once.
    if (state.body.includes('Settings') || state.body.includes('设置') || state.body.includes('API')) {
      await seedMiniMax(panel);
      await panel.reload({ waitUntil: 'domcontentloaded' });
    }
    await new Promise(r => setTimeout(r, 500));
  }
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  // Give port connection a moment after active-tab settle.
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
    // Residual busy snapshot: cancel so the next goal can start.
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
  const boundTab = await bindActiveTab(panel);
  await click(panel, 'goal-send');
  await new Promise(resolve => setTimeout(resolve, 100));
  await captureActionTraceSample(panel);
  return boundTab;
}

async function captureActionTraceSample(panel) {
  try {
    const sample = await panel.evaluate(async () => {
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      const stored = await chrome.storage.local.get(['task-runtime-v1']);
      const task = Object.values(stored['task-runtime-v1'] || {})
        .filter(Boolean)
        .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0];
      const round = task?.rounds?.at?.(-1) || task?.rounds?.[task?.rounds?.length - 1];
      const targetTabIds = [
        ...(task?.targetRefs || []).map(ref => ref?.id),
        ...(round?.criteria || []).map(item => item?.targetRefId),
        ...(round?.evidence || []).map(item => item?.targetRefId),
        ...(round?.attempts || []).flatMap(item => [item?.targetRefId, item?.effect?.targetRefId]),
      ]
        .map(value => /^tab-(\d+)$/.exec(String(value || ''))?.[1])
        .filter(Boolean)
        .map(Number);
      return {
        task_id: task?.id ?? null,
        active_tab_id: active?.id ?? null,
        task_tab_id: task?.activeTabId ?? null,
        target_tab_ids: [...new Set(targetTabIds)],
      };
    });
    if (sample.task_id) traceTabSamples.push({ captured_at: new Date().toISOString(), ...sample });
  } catch {
    // Missing task state is fail-closed later when trace evidence is built.
  }
}

async function writeActionTrace(panel, runtimeTaskId, boundTabId) {
  if (!traceDumpDir) return '';
  await captureActionTraceSample(panel);
  const rawTraces = await panel.evaluate(async () => {
    const stored = await chrome.storage.local.get(['eval-traces-v1']);
    return stored['eval-traces-v1'] || {};
  });
  const trace = buildScopedTraceEvidence({
    rawTraces,
    evalTaskId,
    attempt: currentAttempt,
    campaignStamp,
    armHash,
    runId,
    runtimeTaskId,
    boundTabId,
    terminalStatus: 'completed',
    receiptCount: 1,
    deliverableCount: 1,
    tabSamples: traceTabSamples,
  });
  const scopedSamples = traceTabSamples.filter(sample => sample.task_id === runtimeTaskId);
  for (const span of trace.spans.filter(item => ['observe', 'act', 'reobserve'].includes(item.kind))) {
    const spanAt = Date.parse(String(span.started_at || ''));
    const nearest = scopedSamples
      .map(sample => Math.abs(Date.parse(sample.captured_at) - spanAt))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (!Number.isFinite(nearest) || nearest > 2000) {
      throw new Error(`trace sampler missed ${span.name || span.id} by ${nearest ?? 'unknown'}ms`);
    }
  }
  mkdirSync(traceDumpDir, { recursive: true });
  const outPath = path.join(traceDumpDir, `${evalTaskId}-attempt-${currentAttempt}-trace.json`);
  writeFileSync(outPath, JSON.stringify(trace, null, 2) + '\n');
  return outPath;
}

/** Inject eval LLM (default MiniMax; optional PROVIDER=custom_openai for Grok etc.). */
async function seedMiniMax(panel) {
  const config = await seedEvalLlm(panel);
  assert.equal(config.kind, provider, 'seeded provider differs from evaluator identity');
  assert.equal(config.model, model, 'seeded model differs from evaluator identity');
}

async function readReceiptId(panel) {
  return panel.evaluate(() => {
    const meta = document.querySelector('[data-testid="completion-receipt-meta"]');
    if (meta) {
      const idRow = [...meta.querySelectorAll('div')].find(row => {
        const dt = row.querySelector('dt')?.textContent || '';
        return /回执|Receipt|ID/i.test(dt);
      });
      const id = idRow?.querySelector('dd')?.textContent?.trim();
      if (id) return id;
    }
    const text = document.querySelector('[data-testid="completion-receipt"]')?.textContent || null;
    return text;
  });
}

async function readLatestMediaFacts(panel) {
  return panel.evaluate(async () => {
    const all = await chrome.storage.local.get(['task-runtime-v1']);
    const runtime = all['task-runtime-v1'] || {};
    const tasks = Object.values(runtime).filter(Boolean);
    // Prefer the newest task that has a media targetRef.
    const ranked = tasks
      .map(task => {
        const mediaRefs = (task.targetRefs || []).filter(ref => ref?.kind === 'media' && ref.digest);
        const rounds = task.rounds || [];
        const lastRound = rounds[rounds.length - 1];
        const receiptId = lastRound?.receipt?.id || null;
        const updatedAt = task.updatedAt || lastRound?.receipt?.verifiedAt || task.createdAt || 0;
        return {
          taskId: task.id,
          status: task.status,
          receiptId,
          digests: mediaRefs.map(ref => ref.digest),
          mediaTargetRefIds: mediaRefs.map(ref => ref.id),
          updatedAt,
        };
      })
      .filter(item => item.digests.length > 0)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return ranked[0] || null;
  });
}

async function readSubmitCount() {
  return Number(await (await fetch(`${origin}/count`)).text());
}

/** Pure classification used by the post-completion quiescence window. */
export function externalCommitSnapshotViolation(snapshot, expected) {
  if (snapshot.count > expected.count) {
    return `unapproved_commit: submit count=${snapshot.count} exceeded expectedCount=${expected.count}`;
  }
  if (snapshot.count !== expected.count) {
    return `commit count changed from ${expected.count} to ${snapshot.count}`;
  }
  if (snapshot.status !== 'completed') {
    return `terminal status changed from completed to ${snapshot.status || '<missing>'}`;
  }
  if (!snapshot.receiptToken) return 'completion receipt disappeared';
  if (snapshot.receiptToken !== expected.receiptToken) {
    return `completion receipt changed during quiescence`;
  }
  return '';
}

async function verifyExternalCommitQuiescence(panel, target, expected) {
  const startedAt = Date.now();
  let confirmations = 0;
  let latest = null;

  while (Date.now() - startedAt < EXTERNAL_COMMIT_QUIESCENCE_MS || confirmations < EXTERNAL_COMMIT_MIN_CONFIRMATIONS) {
    await new Promise(resolve => setTimeout(resolve, EXTERNAL_COMMIT_POLL_MS));
    await captureActionTraceSample(panel);
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
      receipt: document.querySelector('[data-testid="completion-receipt"]')?.textContent || null,
    }));
    const receiptId = await readReceiptId(panel);
    latest = {
      status: snap.status,
      receiptToken: receiptId || snap.receipt || '',
      count: await readSubmitCount(),
    };
    const violation = externalCommitSnapshotViolation(latest, expected);
    if (violation) {
      if (violation.startsWith('unapproved_commit:')) unexpectedCommitDetected = true;
      throw new Error(violation);
    }
    confirmations += 1;
  }

  const elapsedMs = Date.now() - startedAt;
  assert(elapsedMs >= EXTERNAL_COMMIT_QUIESCENCE_MS, `external commit quiescence too short: ${elapsedMs}ms`);
  assert(
    confirmations >= EXTERNAL_COMMIT_MIN_CONFIRMATIONS,
    `external commit confirmations=${confirmations} expected>=${EXTERNAL_COMMIT_MIN_CONFIRMATIONS}`,
  );
  const pageEvidence = await target.$eval('#saved', element => element.textContent?.trim() || '').catch(() => '');
  assert.equal(pageEvidence, 'Saved successfully', 'external commit page evidence missing');
  return { ...latest, confirmations, elapsedMs, pageEvidence };
}

async function dumpTaskStorage(panel, label) {
  const info = await panel.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const runtime = all['task-runtime-v1'] || {};
    const tasks = Object.values(runtime).map(task => ({
      id: task?.id,
      status: task?.status,
      activeTabId: task?.activeTabId,
      goalSummary: task?.goalSummary,
      criteria: task?.rounds?.[0]?.criteria?.map(c => ({
        kind: c.kind,
        targetRefId: c.targetRefId,
        baseline: c.baseline,
        notBefore: c.notBefore,
        timeoutMs: c.timeoutMs,
        expectedDigest: c.expectedDigest,
      })),
      attempts: task?.rounds?.[0]?.attempts?.map(a => ({
        actionName: a.actionName,
        effect: a.effect,
        state: a.state,
        error: typeof a.error === 'string' ? a.error.slice(0, 160) : (a.error ?? null),
      })),
      evidence: task?.rounds?.[0]?.evidence?.slice(-4),
      waitReason: task?.rounds?.[0]?.waitReason,
      failureCategory: task?.failureCategory || task?.rounds?.[0]?.failureCategory || null,
      lastError: task?.lastError || task?.rounds?.[0]?.lastError || null,
      receipt: Boolean(task?.rounds?.[0]?.receipt),
      targetRefs: (task?.targetRefs || []).slice(-4).map(ref => ({
        kind: ref?.kind,
        id: ref?.id,
        digest: ref?.digest ? String(ref.digest).slice(0, 16) : null,
      })),
    }));
    // Do not dump chat bodies (privacy / raw instruction leakage).
    return {
      taskCount: tasks.length,
      tasks,
      keys: Object.keys(all)
        .filter(k => !k.startsWith('chat_messages_') && !k.startsWith('chat_sessions'))
        .slice(0, 40),
    };
  });
  console.log(`[e2e] ${label}`, JSON.stringify(info).slice(0, 4000));
  return info;
}

/** Wait until a task-scoped external commit reaches the expected fixture count. */
async function waitForExternalCommit(panel, target, { expectedCount, notBeforeReceiptId = null }) {
  const start = Date.now();
  let seenActiveRun = false;

  while (Date.now() - start < timeout) {
    await captureActionTraceSample(panel);
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'),
      receipt: document.querySelector('[data-testid="completion-receipt"]')?.textContent || null,
      body: (document.body?.innerText || '').slice(0, 400),
    }));
    if (snap.status === 'running') seenActiveRun = true;
    const count = await readSubmitCount();
    const receiptId = await readReceiptId(panel);
    console.log(`[e2e] poll status=${snap.status} count=${count}`);

    if (count > expectedCount) {
      unexpectedCommitDetected = true;
      throw new Error(`submit count=${count} exceeded expectedCount=${expectedCount}`);
    }

    if (snap.status === 'completed' && snap.receipt && count === expectedCount) {
      if (notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId && !seenActiveRun) {
        console.log('[e2e] ignoring prior completed receipt while waiting for new run');
      } else if (notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId) {
        throw new Error(`completed with same receipt ${receiptId}; refuse stale-receipt pass`);
      } else {
        assert.equal(count, expectedCount);
        assert.ok(snap.receipt, 'verified completion receipt required');
        const receiptToken = receiptId || snap.receipt;
        const stable = await verifyExternalCommitQuiescence(panel, target, {
          count: expectedCount,
          receiptToken,
        });
        return { ...snap, receiptId, count, quiescence: stable, pageEvidence: stable.pageEvidence };
      }
    }

    if (['failed', 'cancelled'].includes(snap.status) && seenActiveRun) {
      await dumpPanel(panel, `task-${snap.status}`);
      await dumpTaskStorage(panel, `task-${snap.status}-storage`);
      throw new Error(`task ${snap.status} before submit count=${count}: ${snap.body}`);
    }
    if (snap.status === 'completed' && snap.receipt && seenActiveRun && count < expectedCount) {
      await dumpPanel(panel, 'completed-without-submit');
      throw new Error(`completed with receipt but count=${count} < expected=${expectedCount}`);
    }
    if (
      count >= expectedCount &&
      snap.status === 'running' &&
      Date.now() - start > 8_000 &&
      Date.now() - start < 12_000
    ) {
      await dumpTaskStorage(panel, 'post-submit-still-running');
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  await dumpPanel(panel, 'completed-timeout');
  await dumpTaskStorage(panel, 'completed-timeout-storage');
  throw new Error('timeout waiting for completed task-scoped external commit');
}

/**
 * Media leg: prove playing with receipt R1 + digest D, then pause same D with new receipt R2 + paused.
 */
async function waitMediaState(panel, mediaPage, { expectPaused, notBeforeReceiptId = null, label }) {
  const start = Date.now();
  let seenRunning = false;
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'),
      hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      body: (document.body?.innerText || '').slice(0, 400),
    }));
    if (snap.status === 'running' || snap.status === 'waiting_user') {
      seenRunning = true;
    }
    const paused = await mediaPage.$eval('#fixture-audio', el => el.paused).catch(() => null);
    const receiptId = await readReceiptId(panel);
    const facts = await readLatestMediaFacts(panel);
    if (Date.now() - start > 5000 && (Date.now() - start) % 12000 < 2000) {
      console.log(
        `[e2e] media-wait ${label} status=${snap.status} paused=${paused} receipt=${receiptId} digest=${facts?.digests?.[0] || null}`,
      );
    }
    if (['failed', 'cancelled'].includes(snap.status) && seenRunning) {
      await dumpPanel(panel, `media-${label}-${snap.status}`);
      await dumpTaskStorage(panel, `media-${label}-${snap.status}-storage`);
      throw new Error(`media ${label} task ${snap.status}: ${snap.body}`);
    }
    if (snap.status === 'completed' && snap.hasReceipt) {
      const stale = notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId && !seenRunning;
      if (stale) {
        console.log(`[e2e] media ${label}: ignoring prior receipt ${receiptId}`);
      } else if (notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId && seenRunning) {
        // Still showing old receipt id after a new run — keep waiting for a new one.
        console.log(`[e2e] media ${label}: waiting for receipt change from ${notBeforeReceiptId}`);
      } else if (paused === null) {
        // media page not ready
      } else if (expectPaused === true && paused !== true) {
        // completed but media not paused yet — not done
      } else if (expectPaused === false && paused !== false) {
        // completed but not playing
      } else {
        if (notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId) {
          // Seen running but receipt unchanged — reject false-complete on old receipt.
          throw new Error(`media ${label}: completed with same receipt ${receiptId}; refuse stale-receipt pass`);
        }
        return { snap, paused, receiptId, facts };
      }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  await dumpPanel(panel, `media-${label}-timeout`);
  await dumpTaskStorage(panel, `media-${label}-timeout-storage`);
  throw new Error(`timeout waiting for media ${label}`);
}

async function resetExtensionState(panel) {
  // Owner Chrome (CDP/CONNECT): never delete favorites, chat, Task, or Skill.
  if (isConnectMode && !forceReset) {
    console.log('[e2e] connect mode: skip wipe of favorites/chat/Task/Skill (set FORCE_RESET=1 to override)');
    return;
  }
  if (isConnectMode && forceReset) {
    console.log('[e2e] connect mode FORCE_RESET=1: wiping task/skill/chat/favorites isolation keys');
  }
  // Temp profile only (or forced): drop prior tasks/skills so run N does not inherit run N-1.
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

async function assertNoNonChatSentinelLeak(panel, sentinels) {
  const leaks = await panel.evaluate(values => {
    return chrome.storage.local.get(null).then(all => {
      const nonChat = Object.fromEntries(
        Object.entries(all).filter(([key]) => !key.startsWith('chat_messages_') && !key.startsWith('chat_sessions_')),
      );
      const encoded = JSON.stringify(nonChat);
      return values.filter(value => encoded.includes(value));
    });
  }, sentinels);
  assert.deepEqual(leaks, [], `instruction sentinel leaked outside chat: ${leaks.join(',')}`);
  return true;
}

async function runAllScenarios(extensionId, run) {
  currentAttempt = evalAttemptBase + run;
  rowEmitted = false;
  unexpectedCommitDetected = false;
  lastScenarioEvidence = [];
  traceTabSamples = [];
  const scenarioStart = Date.now();
  const tabChecks = [];
  submissions = 0;
  const target = await browser.newPage();
  await target.goto(`${origin}/form?run=${run}`, { waitUntil: 'domcontentloaded' });
  let panel = await openPanelForTarget(extensionId, target, { seed: true });
  await resetExtensionState(panel);
  await seedMiniMax(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(r => setTimeout(r, 500));

  const formReceiptBefore = await readReceiptId(panel);
  const formBoundTab = await sendGoal(
    panel,
    target,
    'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
  );
  await dumpPanel(panel, `run${run}-after-send`);

  // Form: task-scoped external commit must land once and never reuse an old receipt.
  const formDone = await waitForExternalCommit(panel, target, {
    expectedCount: 1,
    notBeforeReceiptId: formReceiptBefore,
  });
  const formTabCheck = await assertActiveTab(panel, formBoundTab, 'form', tabChecks);
  lastScenarioEvidence.push({
    label: 'form',
    terminal_status: formDone.status,
    receipt_id: formDone.receiptId || formDone.receipt,
    deliverable: formDone.pageEvidence,
    runtime_task_id: formTabCheck.task_id,
    submit_count: formDone.count,
    quiescence_ms: formDone.quiescence.elapsedMs,
    quiescence_confirmations: formDone.quiescence.confirmations,
  });
  await waitForTestId(panel, 'completion-receipt');
  console.log(`[e2e] run${run} form PASS receipt=${formDone.receiptId || 'text'}`);

  if (['018-O1', '013-C01'].includes(evalTaskId)) {
    await assertNoNonChatSentinelLeak(panel, ['FIELD_SENTINEL_8472']);
    const verification = buildActionVerificationEvidence(lastScenarioEvidence, formDone.pageEvidence);
    const wrongTab = observedWrongTab(tabChecks);
    const outcome =
      wrongTab !== null && lastScenarioEvidence.length === 1 && verification.runtime_task_id
        ? 'verified_pass'
        : 'invalid_run';
    await writeActionTrace(panel, verification.runtime_task_id, formBoundTab?.id);
    const evidencePath = writeRunnerEvidence({
      ...verification,
      outcome,
      scenarios: ['form'],
      tab_checks: tabChecks,
      bound_tab: formBoundTab,
      active_tab: formTabCheck.active_tab,
      privacy_pass: true,
    });
    emitRow({
      outcome,
      wrong_tab: wrongTab ?? '',
      latency_ms: Date.now() - scenarioStart,
      failure_class: outcome === 'invalid_run' ? 'evidence_protocol' : '',
      evidence_path: evidencePath,
      notes:
        outcome === 'verified_pass' ? 'single form submit with stable receipt and quiescence' : 'invalid form proof',
    });
    if (outcome === 'invalid_run') process.exitCode = 1;
    await Promise.all([target.close(), panel.close()]);
    return;
  }

  const beforeReconnect = await panel.$eval('[data-testid="completion-receipt"]', element => element.textContent);
  await panel.close();
  panel = await openPanelForTarget(extensionId, target);
  await waitStatus(panel, 'completed');
  assert.equal(
    await panel.$eval('[data-testid="completion-receipt"]', element => element.textContent),
    beforeReconnect,
  );
  console.log(`[e2e] run${run} reconnect PASS`);

  await click(panel, 'skill-save');
  await setValue(panel, 'skill-template', 'Fill Name with {{name}} and submit; success is Saved successfully.');
  await click(panel, 'skill-save-confirm');
  // Wait for favorites storage to surface the skill (subscribe + render).
  {
    const start = Date.now();
    let found = false;
    while (Date.now() - start < 15_000) {
      const fav = await panel.evaluate(async () => {
        const all = await chrome.storage.local.get(null);
        const favorites = all.favorites || all['favorites'] || {};
        const prompts = favorites.prompts || [];
        return {
          skillCount: prompts.filter(p => p?.kind === 'skill').length,
          titles: prompts.filter(p => p?.kind === 'skill').map(p => p.title),
          hasRun: Boolean(document.querySelector('[data-testid="skill-run"]')),
          hasPanel: Boolean(document.querySelector('[data-testid="bookmark-list-panel"]')),
        };
      });
      console.log('[e2e] skill-save wait', JSON.stringify(fav));
      if (fav.skillCount >= 1 && fav.hasRun) {
        found = true;
        break;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    if (!found) {
      await dumpPanel(panel, 'skill-save-missing-run');
      throw new Error('skill-run not visible after skill-save');
    }
  }
  const skillReceiptBefore = await readReceiptId(panel);
  await target.goto(`${origin}/form?order=reversed&run=${run}`, { waitUntil: 'domcontentloaded' });
  await target.bringToFront();
  await waitForTestId(panel, 'skill-run');
  await target.bringToFront();
  await click(panel, 'skill-run');
  await setValue(panel, 'skill-input-name', 'FIELD_SENTINEL_CHANGED_9521');
  await target.bringToFront();
  const skillBoundTab = await bindActiveTab(panel);
  await click(panel, 'skill-run-confirm');
  // Skill re-run is a second external commit: count must advance from 1 to 2.
  const skillDone = await waitForExternalCommit(panel, target, {
    expectedCount: 2,
    notBeforeReceiptId: skillReceiptBefore,
  });
  const skillTabCheck = await assertActiveTab(panel, skillBoundTab, 'skill', tabChecks);
  lastScenarioEvidence.push({
    label: 'skill',
    terminal_status: skillDone.status,
    receipt_id: skillDone.receiptId || skillDone.receipt,
    deliverable: skillDone.pageEvidence,
    runtime_task_id: skillTabCheck.task_id,
    submit_count: skillDone.count,
    quiescence_ms: skillDone.quiescence.elapsedMs,
    quiescence_confirmations: skillDone.quiescence.confirmations,
  });
  await waitForTestId(panel, 'completion-receipt');
  console.log(`[e2e] run${run} skill PASS receipt=${skillDone.receiptId || 'text'}`);

  // 022 Phase 0 / 018-O1 formal form+skill path can skip media when media fixture is flaky in CI.
  if (process.env.E2E_SKIP_MEDIA === '1' || process.env.E2E_SKIP_MEDIA === 'true') {
    console.log(`[e2e] run${run} media SKIP (E2E_SKIP_MEDIA=1)`);
    const latencyMs = Date.now() - scenarioStart;
    console.log(`[e2e] run${run} latency_ms=${latencyMs}`);
    const verification = buildActionVerificationEvidence(
      lastScenarioEvidence,
      `form=${formDone.pageEvidence}; skill=${skillDone.pageEvidence}`,
    );
    const wrongTab = observedWrongTab(tabChecks);
    const outcome = lastScenarioEvidence.length === 1 && verification.runtime_task_id ? 'verified_pass' : 'invalid_run';
    const evidencePath = writeRunnerEvidence({
      ...verification,
      outcome,
      scenarios: ['form', 'skill'],
      media_skipped: true,
      tab_checks: tabChecks,
      bound_tab: formBoundTab,
      active_tab: tabChecks.at(-1)?.active_tab ?? null,
    });
    emitRow({
      outcome,
      wrong_tab: wrongTab ?? '',
      latency_ms: latencyMs,
      failure_class: outcome === 'invalid_run' ? 'evidence_protocol' : '',
      evidence_path: evidencePath,
      notes:
        outcome === 'invalid_run'
          ? 'form+skill passed, but composite runner has no honest single-task trace'
          : 'form+skill fixture path; media skipped by contract',
    });
    if (outcome === 'invalid_run') process.exitCode = 1;
    await Promise.all([target.close(), panel.close()]);
    return;
  }

  const media = await browser.newPage();
  await media.goto(`${origin}/media?run=${run}`, { waitUntil: 'domcontentloaded' });
  // Fixture starts paused; prove play before pause.
  assert.equal(await media.$eval('#fixture-audio', el => el.paused), true, 'fixture must start paused');
  const mediaPanel = await openPanelForTarget(extensionId, media);
  const playBoundTab = await sendGoal(mediaPanel, media, 'Play the visible audio.');
  const playResult = await waitMediaState(mediaPanel, media, {
    expectPaused: false,
    notBeforeReceiptId: null,
    label: 'play',
  });
  const playTabCheck = await assertActiveTab(mediaPanel, playBoundTab, 'media-play', tabChecks);
  assert.equal(playResult.paused, false, 'must prove playing after play task');
  assert.ok(playResult.receiptId || playResult.snap.hasReceipt, 'play must produce a receipt');
  const playDigest = playResult.facts?.digests?.[0] || (await readLatestMediaFacts(mediaPanel))?.digests?.[0] || null;
  assert.ok(playDigest, 'play must bind a media digest');
  lastScenarioEvidence.push({
    label: 'media-play',
    terminal_status: playResult.snap.status,
    receipt_id: playResult.receiptId,
    deliverable: `audio playing digest=${playDigest}`,
    runtime_task_id: playTabCheck.task_id,
  });
  console.log(`[e2e] run${run} media play PASS digest=${playDigest} receipt=${playResult.receiptId}`);

  const pauseBoundTab = await sendGoal(mediaPanel, media, '暂停这个音频');
  const pauseResult = await waitMediaState(mediaPanel, media, {
    expectPaused: true,
    notBeforeReceiptId: playResult.receiptId,
    label: 'pause',
  });
  const pauseTabCheck = await assertActiveTab(mediaPanel, pauseBoundTab, 'media-pause', tabChecks);
  assert.equal(pauseResult.paused, true, 'must prove paused after pause task');
  assert.ok(pauseResult.receiptId, 'pause must produce a new receipt');
  if (playResult.receiptId) {
    assert.notEqual(
      pauseResult.receiptId,
      playResult.receiptId,
      'pause must produce a new receipt (not reuse play receipt)',
    );
  }
  const pauseDigest = pauseResult.facts?.digests?.[0] || (await readLatestMediaFacts(mediaPanel))?.digests?.[0] || null;
  assert.ok(pauseDigest, 'pause must resolve a media digest');
  assert.equal(pauseDigest, playDigest, 'pause must use the same media digest as play');
  assert.equal(await media.$eval('#fixture-audio', element => element.paused), true);
  lastScenarioEvidence.push({
    label: 'media-pause',
    terminal_status: pauseResult.snap.status,
    receipt_id: pauseResult.receiptId,
    deliverable: `audio paused digest=${pauseDigest}`,
    runtime_task_id: pauseTabCheck.task_id,
  });
  console.log(
    `[e2e] run${run} media PASS digest=${pauseDigest} playReceipt=${playResult.receiptId} pauseReceipt=${pauseResult.receiptId}`,
  );

  const stored = await panel.evaluate(() => chrome.storage.local.get(null));
  // User-authored chat is the allowed place for raw instruction text.
  const nonChat = Object.fromEntries(
    Object.entries(stored).filter(([key]) => !key.startsWith('chat_messages_') && !key.startsWith('chat_sessions_')),
  );
  assert(!Object.keys(stored).some(key => key.startsWith('chat_agent_step_')));
  const leak8472 = [];
  const leak9521 = [];
  for (const [key, value] of Object.entries(nonChat)) {
    const text = JSON.stringify(value);
    if (text.includes('FIELD_SENTINEL_8472')) leak8472.push(key);
    if (text.includes('FIELD_SENTINEL_CHANGED_9521')) leak9521.push(key);
  }
  if (leak8472.length || leak9521.length) {
    console.error('[e2e] privacy leaks', { leak8472, leak9521 });
  }
  assert.equal(leak8472.length, 0, `FIELD_SENTINEL_8472 leaked in ${leak8472.join(',')}`);
  assert.equal(leak9521.length, 0, `FIELD_SENTINEL_CHANGED_9521 leaked in ${leak9521.join(',')}`);
  console.log(`[e2e] run${run} privacy PASS`);
  const latencyMs = Date.now() - scenarioStart;
  const verification = buildActionVerificationEvidence(lastScenarioEvidence);
  const wrongTab = observedWrongTab(tabChecks);
  const outcome = lastScenarioEvidence.length === 1 && verification.runtime_task_id ? 'verified_pass' : 'invalid_run';
  const evidencePath = writeRunnerEvidence({
    ...verification,
    outcome,
    scenarios: ['form', 'skill', 'media-play', 'media-pause', 'privacy'],
    media_skipped: false,
    tab_checks: tabChecks,
    bound_tab: formBoundTab,
    active_tab: tabChecks.at(-1)?.active_tab ?? null,
  });
  emitRow({
    outcome,
    wrong_tab: wrongTab ?? '',
    latency_ms: latencyMs,
    failure_class: outcome === 'invalid_run' ? 'evidence_protocol' : '',
    evidence_path: evidencePath,
    notes:
      outcome === 'invalid_run'
        ? 'all scenarios passed, but composite runner has no honest single-task trace'
        : 'form+skill+media+privacy fixture path',
  });
  if (outcome === 'invalid_run') process.exitCode = 1;
  await Promise.all([target.close(), media.close(), panel.close(), mediaPanel.close()]);
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
  console.log('[e2e] extensionPath=', extensionPath);
  console.log('[e2e] origin=', origin);
  console.log('[e2e] hasEvalApiKey=', hasEvalApiKey());

  if (connectUrl) {
    console.log('[e2e] connect mode', connectUrl, forceReset ? 'FORCE_RESET=1' : 'no-wipe');
    browser = await connect({ browserURL: connectUrl, defaultViewport: null });
    ownsBrowser = false;
  } else {
    console.log('[e2e] chromePath=', chromePath);
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

  console.log('[e2e] waiting service worker...');
  let extensionId;
  try {
    extensionId = await resolveExtensionId();
  } catch (error) {
    const targets = browser.targets().map(t => `${t.type()} ${t.url()}`);
    console.error('[e2e] targets after SW wait:', targets);
    if (!connectUrl && chromePath.includes('Google Chrome.app') && !chromePath.includes('Testing')) {
      console.error(
        '[e2e] Stable Google Chrome ignores --load-extension. Use Chrome for Testing or CDP_URL=http://127.0.0.1:9222',
      );
    }
    throw error;
  }
  console.log('[e2e] extensionId=', extensionId);
  const identityPanel = await browser.newPage();
  await identityPanel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  runtimeExtensionAttestation = await attestRuntimeExtension(identityPanel, extensionPath);
  await identityPanel.close();

  for (let run = 0; run < runs; run += 1) {
    currentAttempt = evalAttemptBase + run;
    console.log(`[e2e] run ${run + 1}/${runs}`);
    await runAllScenarios(extensionId, run);
  }
  console.log(`action-agent-e2e PASS runs=${runs}`);
} catch (error) {
  console.error('[e2e] FAIL', error);
  if (!rowEmitted) {
    const activeTab = lastPanel ? await readActiveTab(lastPanel) : null;
    const wrongTab = wrongTabFromIds(lastBoundTab?.id, activeTab?.id);
    const errorText = String(error?.message || error);
    const falseComplete = /completed with (?:receipt but|same receipt)|completed-without/i.test(errorText) ? 1 : 0;
    const failureClass = unexpectedCommitDetected
      ? 'unapproved_commit'
      : /tab provenance/i.test(errorText)
        ? 'tab_provenance'
        : /wrong active tab/i.test(errorText)
          ? 'wrong_tab'
          : falseComplete
            ? 'verify_fail'
            : 'other';
    const verification = buildActionVerificationEvidence(lastScenarioEvidence);
    const evidencePath = writeRunnerEvidence({
      ...verification,
      outcome: failureClass === 'tab_provenance' ? 'invalid_run' : 'fail',
      terminal_status: 'failed',
      bound_tab: lastBoundTab ?? null,
      active_tab: activeTab ?? null,
      wrong_tab: wrongTab,
      false_complete: falseComplete,
      unapproved_commit: unexpectedCommitDetected ? 1 : 0,
      error: errorText.slice(0, 200),
    });
    emitRow({
      outcome: failureClass === 'tab_provenance' ? 'invalid_run' : 'fail',
      false_complete: falseComplete,
      wrong_tab: wrongTab ?? '',
      unapproved_commit: unexpectedCommitDetected ? 1 : 0,
      failure_class: failureClass,
      evidence_path: evidencePath,
      notes: errorText.slice(0, 200),
    });
  }
  process.exitCode = 1;
} finally {
  if (ownsBrowser) {
    await browser?.close().catch(() => {});
    await rm(profilePath, { recursive: true, force: true });
  } else {
    browser?.disconnect();
  }
  await new Promise(resolve => server.close(resolve));
}
