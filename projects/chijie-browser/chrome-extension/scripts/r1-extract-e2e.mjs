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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, launch } from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-r1-e2e-${process.pid}`);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 120_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const forceReset = process.env.FORCE_RESET === '1';
const isConnectMode = Boolean(connectUrl);
const reportDir =
  process.env.R1_REPORT_DIR ||
  path.resolve(__dirname, '../../../../reports/nanobrowser/claw-30/R1');

const GOAL = 'Extract products to a CSV table with name, price, rating';

let browser;
let ownsBrowser = false;

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

async function dumpPanel(panel, label) {
  const info = await panel.evaluate(() => ({
    status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
    testids: [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid')),
    body: (document.body?.innerText || '').slice(0, 800),
  }));
  console.log(`[r1-e2e] ${label}`, JSON.stringify(info));
  return info;
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

/**
 * Accept CSV header + ≥5 product data rows from panel body, deliverable slot, or task storage.
 */
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

async function readTaskDeliverable(panel) {
  return panel.evaluate(async () => {
    const all = await chrome.storage.local.get(['task-runtime-v1']);
    const runtime = all['task-runtime-v1'] || {};
    const tasks = Object.values(runtime).filter(Boolean);
    const ranked = tasks
      .map(task => {
        const rounds = task.rounds || [];
        const last = rounds[rounds.length - 1];
        return {
          taskId: task.id,
          status: task.status,
          instructionSummary: last?.instructionSummary || task.goalSummary || '',
          receiptId: last?.receipt?.id || null,
          updatedAt: task.updatedAt || last?.receipt?.verifiedAt || 0,
        };
      })
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return ranked[0] || null;
  });
}

async function waitExtractCompleted(panel) {
  const start = Date.now();
  let seenRunning = false;
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => {
      const status = document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status');
      const body = document.body?.innerText || '';
      const deliverable =
        document.querySelector('[data-testid="completion-deliverable"]')?.textContent ||
        document.querySelector('[data-testid="completion-deliverable-copy"]')?.textContent ||
        '';
      const result = document.querySelector('[data-testid="completion-result"]')?.textContent || '';
      const receipt = document.querySelector('[data-testid="completion-receipt"]')?.textContent || '';
      return { status, body, deliverable, result, receipt };
    });
    if (snap.status === 'running' || snap.status === 'waiting_approval' || snap.status === 'waiting_user') {
      seenRunning = true;
    }

    const combined = [snap.deliverable, snap.result, snap.receipt, snap.body].filter(Boolean).join('\n');
    const scored = scoreCsvText(combined);
    const fromStorage = await readTaskDeliverable(panel);
    const storageScored = scoreCsvText(fromStorage?.instructionSummary || '');

    if ((Date.now() - start) % 8000 < 1600) {
      console.log(
        `[r1-e2e] poll status=${snap.status} header=${scored.hasHeader || storageScored.hasHeader} rows=${Math.max(scored.dataRows, storageScored.dataRows)} seenRunning=${seenRunning}`,
      );
    }

    if (['failed', 'cancelled'].includes(snap.status) && seenRunning) {
      await dumpPanel(panel, `task-${snap.status}`);
      throw new Error(`task ${snap.status}: ${snap.body.slice(0, 300)}`);
    }

    if (snap.status === 'completed' && (scored.ok || storageScored.ok)) {
      return {
        status: snap.status,
        scored: scored.ok ? scored : storageScored,
        deliverable: snap.deliverable || fromStorage?.instructionSummary || '',
        bodySlice: snap.body.slice(0, 600),
        storage: fromStorage,
      };
    }

    // Completed without CSV — hard fail once we have seen a run.
    if (snap.status === 'completed' && seenRunning && !scored.ok && !storageScored.ok) {
      await dumpPanel(panel, 'completed-without-csv');
      throw new Error(
        `completed but CSV missing (header=${scored.hasHeader} rows=${scored.dataRows} storageRows=${storageScored.dataRows})`,
      );
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
  const logPath = path.join(reportDir, 'e2e-r1-extract.log');
  writeFileSync(logPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log('[r1-e2e] report=', logPath);
  return logPath;
}

try {
  assert(existsSync(path.join(extensionPath, 'manifest.json')), `missing extension dist at ${extensionPath}`);
  console.log('[r1-e2e] extensionPath=', extensionPath);
  console.log('[r1-e2e] origin=', origin);
  console.log('[r1-e2e] hasMiniMaxKey=', Boolean(resolveMiniMaxApiKey()));

  if (connectUrl) {
    console.log('[r1-e2e] connect mode', connectUrl);
    browser = await connect({ browserURL: connectUrl, defaultViewport: null });
    ownsBrowser = false;
  } else {
    console.log('[r1-e2e] chromePath=', chromePath);
    browser = await launch({
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

  const panel = await openPanelForTarget(extensionId, target, { seed: true });
  await resetExtensionState(panel);
  await seedMiniMax(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(r => setTimeout(r, 500));

  await sendGoal(panel, target, GOAL);
  await dumpPanel(panel, 'after-send');

  const result = await waitExtractCompleted(panel);
  console.log(
    `[r1-e2e] PASS status=${result.status} header=${result.scored.hasHeader} dataRows=${result.scored.dataRows}`,
  );

  const reportPath = writeReport({
    status: 'pass',
    goal: GOAL,
    origin,
    productCount,
    scored: result.scored,
    deliverableSlice: (result.deliverable || '').slice(0, 800),
    storageStatus: result.storage?.status || null,
    at: new Date().toISOString(),
  });

  console.log(`r1-extract-e2e PASS report=${reportPath}`);
} catch (error) {
  console.error('[r1-e2e] FAIL', error);
  try {
    writeReport({
      status: 'fail',
      goal: GOAL,
      error: String(error?.stack || error),
      at: new Date().toISOString(),
    });
  } catch {
    /* ignore report write failure */
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
