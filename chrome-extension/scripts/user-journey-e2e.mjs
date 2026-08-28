/**
 * L3 user-journey probe: load unpacked dist, type in the side panel, assert
 * what a person would see. Does not attach a second debugger to the content tab.
 *
 *   CHROME_PATH=… pnpm build && node chrome-extension/scripts/user-journey-e2e.mjs
 *
 * Scenes are generic. Failures print as findings; process exits 1 if any fail.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'puppeteer-core';
import { hasEvalApiKey, resolveChromeForEval, seedEvalLlm } from './lib/eval-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-journey-${process.pid}`);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 90_000);
const chromePath = resolveChromeForEval();

const findings = [];
const note = (id, ok, detail) => {
  findings.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
};

const articleHtml = `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>夹具文章</title></head>
<body><h1>夹具文章</h1><p>这篇短文只存在于本地夹具。主题是候鸟迁徙，没有登录墙。</p></body></html>`;

const goneHtml = `<!doctype html><html><head><title>404 Not Found</title></head>
<body>This page isn't available</body></html>`;

const formHtml = readFileSync(path.resolve(__dirname, '../test/fixtures/form.html'), 'utf8');

const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/submit') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    return response.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/gone') {
    response.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(goneHtml);
  }
  if (url.pathname === '/form') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end(formHtml);
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(articleHtml);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function resolveExtensionId(browser) {
  const workerFileName = JSON.parse(readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'))
    ?.background?.service_worker;
  const worker = await browser.waitForTarget(
    target =>
      target.type() === 'service_worker' &&
      target.url().startsWith('chrome-extension://') &&
      (!workerFileName || target.url().endsWith(workerFileName)),
    { timeout: 30_000 },
  );
  return new URL(worker.url()).host;
}

async function setValue(page, testId, value) {
  await page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
  await page.evaluate(
    (tid, next) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) throw new Error(`missing ${tid}`);
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc?.set?.call(el, next);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    testId,
    value,
  );
}

async function snapshot(panel) {
  return panel.evaluate(() => {
    const log = document.querySelector('[data-testid="sidepanel-chat-log"]');
    const status = document.querySelector('[data-testid="task-status"]');
    const receipt = document.querySelector('[data-testid="completion-receipt"]');
    const input = document.querySelector('[data-testid="goal-input"]');
    const testids = [...document.querySelectorAll('[data-testid]')].map(el => el.getAttribute('data-testid'));
    return {
      hasGoalInput: Boolean(input),
      inputDisabled: input ? input.disabled || input.getAttribute('disabled') !== null : null,
      taskStatus: status?.getAttribute('data-status') || null,
      chatCollapsed: log?.getAttribute('data-collapsed') || null,
      taskVisible: log?.getAttribute('data-task-visible') || null,
      chatLogText: (log?.innerText || '').slice(0, 1500),
      bodyText: (document.body?.innerText || '').slice(0, 1500),
      hasReceipt: Boolean(receipt),
      receiptText: (receipt?.innerText || '').slice(0, 400),
      testids,
    };
  });
}

/** Only count chrome.debugger attachments owned by this extension, not Puppeteer's. */
async function extensionAttachedContent(panel, origin) {
  return panel.evaluate(async originIn => {
    try {
      const id = chrome.runtime.id;
      const targets = await chrome.debugger.getTargets();
      return (targets || []).filter(
        target =>
          target.attached &&
          target.extensionId === id &&
          typeof target.tabId === 'number' &&
          typeof target.url === 'string' &&
          target.url.startsWith(originIn),
      );
    } catch {
      return [];
    }
  }, origin);
}

async function send(panel, text) {
  await setValue(panel, 'goal-input', text);
  const sendBtn = await panel.$('[data-testid="goal-send"]');
  if (sendBtn) await sendBtn.click();
  else await panel.keyboard.press('Enter');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const taskBusy = snap => snap.taskStatus === 'running' || snap.taskStatus === 'paused';

async function waitUntilComposerReady(panel, ms = 45_000) {
  const deadline = Date.now() + ms;
  let snap = await snapshot(panel);
  while (Date.now() < deadline) {
    snap = await snapshot(panel);
    if (snap.hasGoalInput && snap.inputDisabled === false) return snap;
    await sleep(300);
  }
  return snap;
}

async function waitForChatText(panel, needle, ms = 45_000) {
  const deadline = Date.now() + ms;
  let snap = await snapshot(panel);
  while (Date.now() < deadline) {
    snap = await snapshot(panel);
    if ((snap.chatLogText || '').includes(needle) || (snap.bodyText || '').includes(needle)) return snap;
    await sleep(300);
  }
  return snap;
}

/** Only the fixture form page counts — never the side panel, which may quote the instruction. */
async function pageShowsSaved(browser, origin) {
  for (const page of await browser.pages()) {
    let url = '';
    try {
      url = page.url();
    } catch {
      continue;
    }
    if (!url.startsWith(origin)) continue;
    try {
      const saved = await page.$('#saved');
      if (!saved) continue;
      const text = await page.evaluate(el => (el.textContent || '').trim(), saved);
      if (text.includes('Saved successfully')) return { url, text };
    } catch {
      // Closed, crashing, or non-HTML page.
    }
  }
  return null;
}

async function formPageState(page) {
  try {
    return await page.evaluate(() => ({
      url: location.href,
      hasSaved: Boolean(document.querySelector('#saved')),
      hasName: Boolean(document.querySelector('#name')),
      nameValue: document.querySelector('#name')?.value || '',
      body: (document.body?.innerText || '').slice(0, 240),
    }));
  } catch (error) {
    return { error: String(error) };
  }
}

async function allowOrigin(panel, host) {
  await panel.evaluate(async allowed => {
    const current = (await chrome.storage.local.get(['firewall-settings']))['firewall-settings'] || {};
    const hosts = new Set([...(current.allowedHosts || []), ...allowed]);
    await chrome.storage.local.set({
      'firewall-settings': { ...current, allowedHosts: [...hosts] },
    });
  }, [host]);
}

mkdirSync(profilePath, { recursive: true });

if (!existsSync(path.join(extensionPath, 'manifest.json'))) {
  throw new Error(`missing dist at ${extensionPath}; run pnpm build`);
}
if (!hasEvalApiKey()) {
  throw new Error('no eval API key; inject personal secrets or set EVAL_API_KEY');
}

const browser = await launch({
  executablePath: chromePath,
  headless: process.env.HEADLESS !== 'false',
  userDataDir: profilePath,
  protocolTimeout: 180_000,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
  ],
});

