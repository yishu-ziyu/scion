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

async function sendGoal(panel, target, instruction) {
  await setValue(panel, 'goal-input', instruction);
  const typed = await panel.$eval('[data-testid="goal-input"]', el => el.value);
  assert.equal(typed, instruction, 'goal input did not accept value');
  await target.bringToFront();
  await new Promise(r => setTimeout(r, 150));
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
      }),
    { apiKey, model, baseUrl },
  );
}

async function waitForApproval(panel, target) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'),
      hasApprove: Boolean(document.querySelector('[data-testid="approval-approve"]')),
      hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      body: (document.body?.innerText || '').slice(0, 400),
    }));
    const formText = await target.evaluate(() => document.body.innerText).catch(() => '');
    const count = Number(await (await fetch(`${origin}/count`)).text());
    if (Date.now() - start > 5000 && (Date.now() - start) % 15000 < 2000) {
      console.log(
        `[e2e] approval-wait status=${snap.status} count=${count} form=${JSON.stringify(formText.slice(0, 40))}`,
      );
    }
    if (snap.hasApprove) return snap;
    // Some models submit without a visible approval gate; accept verified completion.
    if (snap.status === 'completed' && snap.hasReceipt && count >= 1) return snap;
    if (['failed', 'cancelled'].includes(snap.status)) {
      throw new Error(`task ${snap.status} before approval: ${snap.body}`);
    }
    await new Promise(r => setTimeout(r, 1500));
  }
  await dumpPanel(panel, 'approval-timeout');
  throw new Error('timeout waiting for approval-approve');
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
      })),
      evidence: task?.rounds?.[0]?.evidence?.slice(-4),
      waitReason: task?.rounds?.[0]?.waitReason,
      receipt: Boolean(task?.rounds?.[0]?.receipt),
    }));
    return { taskCount: tasks.length, tasks, keys: Object.keys(all).slice(0, 40) };
  });
  console.log(`[e2e] ${label}`, JSON.stringify(info).slice(0, 3000));
  return info;
}

async function waitCompleted(panel, target, expectedCount) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status'),
      receipt: document.querySelector('[data-testid="completion-receipt"]')?.textContent || null,
      body: (document.body?.innerText || '').slice(0, 400),
    }));
    const formText = await target.evaluate(() => document.body.innerText);
    const count = Number(await (await fetch(`${origin}/count`)).text());
    console.log(`[e2e] poll status=${snap.status} count=${count} form=${JSON.stringify(formText.slice(0, 40))}`);
    if (snap.status === 'completed' && snap.receipt) {
      assert.equal(count, expectedCount, `submission count expected ${expectedCount}`);
      return snap;
    }
    if (['failed', 'cancelled'].includes(snap.status)) {
      throw new Error(`task ${snap.status}: ${snap.body}`);
    }
    // Mid-run diagnostic once form is already saved but task still running.
    if (count >= expectedCount && snap.status === 'running' && Date.now() - start > 8_000 && Date.now() - start < 12_000) {
      await dumpTaskStorage(panel, 'post-submit-still-running');
    }
    await new Promise(r => setTimeout(r, 2500));
  }
  await dumpPanel(panel, 'completed-timeout');
  await dumpTaskStorage(panel, 'completed-timeout-storage');
  throw new Error('timeout waiting for completed');
}

async function runAllScenarios(extensionId, run) {
  submissions = 0;
  const target = await browser.newPage();
  await target.goto(`${origin}/form?run=${run}`, { waitUntil: 'domcontentloaded' });
  let panel = await openPanelForTarget(extensionId, target, { seed: true });
  await sendGoal(
    panel,
    target,
    'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.',
  );
  await dumpPanel(panel, `run${run}-after-send`);

  const beforeApprove = await waitForApproval(panel, target);
  if (beforeApprove.hasApprove) {
    assert.equal(Number(await (await fetch(`${origin}/count`)).text()), 0);
    await target.bringToFront();
    await click(panel, 'approval-approve');
  }
  await waitCompleted(panel, target, 1);
  await waitForTestId(panel, 'completion-receipt');
  console.log(`[e2e] run${run} form PASS`);

  const beforeReconnect = await panel.$eval(
    '[data-testid="completion-receipt"]',
    element => element.textContent,
  );
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
  await target.goto(`${origin}/form?order=reversed&run=${run}`, { waitUntil: 'domcontentloaded' });
  await target.bringToFront();
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await waitForTestId(panel, 'skill-run');
  await target.bringToFront();
  await click(panel, 'skill-run');
  await setValue(panel, 'skill-input-name', 'FIELD_SENTINEL_CHANGED_9521');
  await target.bringToFront();
  await click(panel, 'skill-run-confirm');
  await waitCompleted(panel, target, 2);
  await waitForTestId(panel, 'completion-receipt');
  console.log(`[e2e] run${run} skill PASS`);

  const media = await browser.newPage();
  await media.goto(`${origin}/media?run=${run}`, { waitUntil: 'domcontentloaded' });
  const mediaPanel = await openPanelForTarget(extensionId, media);
  await sendGoal(mediaPanel, media, 'Play the visible audio.');
  await waitStatus(mediaPanel, 'completed');
  await sendGoal(mediaPanel, media, '暂停这个音频');
  await waitStatus(mediaPanel, 'completed');
  assert.equal(await media.$eval('#fixture-audio', element => element.paused), true);
  console.log(`[e2e] run${run} media PASS`);

  const stored = await panel.evaluate(() => chrome.storage.local.get(null));
  const nonChat = Object.fromEntries(Object.entries(stored).filter(([key]) => !key.startsWith('chat_messages_')));
  assert(!Object.keys(stored).some(key => key.startsWith('chat_agent_step_')));
  assert(!JSON.stringify(nonChat).includes('FIELD_SENTINEL_8472'));
  assert(!JSON.stringify(nonChat).includes('FIELD_SENTINEL_CHANGED_9521'));
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
    console.log('[e2e] connect mode', connectUrl);
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
