import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-action-e2e-${process.pid}`);
const runs = Number(process.env.RUNS || 1);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 180_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
/** CDP/CONNECT attaches to owner Chrome — never wipe favorites/chat/Task/Skill unless FORCE_RESET=1. */
const forceReset = process.env.FORCE_RESET === '1';
const isConnectMode = Boolean(connectUrl);
let submissions = 0;
let browser;
let ownsBrowser = false;

/**
 * Stable Google Chrome ignores --load-extension (branded builds).
 * Prefer CHROME_PATH, then Chrome for Testing / Chromium.
 */
function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    path.join(
      os.homedir(),
      'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    path.join(
      os.homedir(),
      '.agent-browser/browsers/chrome-146.0.7680.80/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1];
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function resolveMiniMaxApiKey() {
  if (process.env.MINIMAX_API_KEY) return process.env.MINIMAX_API_KEY;
  if (process.env.MINIMAX_TOKEN_PLAN_KEY) return process.env.MINIMAX_TOKEN_PLAN_KEY;
  const files = [
    path.join(os.homedir(), '.config/ai-providers/env.local'),
    path.join(os.homedir(), '.config/ai-providers/.env'),
    path.resolve(__dirname, '../../../.env.local'),
    path.resolve(__dirname, '../../.env.local'),
  ];
  for (const file of files) {
    const env = parseEnvFile(file);
    const key = (env.MINIMAX_API_KEY || env.MINIMAX_TOKEN_PLAN_KEY || '').trim();
    if (key) return key;
  }
  const secretsPath = path.resolve(__dirname, '../src/personal/secrets.local.ts');
  if (existsSync(secretsPath)) {
    const text = readFileSync(secretsPath, 'utf8');
    const match = text.match(/PERSONAL_MINIMAX_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) return match[1];
  }
  return '';
}

const chromePath = resolveChromePath();

function silentWav() {
  const dataBytes = 8000;
  const out = Buffer.alloc(44 + dataBytes);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataBytes, 4);
  out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(8000, 24);
  out.writeUInt32LE(8000, 28);
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
  const fixture = url.pathname === '/media' ? 'media.html' : 'form.html';
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
    if (state.hasStop && (state.status === 'running' || state.status === 'waiting_approval' || !state.status)) {
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

async function seedMiniMax(panel) {
  const apiKey = resolveMiniMaxApiKey();
  assert(apiKey, 'MINIMAX_API_KEY is required (env or ~/.config/ai-providers/env.local)');
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
  const baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  await panel.evaluate(
    async ({ apiKey, model, baseUrl }) =>
      chrome.storage.local.set({
        'llm-api-keys': {
          providers: {
            minimax: {
              name: 'MiniMax',
              type: 'custom_openai',
              apiKey,
              baseUrl,
              modelNames: [model],
              createdAt: Date.now(),
            },
          },
        },
        'agent-models': {
          agents: {
            planner: { provider: 'minimax', modelName: model, parameters: { temperature: 0.1, topP: 0.1 } },
            navigator: { provider: 'minimax', modelName: model, parameters: { temperature: 0.1, topP: 0.1 } },
          },
        },
        // Full defaults: chrome.storage.set replaces the whole key; do not leave maxFailures undefined.
        'general-settings': {
          maxSteps: 100,
          maxActionsPerStep: 5,
          maxFailures: 3,
          useVision: false,
          useVisionForPlanner: false,
          planningInterval: 3,
          displayHighlights: false,
          minWaitPageLoad: 250,
          agentCoreBackend: 'control',
        },
      }),
    { apiKey, model, baseUrl },
  );
}

/**
 * Form/skill external commit: must observe the approval control.
 * Never treat prior completed+receipt as a stand-in for the gate.
 */
async function waitForApproval(panel, target, { maxCountBefore = 0 } = {}) {
  const start = Date.now();
  let seenActiveRun = false;
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'),
      hasApprove: Boolean(document.querySelector('[data-testid="approval-approve"]')),
      hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      body: (document.body?.innerText || '').slice(0, 400),
    }));
    const formText = await target.evaluate(() => document.body.innerText).catch(() => '');
    const count = await readSubmitCount();
    if (snap.status === 'running' || snap.status === 'waiting_approval') seenActiveRun = true;
    if (Date.now() - start > 5000 && (Date.now() - start) % 15000 < 2000) {
      console.log(
        `[e2e] approval-wait status=${snap.status} count=${count} form=${JSON.stringify(formText.slice(0, 40))}`,
      );
    }
    // Unapproved external commit already landed — hard fail (not a green path).
    if (count > maxCountBefore && !snap.hasApprove) {
      await dumpPanel(panel, 'submit-without-approval');
      throw new Error(
        `submit count=${count} exceeded maxCountBefore=${maxCountBefore} without observing approval-approve`,
      );
    }
    if (snap.hasApprove) {
      if (count > maxCountBefore) {
        throw new Error(`approval visible but count already ${count} (expected <= ${maxCountBefore})`);
      }
      return snap;
    }
    // Prior leg may still paint completed until the new run mounts — ignore until active.
    if (snap.status === 'completed' && snap.hasReceipt && seenActiveRun) {
      await dumpPanel(panel, 'completed-without-approval');
      throw new Error(`task completed with receipt before approval-approve (count=${count})`);
    }
    if (['failed', 'cancelled'].includes(snap.status) && seenActiveRun) {
      await dumpPanel(panel, `task-${snap.status}-before-approval`);
      await dumpTaskStorage(panel, `task-${snap.status}-before-approval-storage`);
      throw new Error(`task ${snap.status} before approval: ${snap.body}`);
    }
    if (snap.status === 'waiting_user' && seenActiveRun) {
      await dumpPanel(panel, 'waiting-user-before-approval');
      await dumpTaskStorage(panel, 'waiting-user-before-approval-storage');
      throw new Error(`task waiting_user before approval: ${snap.body}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  await dumpPanel(panel, 'approval-timeout');
  throw new Error('timeout waiting for approval-approve');
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