let failed = 0;
try {
  const extensionId = await resolveExtensionId(browser);
  console.log('[journey] extensionId=', extensionId, 'origin=', origin);

  const content = await browser.newPage();
  await content.goto(origin, { waitUntil: 'domcontentloaded' });

  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await seedEvalLlm(panel);
  await allowOrigin(panel, '127.0.0.1');
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await panel.waitForSelector('[data-testid="goal-input"]', { timeout });
  await content.bringToFront();
  await sleep(600);

  // Scene 1 — chat. Panel is a tab (not true sidePanel); send from the panel.
  await panel.bringToFront();
  const chatBefore = await snapshot(panel);
  await send(panel, '你好');
  let chatSnap = await waitForChatText(panel, '你好', 15_000);
  const chatDeadline = Date.now() + 45_000;
  while (Date.now() < chatDeadline) {
    chatSnap = await snapshot(panel);
    const grew = (chatSnap.chatLogText || '').length > (chatBefore.chatLogText || '').length + 8;
    if (chatSnap.taskStatus === 'running' || grew) break;
    await sleep(400);
  }
  chatSnap = await waitUntilComposerReady(panel);
  note(
    'chat-no-task-card',
    chatSnap.taskStatus !== 'running' && chatSnap.taskVisible !== 'true',
    `status=${chatSnap.taskStatus} taskVisible=${chatSnap.taskVisible} collapsed=${chatSnap.chatCollapsed}`,
  );
  note(
    'chat-has-goal-input',
    chatSnap.hasGoalInput,
    `hasGoalInput=${chatSnap.hasGoalInput}`,
  );
  const attachedContent = await extensionAttachedContent(panel, origin);
  note(
    'chat-no-debugger-on-content',
    attachedContent.length === 0,
    `attachedContent=${JSON.stringify(attachedContent.map(t => t.url))}`,
  );

  // Scene 2 — ask about the current page (must stay a question, not a hardcoded recipe).
  await panel.bringToFront();
  await waitUntilComposerReady(panel);
  await send(panel, '这一页讲什么');
  await content.bringToFront();
  let pageSnap = await waitForChatText(panel, '这一页讲什么', 20_000);
  const pageDeadline = Date.now() + 60_000;
  while (Date.now() < pageDeadline) {
    pageSnap = await snapshot(panel);
    if (pageSnap.taskStatus === 'running' || pageSnap.taskVisible === 'true' || pageSnap.hasReceipt) break;
    if ((pageSnap.chatLogText || '').includes('候鸟') || (pageSnap.bodyText || '').includes('候鸟')) break;
    await sleep(500);
  }
  const userSentenceVisible =
    (pageSnap.chatLogText || '').includes('这一页讲什么') || (pageSnap.bodyText || '').includes('这一页讲什么');
  note(
    'current-page-user-sentence-visible',
    userSentenceVisible,
    `collapsed=${pageSnap.chatCollapsed} taskVisible=${pageSnap.taskVisible} status=${pageSnap.taskStatus} log=${JSON.stringify(pageSnap.chatLogText.slice(0, 200))}`,
  );
  note(
    'current-page-not-only-task-card',
    !(pageSnap.taskVisible === 'true' && !userSentenceVisible),
    `taskVisible=${pageSnap.taskVisible} userVisible=${userSentenceVisible} status=${pageSnap.taskStatus}`,
  );
  const dumpedTree = /Clicked|html\s*>|\[12\]|Planner:/.test(pageSnap.chatLogText + pageSnap.bodyText);
  note('current-page-no-worker-log-in-chat', !dumpedTree, dumpedTree ? 'worker log leaked into main surface' : 'ok');

  // Scene 3 — operate the already-open form. Hard bar: the page itself changes.
  await content.goto(`${origin}/form`, { waitUntil: 'domcontentloaded' });
  await panel.bringToFront();
  await waitUntilComposerReady(panel);
  const formInstruction = 'Fill Name with FIELD_SENTINEL_8472 and submit; success is Saved successfully.';
  await send(panel, formInstruction);
  await content.bringToFront();
  const formDeadline = Date.now() + 180_000;
  let formSaved = null;
  let formSnap = await snapshot(panel);
  while (Date.now() < formDeadline) {
    formSaved = await pageShowsSaved(browser, origin);
    formSnap = await snapshot(panel);
    if (formSaved) break;
    await sleep(500);
  }
  const formDom = await formPageState(content);
  note(
    'form-page-saved-successfully',
    Boolean(formSaved),
    formSaved
      ? `url=${formSaved.url} status=${formSnap.taskStatus}`
      : `status=${formSnap.taskStatus} page=${JSON.stringify(formDom)} log=${JSON.stringify((formSnap.chatLogText || '').slice(0, 360))}`,
  );
  const formUserVisible =
    (formSnap.chatLogText || '').includes(formInstruction) ||
    (formSnap.chatLogText || '').includes('FIELD_SENTINEL_8472') ||
    (formSnap.bodyText || '').includes('FIELD_SENTINEL_8472');
  note(
    'form-user-sentence-visible',
    formUserVisible,
    `taskVisible=${formSnap.taskVisible} userVisible=${formUserVisible}`,
  );
  if (formSaved) {
    const settleDeadline = Date.now() + 90_000;
    while (Date.now() < settleDeadline) {
      formSnap = await snapshot(panel);
      if (!taskBusy(formSnap)) break;
      await sleep(400);
    }
  }
  const formStillOpen = taskBusy(formSnap);
  note(
    'form-task-reached-a-stop',
    Boolean(formSaved) && !formStillOpen,
    formStillOpen
      ? `pageSaved=${Boolean(formSaved)} still ${formSnap.taskStatus}`
      : `pageSaved=${Boolean(formSaved)} status=${formSnap.taskStatus}`,
  );
  await waitUntilComposerReady(panel, 45_000);

  // Scene 4 — 404 fixture must not complete as “address matched”.
  try {
    await content.goto(`${origin}/gone`, { waitUntil: 'domcontentloaded' });
    await panel.bringToFront();
    await waitUntilComposerReady(panel);
    const beforeGone = await snapshot(panel);
    await send(panel, '打开这个并完成');
    await content.bringToFront();
    const goneDeadline = Date.now() + 60_000;
    let goneSnap = await snapshot(panel);
    let sawFreshTask = false;
    while (Date.now() < goneDeadline) {
      goneSnap = await snapshot(panel);
      if (taskBusy(goneSnap)) sawFreshTask = true;
      const ended = goneSnap.taskStatus === 'completed' || goneSnap.taskStatus === 'failed' || goneSnap.hasReceipt;
      if (sawFreshTask && ended && goneSnap.taskStatus !== beforeGone.taskStatus) break;
      await sleep(500);
    }
    const claimedOk =
      sawFreshTask &&
      (goneSnap.taskStatus === 'completed' || /地址已符合|已完成/.test(goneSnap.receiptText + goneSnap.bodyText));
    const stillOpen = taskBusy(goneSnap);
    note(
      '404-not-marked-complete',
      !claimedOk,
      `started=${sawFreshTask} status=${goneSnap.taskStatus} receipt=${JSON.stringify((goneSnap.receiptText || '').slice(0, 160))}`,
    );
    note(
      '404-reached-a-stop',
      !stillOpen,
      stillOpen
        ? `still ${goneSnap.taskStatus} after ${Math.round((Date.now() - (goneDeadline - 60_000)) / 1000)}s; not proven`
        : `started=${sawFreshTask} status=${goneSnap.taskStatus}`,
    );
    const goneUserVisible =
      (goneSnap.chatLogText || '').includes('打开这个并完成') || (goneSnap.bodyText || '').includes('打开这个并完成');
    note(
      'task-card-keeps-user-sentence',
      goneUserVisible || goneSnap.taskVisible !== 'true',
      `taskVisible=${goneSnap.taskVisible} userVisible=${goneUserVisible} log=${JSON.stringify((goneSnap.chatLogText || '').slice(0, 200))}`,
    );
  } catch (error) {
    note('404-not-marked-complete', false, `scene crashed: ${error instanceof Error ? error.message : String(error)}`);
    note('404-reached-a-stop', false, 'scene crashed');
    note('task-card-keeps-user-sentence', false, 'scene crashed');
  }
} catch (error) {
  failed = 1;
  console.error('[journey] crash', error);
} finally {
  await browser.close().catch(() => {});
  await new Promise(resolve => server.close(resolve));
}

const failedCount = findings.filter(f => !f.ok).length;
console.log(`[journey] ${findings.length} checks, ${failedCount} failed`);
process.exit(failed || failedCount ? 1 : 0);
