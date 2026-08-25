/**
 * A/B: drive 持节 like a user, compare isolated Chrome for Testing vs a
 * CDP-connected daily Chrome. Never dumps page URLs. Connected arm never
 * clicks 执行 (would operate the owner's live tabs).
 *
 *   node chrome-extension/scripts/confirm-execute-ab.mjs
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, launch } from 'puppeteer-core';
import { resolveChromeForEval, seedEvalLlm } from './lib/eval-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const evidenceDir = path.join(os.tmpdir(), `chijie-ab-${process.pid}`);
const timeout = 45_000;
const connectUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';

mkdirSync(evidenceDir, { recursive: true });

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function listenFixture() {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end('<!doctype html><title>ab-fixture</title><p>ab-fixture</p>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

async function snapshot(panel, extra = {}) {
  return panel.evaluate(async extraIn => {
    const statusEl = document.querySelector('[data-testid="task-status"]');
    const stored = await chrome.storage.local.get(['task-runtime-v1']);
    const tasks = Object.values(stored['task-runtime-v1'] || {}).filter(Boolean);
    let debuggerAttached = -1;
    try {
      const targets = await chrome.debugger.getTargets();
      const id = chrome.runtime.id;
      debuggerAttached = targets.filter(target => target.attached && target.extensionId === id).length;
    } catch {
      debuggerAttached = -2;
    }
    return {
      ...extraIn,
      hasGoalInput: Boolean(document.querySelector('[data-testid="goal-input"]')),
      hasSend: Boolean(document.querySelector('[data-testid="goal-send"]')),
      firstRun: /连接模型|First run|API/.test(document.body?.innerText || ''),
      taskStatus: statusEl?.getAttribute('data-status') || null,
      waitAskLabels: [...document.querySelectorAll('[data-testid="wait-ask-option"]')].map(el =>
        (el.textContent || '').trim(),
      ),
      waitAskPrompt: (document.querySelector('[data-testid="task-failure-reason"]')?.textContent || '').trim().slice(0, 80),
      body: (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 280),
      taskCount: tasks.length,
      taskStatuses: tasks.map(task => task.status),
      waitReasons: tasks.flatMap(task => (task.rounds || []).map(round => round.waitReason).filter(Boolean)),
      debuggerAttached,
    };
  }, extra);
}

async function typeAndSend(panel, text) {
  await panel.waitForSelector('[data-testid="goal-input"]', { timeout });
  await panel.evaluate(value => {
    const el = document.querySelector('[data-testid="goal-input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
    setter ? setter.call(el, value) : (el.value = value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, text);
  await panel.evaluate(() => document.querySelector('[data-testid="goal-send"]')?.click());
}

async function clickOption(panel, label) {
  return panel.evaluate(want => {
    const button = [...document.querySelectorAll('[data-testid="wait-ask-option"]')].find(
      el => (el.textContent || '').trim() === want,
    );
    if (!button) return false;
    button.click();
    return true;
  }, label);
}

async function resolveExtensionId(browser) {
  if (process.env.EXTENSION_ID) return process.env.EXTENSION_ID;
  await browser.waitForTarget(
    target => target.type() === 'service_worker' && target.url().startsWith('chrome-extension://'),
    { timeout: 20_000 },
  ).catch(() => undefined);
  const hosts = new Set();
  for (const target of browser.targets()) {
    const url = target.url();
    if (!url.startsWith('chrome-extension://')) continue;
    try {
      hosts.add(new URL(url).host);
    } catch {
      // skip
    }
  }
  for (const host of hosts) {
    const page = await browser.newPage();
    try {
      const response = await page.goto(`chrome-extension://${host}/side-panel/index.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 8_000,
      });
      const okStatus = response && !String(response.status() || '').startsWith('4');
      const okBody = await page.evaluate(() =>
        Boolean(document.querySelector('[data-testid="goal-input"]') || /持节/.test(document.body?.innerText || '')),
      );
      if (okStatus || okBody) return host;
    } catch {
      // try next extension
    } finally {
      await page.close().catch(() => undefined);
    }
  }
  const worker = await browser.waitForTarget(
    target =>
      target.type() === 'service_worker' &&
      target.url().startsWith('chrome-extension://') &&
      target.url().includes('background'),
    { timeout: 20_000 },
  );
  return new URL(worker.url()).host;
}

async function openPanel(browser, extensionId, { seed = false } = {}) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
    timeout,
  });
  if (seed) {
    try {
      await seedEvalLlm(panel);
      await panel.reload({ waitUntil: 'domcontentloaded' });
    } catch (error) {
      return { panel, seedError: String(error.message || error).slice(0, 180) };
    }
  }
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const ready = await panel.evaluate(() => Boolean(document.querySelector('[data-testid="goal-input"]')));
    if (ready) break;
    await sleep(400);
  }
  return { panel, seedError: '' };
}

async function runIsolated(origin) {
  const chromePath = resolveChromeForEval();
  const profilePath = path.join(os.tmpdir(), `scion-ab-isolated-${process.pid}`);
  const browser = await launch({
    executablePath: chromePath,
    headless: true,
    userDataDir: profilePath,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
  const notes = [];
  try {
    const extensionId = await resolveExtensionId(browser);
    const page = await browser.newPage();
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const opened = await openPanel(browser, extensionId, { seed: true });
    const panel = opened.panel;
    if (opened.seedError) notes.push(`seed: ${opened.seedError}`);
    const before = await snapshot(panel, { step: 'isolated-open' });
    await typeAndSend(panel, '你好');
    await sleep(2500);
    const afterHello = await snapshot(panel, { step: 'isolated-hello' });
    await typeAndSend(panel, `打开 ${origin}/`);
    await sleep(2500);
    const afterOpen = await snapshot(panel, { step: 'isolated-open-url' });
    const clickedChat = await clickOption(panel, '仅聊天');
    await sleep(1500);
    const afterChat = await snapshot(panel, { step: 'isolated-chat' });
    await typeAndSend(panel, `打开 ${origin}/`);
    await sleep(2500);
    const beforeGo = await snapshot(panel, { step: 'isolated-before-go' });
    const clickedGo = await clickOption(panel, '执行');
    await sleep(2500);
    const afterGo = await snapshot(panel, { step: 'isolated-go' });
    return {
      arm: 'isolated',
      ok: true,
      chrome: chromePath.split('/').slice(-3).join('/'),
      extensionId,
      notes,
      clickedChat,
      clickedGo,
      steps: [before, afterHello, afterOpen, afterChat, beforeGo, afterGo],
    };
  } catch (error) {
    return { arm: 'isolated', ok: false, error: String(error.message || error).slice(0, 400), notes };
  } finally {
    await browser.close().catch(() => undefined);
  }
}

async function runConnected() {
  let browser;
  try {
    browser = await connect({ browserURL: connectUrl, defaultViewport: null });
  } catch (error) {
    return { arm: 'connected', ok: false, error: `connect failed: ${String(error.message || error).slice(0, 200)}` };
  }
  const notes = ['connected: greeting only; never click 执行'];
  try {
    const pagesBefore = (await browser.pages()).length;
    const extensionId = await resolveExtensionId(browser);
    const opened = await openPanel(browser, extensionId, { seed: false });
    const panel = opened.panel;
    const before = await snapshot(panel, { step: 'connected-open', pagesBefore });
    if (!before.hasGoalInput) {
      notes.push('composer missing — this Chrome may be on first-run or a different extension build');
    } else {
      await typeAndSend(panel, '你好');
      await sleep(2500);
    }
    const afterHello = await snapshot(panel, { step: 'connected-hello' });
    await panel.close().catch(() => undefined);
    return {
      arm: 'connected',
      ok: true,
      extensionId,
      notes,
      pagesBefore,
      steps: [before, afterHello],
    };
  } catch (error) {
    return { arm: 'connected', ok: false, error: String(error.message || error).slice(0, 400), notes };
  } finally {
    // Disconnect only — do not close the owner's Chrome.
    browser?.disconnect?.();
  }
}

function score(arm) {
  if (!arm?.ok) return { useful: 0, why: arm?.error || 'failed' };
  const steps = arm.steps || [];
  const hello = steps.find(step => String(step.step).endsWith('hello'));
  const open = steps.find(step => step.step === 'isolated-open-url');
  const go = steps.find(step => step.step === 'isolated-go');
  const bits = [];
  if (hello?.hasGoalInput) bits.push('composer');
  if (hello && hello.debuggerAttached === 0) bits.push('hello-no-debugger');
  if (hello?.body) bits.push('hello-text');
  if (open?.waitAskLabels?.includes('执行')) bits.push('confirm-chips');
  if (open && open.debuggerAttached === 0) bits.push('ask-no-debugger');
  if (go && go.debuggerAttached > 0) bits.push('go-attached');
  if (arm.arm === 'connected') bits.push('live-profile');
  return { useful: bits.length, bits };
}

assertDist();
function assertDist() {
  if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error(`missing dist at ${extensionPath}`);
  }
}

const { server, origin } = await listenFixture();
let isolated;
let connected;
try {
  isolated = await runIsolated(origin);
  connected = await runConnected();
} finally {
  await new Promise(resolve => server.close(resolve));
}

const report = {
  evidenceDir,
  isolated: { ...isolated, score: score(isolated) },
  connected: { ...connected, score: score(connected) },
};
const outPath = path.join(evidenceDir, 'ab.json');
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`wrote ${outPath}`);