function summarizeTask(task) {
  if (!task || typeof task !== 'object') return task;
  return {
    id: task.id,
    status: task.status,
    activeTabId: task.activeTabId,
    criteria: task.rounds?.[0]?.criteria?.map(c => ({
      kind: c.kind,
      targetRefId: c.targetRefId,
      baseline: c.baseline,
      notBefore: c.notBefore,
      timeoutMs: c.timeoutMs,
      expectedDigest: c.expectedDigest,
    })),
    attempts: task.rounds?.[0]?.attempts?.map(a => ({
      actionName: a.actionName,
      effect: a.effect,
      state: a.state,
    })),
    evidence: task.rounds?.[0]?.evidence?.slice(-4),
    waitReason: task.rounds?.[0]?.waitReason,
    receipt: task.rounds?.[0]?.receipt ? true : false,
  };
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

/**
 * Drive external-commit approval until fixture submit count hits expectedCount.
 *
 * Contract (form/skill):
 * - Must observe approval-approve at least once
 * - count stays at maxCountBefore until an approve click; no unapproved submit
 * - Exactly one approve click may advance count to expectedCount (the real commit)
 * - Intermediate over-gated clicks may need extra approve clicks while count still baseline
 * - Never green on prior completed receipt alone
 */
async function approveOnceAndWaitCompleted(
  panel,
  target,
  { maxCountBefore, expectedCount, notBeforeReceiptId = null },
) {
  const start = Date.now();
  let seenActiveRun = false;
  let sawApproval = false;
  let gateClicks = 0;
  let commitClicks = 0;
  let lastClickAt = 0;

  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'),
      receipt: document.querySelector('[data-testid="completion-receipt"]')?.textContent || null,
      hasApprove: Boolean(document.querySelector('[data-testid="approval-approve"]')),
      body: (document.body?.innerText || '').slice(0, 400),
    }));
    if (snap.status === 'running' || snap.status === 'waiting_approval') seenActiveRun = true;
    const formText = await target.evaluate(() => document.body.innerText).catch(() => '');
    const count = await readSubmitCount();
    const receiptId = await readReceiptId(panel);
    console.log(
      `[e2e] poll status=${snap.status} count=${count} hasApprove=${snap.hasApprove} gates=${gateClicks} commits=${commitClicks} form=${JSON.stringify(formText.slice(0, 40))}`,
    );

    // Unapproved external commit landed — hard fail.
    if (count > maxCountBefore && !sawApproval) {
      await dumpPanel(panel, 'submit-without-approval');
      throw new Error(`submit count=${count} without observing approval-approve`);
    }
    if (count > expectedCount) {
      throw new Error(`submit count=${count} exceeded expectedCount=${expectedCount}`);
    }

    if (snap.hasApprove && count < expectedCount) {
      // Debounce: same gate must not be multi-clicked within a short window.
      if (Date.now() - lastClickAt < 800) {
        await new Promise(r => setTimeout(r, 300));
        continue;
      }
      assert.ok(
        count === maxCountBefore || count === expectedCount - 1,
        `approve only when count is baseline (${maxCountBefore}) or mid-leg; got ${count}`,
      );
      // Real form/skill commit: count must still be baseline when approving the submit that lands expectedCount.
      if (count > maxCountBefore) {
        throw new Error(`approval visible after count already advanced to ${count}`);
      }
      sawApproval = true;
      await target.bringToFront();
      await click(panel, 'approval-approve');
      gateClicks += 1;
      lastClickAt = Date.now();
      await new Promise(r => setTimeout(r, 500));
      const countAfterClick = await readSubmitCount();
      if (countAfterClick > count) {
        commitClicks += 1;
        assert.equal(countAfterClick, expectedCount, 'a single approve click must land exactly expectedCount');
        assert.equal(commitClicks, 1, 'only one approve click may advance the submit counter');
        console.log(`[e2e] commit approve landed count ${count}→${countAfterClick} (gateClicks=${gateClicks})`);
      } else {
        console.log(`[e2e] intermediate approve click #${gateClicks} (count still ${countAfterClick})`);
      }
      continue;
    }

    if (snap.status === 'completed' && snap.receipt && count === expectedCount) {
      if (notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId && !seenActiveRun) {
        console.log('[e2e] ignoring prior completed receipt while waiting for new run');
      } else if (notBeforeReceiptId && receiptId && receiptId === notBeforeReceiptId) {
        throw new Error(`completed with same receipt ${receiptId}; refuse stale-receipt pass`);
      } else {
        assert.equal(sawApproval, true, 'must observe approval-approve before verified completion');
        assert.equal(commitClicks, 1, 'submit counter must advance from exactly one approve click');
        assert.equal(count, expectedCount);
        assert.ok(snap.receipt, 'verified completion receipt required');
        return { ...snap, receiptId, count, gateClicks, commitClicks };
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
  throw new Error(
    `timeout waiting for completed (sawApproval=${sawApproval} gateClicks=${gateClicks} commitClicks=${commitClicks})`,
  );
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
    if (snap.status === 'running' || snap.status === 'waiting_approval' || snap.status === 'waiting_user') {
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

async function runAllScenarios(extensionId, run) {
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
  await sendGoal(panel, target, 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.');
  await dumpPanel(panel, `run${run}-after-send`);

  // Form: observe approval, count 0 before, single click, count 1 after; no old-receipt pass.
  const formDone = await approveOnceAndWaitCompleted(panel, target, {
    maxCountBefore: 0,
    expectedCount: 1,
    notBeforeReceiptId: formReceiptBefore,
  });
  await waitForTestId(panel, 'completion-receipt');
  console.log(`[e2e] run${run} form PASS receipt=${formDone.receiptId || 'text'}`);

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
  await click(panel, 'skill-run-confirm');
  // Skill re-run is a second external commit: count stays 1 until one approval, then 2.
  const skillDone = await approveOnceAndWaitCompleted(panel, target, {
    maxCountBefore: 1,
    expectedCount: 2,
    notBeforeReceiptId: skillReceiptBefore,
  });
  await waitForTestId(panel, 'completion-receipt');
  console.log(`[e2e] run${run} skill PASS receipt=${skillDone.receiptId || 'text'}`);

  const media = await browser.newPage();
  await media.goto(`${origin}/media?run=${run}`, { waitUntil: 'domcontentloaded' });
  // Fixture starts paused; prove play before pause.
  assert.equal(await media.$eval('#fixture-audio', el => el.paused), true, 'fixture must start paused');
  const mediaPanel = await openPanelForTarget(extensionId, media);
  await sendGoal(mediaPanel, media, 'Play the visible audio.');
  const playResult = await waitMediaState(mediaPanel, media, {
    expectPaused: false,
    notBeforeReceiptId: null,
    label: 'play',
  });
  assert.equal(playResult.paused, false, 'must prove playing after play task');
  assert.ok(playResult.receiptId || playResult.snap.hasReceipt, 'play must produce a receipt');
  const playDigest = playResult.facts?.digests?.[0] || (await readLatestMediaFacts(mediaPanel))?.digests?.[0] || null;
  assert.ok(playDigest, 'play must bind a media digest');
  console.log(`[e2e] run${run} media play PASS digest=${playDigest} receipt=${playResult.receiptId}`);

  await sendGoal(mediaPanel, media, '暂停这个音频');
  const pauseResult = await waitMediaState(mediaPanel, media, {
    expectPaused: true,
    notBeforeReceiptId: playResult.receiptId,
    label: 'pause',
  });
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
  console.log('[e2e] hasMiniMaxKey=', Boolean(resolveMiniMaxApiKey()));

  if (connectUrl) {
    console.log('[e2e] connect mode', connectUrl, forceReset ? 'FORCE_RESET=1' : 'no-wipe');
    browser = await puppeteer.connect({ browserURL: connectUrl, defaultViewport: null });
    ownsBrowser = false;
  } else {
    console.log('[e2e] chromePath=', chromePath);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
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

  for (let run = 0; run < runs; run += 1) {
    console.log(`[e2e] run ${run + 1}/${runs}`);
    await runAllScenarios(extensionId, run);
  }
  console.log(`action-agent-e2e PASS runs=${runs}`);
} catch (error) {
  console.error('[e2e] FAIL', error);
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
