/**
 * Debug Chrome without activating the Mac Space.
 *
 * Launch: `open -g` (do not bring to foreground).
 * Tabs: Target.createTarget { background: true }.
 * Never page.bringToFront or chrome.windows.update({ focused: true }).
 */
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { connect } = createRequire(path.join(root, 'chrome-extension/package.json'))('puppeteer-core');

export const CDP_URL = process.env.CDP_URL || 'http://127.0.0.1:9222';
export const DEBUG_PROFILE = process.env.CHROME_DEBUG_PROFILE || path.join(os.homedir(), '.chrome-debug-scion');
const CHROME_APP = 'Google Chrome';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function cdpReady() {
  try {
    const res = await fetch(`${CDP_URL}/json/version`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Start debug Chrome in the background. Does not activate the current Space. */
export async function ensureSilentDebugChrome(ms = 25_000) {
  if (await cdpReady()) return;
  spawn(
    'open',
    [
      '-g',
      '-na',
      CHROME_APP,
      '--args',
      '--remote-debugging-port=9222',
      `--user-data-dir=${DEBUG_PROFILE}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--no-default-browser-check',
    ],
    { stdio: 'ignore', detached: true },
  ).unref();
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await cdpReady()) return;
    await sleep(250);
  }
  throw new Error(`silent debug Chrome did not open ${CDP_URL}`);
}

export async function connectSilent() {
  return connect({
    browserURL: CDP_URL,
    defaultViewport: null,
    protocolTimeout: 180_000,
  });
}

function targetIdOf(target) {
  try {
    if (typeof target.id === 'function') return target.id();
  } catch {}
  return target._targetId;
}

/** Open a tab without activating its window. */
export async function openBackgroundTab(browser, url) {
  const session = await browser.target().createCDPSession();
  try {
    let targetId;
    try {
      ({ targetId } = await session.send('Target.createTarget', { url, background: true }));
    } catch {
      ({ targetId } = await session.send('Target.createTarget', { url }));
    }
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const target = browser.targets().find(item => targetIdOf(item) === targetId);
      if (target) {
        const page = await target.page();
        if (page) return page;
      }
      await sleep(100);
    }
    throw new Error(`no page for ${url}`);
  } finally {
    await session.detach().catch(() => {});
  }
}

export async function reloadExtensionSilent(browser, extId) {
  const targets = await browser.targets();
  const sw =
    targets.find(
      target =>
        target.type() === 'service_worker' &&
        target.url().startsWith(`chrome-extension://${extId}/`),
    ) ||
    targets.find(target => target.url().startsWith(`chrome-extension://${extId}/`));
  if (!sw) throw new Error(`extension ${extId} not loaded in debug Chrome`);
  const session = await sw.createCDPSession();
  try {
    await session.send('Runtime.evaluate', {
      expression: 'chrome.runtime.reload()',
      awaitPromise: false,
    });
  } catch {
    // reload tears the worker down; that is success
  } finally {
    await session.detach().catch(() => {});
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const next = (await browser.targets()).find(
      target =>
        target.type() === 'service_worker' &&
        target.url().startsWith(`chrome-extension://${extId}/`),
    );
    if (next) return;
    await sleep(250);
  }
}

/** Close only the debug Chrome connected on 9222 — not the user's daily Chrome. */
export async function closeDebugChrome(browser) {
  if (!browser) return;
  try {
    await browser.close();
  } catch {
    try {
      await browser.disconnect();
    } catch {}
  }
}
