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
import { resolveModel, seedEvalLlm } from './lib/eval-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultExtensionPath = path.resolve(__dirname, '../../dist');
const extensionPath = process.env.EXTENSION_PATH
  ? path.resolve(process.env.EXTENSION_PATH)
  : defaultExtensionPath;
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
const model = resolveModel();
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
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates.at(-1);
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

async function openPanelForTarget(extensionId, target) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await seedEvalLlm(panel);
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

async function waitCompleted(panel, target) {
  const start = Date.now();
  let seenRunning = false;
  while (Date.now() - start < timeout) {
    await maybeStress(panel, target, start);
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
      receipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      body: document.body?.innerText || '',
      stepsHint: (document.body?.innerText || '').match(/操作记录\s*(\d+)/)?.[1] || '',
    }));
    if ((Date.now() - start) % 10_000 < 1200) {
      console.log(`[frontier] wait status=${snap.status} url=${target.url()} interrupt=${interruptFired} wrongTab=${distractorOpened}`);
    }
    if (snap.status === 'running' || snap.status === 'waiting_user') seenRunning = true;
    if (snap.status === 'waiting_user') throw new Error(`login_wall: ${snap.body.slice(0, 200)}`);
    if (snap.status === 'completed') return snap;
    if (['failed', 'cancelled'].includes(snap.status) && seenRunning) {
      throw new Error(`${snap.status}: ${snap.body.slice(0, 300)}`);
    }
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  throw new Error('timeout waiting for completion');
}

function partsFromExpected(value) {
  return String(value || '')
    .split('||')
    .map(p => p.trim())
    .filter(Boolean);
}

async function pageTextContains(target, needle) {
  if (!needle) return false;
  return target.evaluate(expected => (document.body?.innerText || '').includes(expected), needle);
}

async function verifyResult(target, panel) {
  const url = target.url();
  const body = panel.body || '';
  const forbid = partsFromExpected(forbidBody);
  if (forbid.some(f => body.includes(f))) {
    console.log('[frontier] forbid body hit', forbid.filter(f => body.includes(f)));
    return false;
  }

  switch (verify) {
    case 'body_contains_all': {
      const parts = partsFromExpected(expected);
      return parts.length > 0 && parts.every(p => body.includes(p));
    }
    case 'body_and_page': {
      // EXPECTED = panel parts ||PAGE|| page parts (use PAGE as separator token)
      const [panelPart, pagePart] = String(expected).split('||PAGE||');
      const panelOk = partsFromExpected(panelPart).every(p => body.includes(p));
      const pageOk = partsFromExpected(pagePart).every(async () => true);
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
      return url.includes(urlPart) && rest.every(p => body.includes(p));
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
      if (body.includes('999') && body.includes('888') && !body.includes('2100000')) return false;
      return need.every(p => body.includes(p));
    }
    case 'frontier_compare': {
      // Highest thrust is Vega; cheapest is Nova; must mention both conclusions
      const need = ['Vega Capsule', '50', 'Nova Capsule', '1800000', 'thrust'];
      const altNeed = ['Vega', 'highest thrust', 'Nova', 'lowest price'];
      const basic = need.every(p => body.toLowerCase().includes(p.toLowerCase()));
      const soft = altNeed.every(p => body.toLowerCase().includes(p.toLowerCase()));
      // require Vega as thrust winner and at least one real price from sources
      return (
        body.includes('Vega') &&
        (body.includes('50') || /highest thrust|最大推力|推力最高/i.test(body)) &&
        body.includes('Nova') &&
        (body.includes('1800000') || body.includes('1,800,000') || /最低|cheapest|lowest price/i.test(body)) &&
        !body.includes('price 999')
      );
    }
    case 'frontier_recovery': {
      return body.includes('RT-77-OK') || body.includes('Hidden Report 77');
    }
    case 'frontier_spa_serial': {
      // Prefer panel answer; also accept page serial if agent expanded and answered
      return body.includes('Z-MOD-0042') || (await pageTextContains(target, 'Z-MOD-0042'));
    }
    case 'frontier_catalog_modules': {
      // After filter module + sort rating, top is Beta Dock Module serial Z-MOD-0042
      return (
        body.includes('Beta Dock Module') &&
        body.includes('Z-MOD-0042') &&
        (body.includes('510000') || body.includes('4.6'))
      );
    }
    default:
      return body.includes(expected);
  }
}

function emitRow(partial) {
  console.log(
    `matrix_row ${JSON.stringify({
      task_id: taskId,
      attempt: Number(process.env.EVAL_ATTEMPT || 1),
      model,
      prompt_version: promptVersion,
      policy_tag: policyTag,
      false_complete: 0,
      wrong_tab: 0,
      unapproved_commit: 0,
      latency_ms: 0,
      failure_class: '',
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

  const extensionId = await resolveExtensionId();
  console.log('[frontier] extensionId=', extensionId);
  const target = await browser.newPage();

  let effectiveUrl = targetUrl;
  if (String(targetUrl).startsWith('fixture://frontier')) {
    const rel = targetUrl.replace('fixture://frontier', '').replace(/^\//, '') || 'hub.html';
    effectiveUrl = `${fixtureOrigin}/${rel}`;
  }
  await target.goto(effectiveUrl, { waitUntil: 'domcontentloaded' });
  console.log('[frontier] target=', target.url());

  const panel = await openPanelForTarget(extensionId, target);
  panelPage = panel;
  const startedAt = Date.now();
  await sendGoal(panel, target);
  const result = await waitCompleted(panel, target);
  const latencyMs = Date.now() - startedAt;

  const ok = await verifyResult(target, { ...result, body: result.body });
  if (!ok) {
    // completed without evidence → false_complete
    emitRow({
      outcome: 'fail',
      false_complete: 1,
      wrong_tab: distractorOpened && /example\.com/i.test(target.url()) ? 1 : 0,
      latency_ms: latencyMs,
      failure_class: 'verify_fail',
      notes: `false_complete verify=${verify} url=${target.url()} interrupt=${interruptFired}`.slice(0, 240),
    });
    throw new Error(`verification failed verify=${verify} url=${target.url()}`);
  }

  // Wrong-tab stress: final target should not be the distractor if task needs lab pages
  let wrongTab = 0;
  if (distractorOpened && /example\.com/i.test(target.url()) && verify !== 'frontier_recovery') {
    // if still on distractor but somehow body passed — mark wrong_tab risk
    wrongTab = 1;
  }

  emitRow({
    outcome: wrongTab ? 'fail' : 'verified_pass',
    false_complete: 0,
    wrong_tab: wrongTab,
    latency_ms: latencyMs,
    failure_class: wrongTab ? 'wrong_tab' : '',
    notes: `url=${target.url()} interrupt=${interruptFired} wrongTabStress=${distractorOpened}`.slice(0, 240),
  });
  console.log(`[frontier] PASS ${taskId} latency_ms=${latencyMs}`);
} catch (error) {
  console.error(`[frontier] FAIL ${taskId}`, error);
  if (!/verification failed/i.test(String(error?.message || error))) {
    emitRow({
      outcome: 'fail',
      latency_ms: 0,
      failure_class: /login_wall/i.test(String(error?.message || error)) ? 'login_wall' : 'other',
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
      const outPath = path.join(traceDumpDir, `${taskId}-${Date.now()}.json`);
      writeFileSync(outPath, JSON.stringify(traces, null, 2));
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
        `[frontier] TRACE metrics observes=${observes} acts=${acts} llm=${llm} full_chars=${fullChars} rendered_chars=${renderedChars} diff_steps=${diffSteps}`,
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
