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
import { resolveModel, seedEvalLlm } from './lib/eval-provider.mjs';

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
const model = resolveModel();
/** When set, dump chrome.storage eval-traces-v1 JSON after the run (Trace Gate evidence). */
const traceDumpDir = process.env.TRACE_DUMP_DIR || '';

let browser;
let ownsBrowser = false;
let fixtureServer;
/** Panel page kept for optional post-run storage dump. */
let panelPage;

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    path.join(
      os.homedir(),
      'Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    path.join(
      os.homedir(),
      'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates.at(-1);
}

/** Inject eval LLM (default MiniMax; optional PROVIDER=custom_openai for Grok etc.). */
async function seedMiniMax(panel) {
  await seedEvalLlm(panel);
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
  while (Date.now() - start < timeout) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
      receipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      body: document.body?.innerText || '',
    }));
    if ((Date.now() - start) % 10_000 < 1200) {
      console.log(`[public-task] wait status=${snap.status} url=${target.url()}`);
    }
    if (snap.status === 'running' || snap.status === 'waiting_user') {
      seenRunning = true;
    }
    if (snap.status === 'waiting_user') {
      throw new Error(`login_wall: ${snap.body.slice(0, 200)}`);
    }
    if (snap.status === 'completed') {
      return snap;
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

async function verifyResult(target, panel) {
  const url = target.url();
  const body = panel.body || '';
  switch (verify) {
    case 'url_starts_with':
      return url.startsWith(expected);
    case 'url_contains':
      return url.includes(expected);
    case 'host_equals': {
      try {
        return new URL(url).host === expected;
      } catch {
        return false;
      }
    }
    case 'body_contains':
      return body.includes(expected);
    case 'answer_contains':
      return body.includes(expected);
    case 'body_contains_all': {
      // EXPECTED = "part_a||part_b||..." — every part must appear in panel body.
      const parts = String(expected || '')
        .split('||')
        .map(part => part.trim())
        .filter(Boolean);
      if (parts.length === 0) return false;
      return parts.every(part => body.includes(part));
    }
    case 'page_text':
      // Target page DOM text (not side-panel answer). Good for multi-phase nav + extract.
      return pageTextContains(target, expected);
    case 'url_and_page_text': {
      // EXPECTED = "url_substr||page_text_substr"
      const { left: urlPart, right: textPart } = splitExpectedPair(expected);
      if (!urlPart || !textPart) return false;
      if (!url.includes(urlPart)) return false;
      return pageTextContains(target, textPart);
    }
    case 'url_and_body': {
      // EXPECTED = "url_substr||panel_answer_substr" — nav + deliverable both required.
      const { left: urlPart, right: answerPart } = splitExpectedPair(expected);
      if (!urlPart || !answerPart) return false;
      return url.includes(urlPart) && body.includes(answerPart);
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
  console.log('[public-task] browser launched');

  const extensionId = await resolveExtensionId();
  console.log('[public-task] extensionId=', extensionId);
  const target = await browser.newPage();
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
  console.log('[public-task] target=', target.url());
  const panel = await openPanelForTarget(extensionId, target);
  panelPage = panel;
  console.log('[public-task] panel ready');
  const startedAt = Date.now();
  await sendGoal(panel, target);
  await new Promise(resolve => setTimeout(resolve, 500));
  const result = await waitCompleted(panel, target);
  if (process.env.EXPECT_FAILURE === '1') {
    if (!result.expectedFailure || !['failed', 'cancelled'].includes(result.status)) {
      throw new Error(`expected negative failure but status=${result.status}`);
    }
    console.log(
      `matrix_row ${JSON.stringify({
        task_id: taskId,
        attempt: 1,
        model,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        outcome: 'verified_pass',
        false_complete: 0,
        wrong_tab: 0,
        unapproved_commit: 0,
        latency_ms: Date.now() - startedAt,
        failure_class: 'expected_failure',
        notes: `negative task failed honestly: ${(result.body || '').slice(0, 160)}`,
      })}`,
    );
    console.log(`[public-task] PASS negative ${taskId}`);
  } else {
    const ok = await verifyResult(target, { ...result, body: result.body });
    if (!ok) {
      // Agent claimed completed but evidence failed → false_complete for matrix.
      const latencyMs = Date.now() - startedAt;
      console.log(
        `matrix_row ${JSON.stringify({
          task_id: taskId,
          attempt: 1,
          model,
          prompt_version: promptVersion,
          policy_tag: policyTag,
          outcome: 'fail',
          false_complete: 1,
          wrong_tab: 0,
          unapproved_commit: 0,
          latency_ms: latencyMs,
          failure_class: 'verify_fail',
          notes: `false_complete verify=${verify} expected=${expected} url=${target.url()}`,
        })}`,
      );
      throw new Error(`verification failed verify=${verify} expected=${expected} url=${target.url()}`);
    }
    console.log(
      `matrix_row ${JSON.stringify({
        task_id: taskId,
        attempt: 1,
        model,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        outcome: 'verified_pass',
        false_complete: 0,
        wrong_tab: 0,
        unapproved_commit: 0,
        latency_ms: Date.now() - startedAt,
        failure_class: '',
        notes: `url=${target.url()}`,
      })}`,
    );
    console.log(`[public-task] PASS ${taskId} url=${target.url()}`);
  }
} catch (error) {
  console.error(`[public-task] FAIL ${taskId}`, error);
  // Avoid double matrix_row when verify already emitted false_complete=1.
  if (!/verification failed/i.test(String(error?.message || error))) {
    const failureClass = /login_wall/i.test(String(error?.message || error)) ? 'login_wall' : 'other';
    console.log(
      `matrix_row ${JSON.stringify({
        task_id: taskId,
        attempt: 1,
        model,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        outcome: 'fail',
        false_complete: 0,
        wrong_tab: 0,
        unapproved_commit: 0,
        latency_ms: 0,
        failure_class: failureClass,
        notes: String(error?.message || error)
          .replace(/\s+/g, ' ')
          .slice(0, 240),
      })}`,
    );
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
      const outPath = path.join(traceDumpDir, `${taskId}-${Date.now()}.json`);
      writeFileSync(outPath, JSON.stringify(traces, null, 2));
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
