/**
 * Slice A E2E — open YouTube (ticket 03).
 *
 * Preferred: CDP_URL=http://127.0.0.1:9222 (main Chrome with 持节 loaded).
 * Fallback: Chrome for Testing + load unpacked dist (temp profile).
 *
 * Protocol:
 * - Model: MiniMax-M3 (seeded personal defaults)
 * - Instruction: 打开 YouTube
 * - Pass: content tab URL is youtube.com; task completed with receipt; steps present
 *
 * Safety: does not wipe owner favorites when CONNECT_URL is set unless FORCE_RESET=1.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const timeout = Number(process.env.E2E_TIMEOUT_MS || 180_000);
const reportDir =
  process.env.SLICE_A_REPORT_DIR ||
  path.resolve(__dirname, '../../../../reports/nanobrowser/golden');

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    path.join(
      os.homedir(),
      'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return candidates.at(-1);
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

function resolveMiniMaxApiKey() {
  if (process.env.MINIMAX_API_KEY || process.env.MINIMAX_TOKEN_PLAN_KEY) {
    return process.env.MINIMAX_API_KEY || process.env.MINIMAX_TOKEN_PLAN_KEY;
  }
  for (const file of [
    path.join(os.homedir(), '.config/ai-providers/env.local'),
    path.join(os.homedir(), '.config/ai-providers/.env'),
  ]) {
    const env = parseEnvFile(file);
    const key = (env.MINIMAX_API_KEY || env.MINIMAX_TOKEN_PLAN_KEY || '').trim();
    if (key) return key;
  }
  const secretsPath = path.resolve(__dirname, '../src/personal/secrets.local.ts');
  if (existsSync(secretsPath)) {
    const m = readFileSync(secretsPath, 'utf8').match(/PERSONAL_MINIMAX_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (m?.[1]) return m[1];
  }
  return '';
}

async function seedMiniMax(page) {
  const key = resolveMiniMaxApiKey();
  if (!key) throw new Error('MiniMax API key not found (env or secrets.local.ts)');
  await page.evaluate(apiKey => {
    const provider = {
      id: 'minimax',
      name: 'MiniMax',
      type: 'custom_openai',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey,
      modelNames: ['MiniMax-M3'],
    };
    return chrome.storage.local.set({
      'llm-providers': { minimax: provider },
      'agent-models': {
        planner: { provider: 'minimax', modelName: 'MiniMax-M3', parameters: { temperature: 0.3, topP: 0.6 } },
        navigator: { provider: 'minimax', modelName: 'MiniMax-M3', parameters: { temperature: 0.2, topP: 0.5 } },
      },
      'general-settings': { agentCoreBackend: 'control' },
    });
  }, key);
}

async function extensionIdFromBrowser(browser) {
  if (process.env.EXTENSION_ID) return process.env.EXTENSION_ID.trim();

  // Prefer 持节 / chijie / nanobrowser SW if identifiable; avoid random other extensions.
  const prefer = (process.env.EXTENSION_ID_HINT || 'nnldlldkcjcooleefoflkgcjobimnaol').toLowerCase();
  const targets = await browser.targets();
  const extHosts = new Set();
  for (const t of targets) {
    const url = t.url();
    if (!url.startsWith('chrome-extension://')) continue;
    try {
      extHosts.add(new URL(url).host);
    } catch {
      // ignore
    }
  }
  if (extHosts.has(prefer)) return prefer;

  // Probe each extension for our side-panel path
  for (const host of extHosts) {
    const page = await browser.newPage();
    try {
      const res = await page.goto(`chrome-extension://${host}/side-panel/index.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 8000,
      });
      if (res && !res.status()?.toString().startsWith('4')) {
        return host;
      }
      // also ok if body has 持节 / goal-input after load
      const ok = await page.evaluate(() =>
        Boolean(document.querySelector('[data-testid="goal-input"]') || /持节|Chijie|Nanobrowser/i.test(document.body?.innerText || '')),
      );
      if (ok) {
        return host;
      }
    } catch {
      // try next
    } finally {
      try {
        await page.close();
      } catch {
        // ignore
      }
    }
  }

  throw new Error(
    `No 持节 side-panel found among extensions: ${[...extHosts].join(', ') || '(none)'}. Load unpacked dist and set EXTENSION_ID=...`,
  );
}

async function main() {
  const startedAt = new Date().toISOString();
  let browser;
  let ownsBrowser = false;

  if (connectUrl) {
    browser = await puppeteer.connect({
      browserURL: connectUrl.replace(/\/$/, ''),
      defaultViewport: null,
    });
    console.log('[slice-a] connected', connectUrl);
  } else {
    if (!existsSync(extensionPath)) {
      throw new Error(`dist missing: ${extensionPath} — run pnpm build first`);
    }
    const chromePath = resolveChromePath();
    const profilePath = path.join(os.tmpdir(), `scion-slice-a-${process.pid}`);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        `--user-data-dir=${profilePath}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
    });
    ownsBrowser = true;
    console.log('[slice-a] launched', chromePath);
  }

  const extensionId = await extensionIdFromBrowser(browser);
  console.log('[slice-a] extensionId', extensionId);

  // Content tab (must not be extension page)
  const content = await browser.newPage();
  await content.goto('about:blank', { waitUntil: 'domcontentloaded' });

  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await seedMiniMax(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });

  const hasGoal = await panel
    .waitForSelector('[data-testid="goal-input"]', { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasGoal) {
    throw new Error('goal-input not ready — extension may need reload or bootstrap failed');
  }

  // Focus content as active tab before send (SidePanel uses active tab)
  await content.bringToFront();
  await new Promise(r => setTimeout(r, 500));
  await panel.bringToFront();

  await panel.evaluate(() => {
    const el = document.querySelector('[data-testid="goal-input"]');
    if (!el) throw new Error('missing goal-input');
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, '打开 YouTube') : (el.value = '打开 YouTube');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await panel.evaluate(() => {
    document.querySelector('[data-testid="goal-send"]')?.click();
  });

  const deadline = Date.now() + timeout;
  let finalStatus = null;
  let hasReceipt = false;
  let hasSteps = false;
  let panelText = '';
  while (Date.now() < deadline) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
      hasSteps: Boolean(document.querySelector('[data-testid="task-execution-steps"], [data-testid="task-round-step"]')),
      hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      body: (document.body?.innerText || '').slice(0, 800),
    }));
    finalStatus = snap.status;
    panelText = snap.body;
    if (snap.hasReceipt) hasReceipt = true;
    if (snap.hasSteps) hasSteps = true;
    if (snap.status === 'completed' && snap.hasReceipt && snap.hasSteps) break;
    if (snap.status === 'failed' || snap.status === 'cancelled') break;
    await new Promise(r => setTimeout(r, 1500));
  }

  const pages = await browser.pages();
  const yt = [];
  for (const p of pages) {
    const u = p.url();
    if (/youtube\.com/i.test(u) && !u.startsWith('chrome-extension://')) {
      yt.push(u);
    }
  }

  // Ticket 03: completed + receipt + steps + real youtube content tab.
  const pass =
    finalStatus === 'completed' &&
    hasReceipt &&
    hasSteps &&
    yt.length > 0 &&
    !yt.some(u => u.startsWith('chrome-extension://'));

  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `slice-a-youtube-${stamp}.md`);
  const report = `# Slice A YouTube E2E

- Started: ${startedAt}
- Finished: ${new Date().toISOString()}
- Model: MiniMax-M3 (seeded)
- Instruction: 打开 YouTube
- CDP: ${connectUrl || 'launched temp profile'}
- Extension: ${extensionId}
- Task status: ${finalStatus}
- Has receipt: ${hasReceipt}
- Has steps: ${hasSteps}
- YouTube content tabs: ${yt.length ? yt.join(', ') : '(none)'}
- Result: **${pass ? 'PASS' : 'FAIL'}**

## Panel excerpt

\`\`\`
${panelText}
\`\`\`

## Notes

- Ticket 03 minimum green: completed + receipt + steps + youtube.com content tab.
- If FAIL: reload unpacked extension, keep a content tab active, open real side panel, retry.
`;
  writeFileSync(reportPath, report, 'utf8');
  console.log('[slice-a] report', reportPath);
  console.log('[slice-a]', pass ? 'PASS' : 'FAIL', { finalStatus, hasReceipt, hasSteps, yt });

  if (ownsBrowser) await browser.close();
  else browser.disconnect();

  if (!pass) process.exitCode = 1;
}

main().catch(err => {
  console.error('[slice-a] error', err);
  process.exitCode = 1;
});
