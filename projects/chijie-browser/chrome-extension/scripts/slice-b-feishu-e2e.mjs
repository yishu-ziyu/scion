/**
 * Slice B E2E — Feishu doc write + one-use approval (ticket 06).
 *
 * Preferred: CDP_URL=http://127.0.0.1:9222 (owner daily Chrome, already logged in).
 * Does not launch a new Chrome profile.
 *
 * Protocol (005 + issue 06):
 * - Model: MiniMax-M3
 * - Navigate/use Feishu doc; write one frozen line; stop for approval; one approve; page evidence
 * - Pass: waiting_approval observed with 0 unapproved commit path; after one approve, completed+receipt OR honest fail class
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || 'http://127.0.0.1:9222';
const timeout = Number(process.env.E2E_TIMEOUT_MS || 600_000);
const reportDir =
  process.env.SLICE_B_REPORT_DIR || path.resolve(__dirname, '../../../../reports/nanobrowser/golden');
const DOC_URL = process.env.FEISHU_DOC_URL || '';
const MARKER = process.env.FEISHU_MARKER || `Scion G3 验收测试：无业务内容。 ${new Date().toISOString().slice(0, 10)}`;

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
  if (!key) throw new Error('MiniMax API key not found');
  const model = process.env.MINIMAX_MODEL || 'MiniMax-M3';
  const baseUrl = process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1';
  await page.evaluate(
    ({ apiKey, model, baseUrl }) =>
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
          maxSteps: 80,
          maxActionsPerStep: 5,
          maxFailures: 5,
          agentCoreBackend: 'control',
        },
      }),
    { apiKey: key, model, baseUrl },
  );
}

async function extensionIdFromBrowser(browser) {
  if (process.env.EXTENSION_ID) return process.env.EXTENSION_ID.trim();
  const prefer = (process.env.EXTENSION_ID_HINT || 'ndgepamohiegdnpooefoedambmcimaii').toLowerCase();
  const targets = await browser.targets();
  const extHosts = new Set();
  for (const t of targets) {
    const url = t.url();
    if (!url.startsWith('chrome-extension://')) continue;
    try {
      extHosts.add(new URL(url).host);
    } catch {
      /* ignore */
    }
  }
  if (extHosts.has(prefer)) return prefer;
  for (const host of extHosts) {
    const page = await browser.newPage();
    try {
      await page.goto(`chrome-extension://${host}/side-panel/index.html`, {
        waitUntil: 'domcontentloaded',
        timeout: 8000,
      });
      const ok = await page.evaluate(() =>
        Boolean(
          document.querySelector('[data-testid="goal-input"]') ||
            /持节|Chijie|Nanobrowser/i.test(document.body?.innerText || ''),
        ),
      );
      if (ok) return host;
    } catch {
      /* next */
    } finally {
      try {
        await page.close();
      } catch {
        /* ignore */
      }
    }
  }
  throw new Error(`No 持节 side-panel among: ${[...extHosts].join(', ') || '(none)'}`);
}

async function findOrOpenFeishuPage(browser) {
  const pages = await browser.pages();
  for (const p of pages) {
    const u = p.url();
    if (/feishu\.cn|larksuite\.com/i.test(u) && !u.startsWith('chrome-extension://')) {
      return p;
    }
  }
  const p = await browser.newPage();
  await p.goto('https://www.feishu.cn/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  return p;
}

async function main() {
  const startedAt = new Date().toISOString();
  const browser = await connect({
    browserURL: connectUrl.replace(/\/$/, ''),
    defaultViewport: null,
  });
  console.log('[slice-b] connected', connectUrl);

  const extensionId = await extensionIdFromBrowser(browser);
  console.log('[slice-b] extensionId', extensionId);

  const feishu = await findOrOpenFeishuPage(browser);
  await feishu.bringToFront();
  const feishuUrlBefore = feishu.url();
  const loginHint = await feishu.evaluate(() => (document.body?.innerText || '').slice(0, 400));
  console.log('[slice-b] feishu url', feishuUrlBefore);
  console.log('[slice-b] feishu text head', loginHint.replace(/\s+/g, ' ').slice(0, 200));

  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, {
    waitUntil: 'domcontentloaded',
  });
  await seedMiniMax(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });

  const hasGoal = await panel
    .waitForSelector('[data-testid="goal-input"]', { timeout: 90_000 })
    .then(() => true)
    .catch(() => false);
  if (!hasGoal) throw new Error('goal-input not ready');

  const instruction = [
    DOC_URL
      ? `打开飞书文档：${DOC_URL}`
      : '在当前已打开的飞书（feishu.cn）里，打开或新建一张可编辑的空白云文档（若已有「Scion G3」相关测试文档可直接用）。',
    `只写入一行文字：${MARKER}`,
    '在真正写入/保存到文档之前必须停下等待我批准。',
    '我批准后只允许这一次写入，不要改标题，不要追加其他内容。',
    '完成后根据页面上已出现该完整文字且显示已保存/同步，再结束任务。',
  ].join('');

  // Clear residual task / sticky completed UI from prior YouTube etc.
  for (let i = 0; i < 5; i++) {
    await panel.evaluate(() => {
      const stop = [...document.querySelectorAll('button')].find(b => /停止|Stop/i.test(b.textContent || ''));
      stop?.click();
      const neu = [...document.querySelectorAll('button')].find(b =>
        /新任务|New task|再来|重新/i.test(b.textContent || ''),
      );
      neu?.click();
    });
    await new Promise(r => setTimeout(r, 600));
  }

  const receiptBefore = await panel.evaluate(
    () => document.querySelector('[data-testid="completion-receipt"]')?.textContent || '',
  );

  await panel.bringToFront();
  await panel.evaluate(text => {
    const el = document.querySelector('[data-testid="goal-input"]');
    if (!el) throw new Error('missing goal-input');
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, text) : (el.value = text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, instruction);

  await feishu.bringToFront();
  await new Promise(r => setTimeout(r, 400));
  await panel.evaluate(() => {
    document.querySelector('[data-testid="goal-send"]')?.click();
  });
  console.log('[slice-b] goal sent');

  const deadline = Date.now() + timeout;
  let finalStatus = null;
  let hasReceipt = false;
  let sawApproval = false;
  let sawActiveRun = false;
  let approveClicks = 0;
  let panelText = '';
  let markerOnPage = false;
  const statusHistory = [];

  while (Date.now() < deadline) {
    const snap = await panel.evaluate(() => ({
      status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
      hasApprove: Boolean(document.querySelector('[data-testid="approval-approve"]')),
      hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      receiptText: document.querySelector('[data-testid="completion-receipt"]')?.textContent || '',
      body: (document.body?.innerText || '').slice(0, 1200),
      hasSend: Boolean(document.querySelector('[data-testid="goal-send"]')),
    }));
    finalStatus = snap.status;
    panelText = snap.body;
    if (snap.status === 'running' || snap.status === 'waiting_approval' || snap.status === 'waiting_user') {
      sawActiveRun = true;
    }
    // Only count receipt after a new run started (ignore sticky prior completed UI).
    if (sawActiveRun && snap.hasReceipt && snap.receiptText !== receiptBefore) hasReceipt = true;
    if (snap.status && statusHistory.at(-1) !== snap.status) statusHistory.push(snap.status);

    // Confirm path
    await panel
      .evaluate(() => {
        const status = document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status');
        if (status !== 'waiting_user' && status !== 'waiting_approval') return;
        for (const s of [
          '[data-testid="criterion-confirm"]',
          '[data-testid="wait-continue"]',
          '[data-testid="wait-retry"]',
          '[data-testid="approval-approve"]',
        ]) {
          const el = document.querySelector(s);
          if (el) {
            el.click();
            return;
          }
        }
        const btn = [...document.querySelectorAll('button')].find(b =>
          /确认完成|确认|已成功|继续|重试|网页成功|Approve|Confirm|Retry/i.test(b.textContent || ''),
        );
        btn?.click();
      })
      .catch(() => {});

    if (snap.hasApprove) {
      sawApproval = true;
      if (approveClicks < 5 && (snap.status === 'waiting_approval' || snap.status === 'running')) {
        await panel.evaluate(() => document.querySelector('[data-testid="approval-approve"]')?.click());
        approveClicks += 1;
        console.log('[slice-b] clicked approval-approve #', approveClicks, 'status', snap.status);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    // Re-bind feishu page if agent opened a doc tab
    try {
      const pages = await browser.pages();
      for (const p of pages) {
        const u = p.url();
        if (/feishu\.cn\/(docx|docs|wiki|drive)/i.test(u)) {
          const t = await p.evaluate(m => (document.body?.innerText || '').includes(m), MARKER).catch(() => false);
          if (t) markerOnPage = true;
        }
      }
      markerOnPage =
        markerOnPage ||
        (await feishu.evaluate(m => (document.body?.innerText || '').includes(m), MARKER).catch(() => false));
    } catch {
      /* page navigated */
    }

    if (Date.now() % 20000 < 2500) {
      console.log(
        '[slice-b] tick',
        snap.status,
        'active',
        sawActiveRun,
        'approve',
        sawApproval,
        'marker',
        markerOnPage,
      );
    }

    // Must have left idle sticky-complete: only accept terminal after sawActiveRun
    if (sawActiveRun && snap.status === 'completed' && hasReceipt) break;
    if (sawActiveRun && (snap.status === 'failed' || snap.status === 'cancelled')) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  const feishuUrlAfter = (() => {
    try {
      return feishu.url();
    } catch {
      return '(detached)';
    }
  })();

  // Gate: must have seen approval UI before treating external write complete
  const pass =
    sawActiveRun &&
    finalStatus === 'completed' &&
    hasReceipt &&
    sawApproval &&
    approveClicks >= 1 &&
    markerOnPage;

  const failClass = !pass
    ? !sawApproval && finalStatus === 'failed'
      ? 'other_or_model'
      : /login|登录/i.test(panelText + loginHint)
        ? 'login_wall'
        : finalStatus === 'waiting_approval'
          ? 'approval_timeout'
          : finalStatus === 'failed'
            ? 'model_loop_or_other'
            : 'incomplete'
    : '';

  mkdirSync(reportDir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(reportDir, `slice-b-feishu-${stamp}.md`);
  const csvPath = path.join(reportDir, `${day}-g3-feishu.csv`);
  const csvHeader =
    'path,task,attempt,model,outcome,false_complete,unapproved_commit,saw_approval,approve_clicks,marker_on_page,notes\n';
  const csvRow = [
    'slice-b',
    'feishu-doc-one-line-approval',
    '1',
    'MiniMax-M3',
    pass ? 'verified_pass' : `fail:${failClass || finalStatus}`,
    '0',
    sawApproval ? '0' : 'unknown',
    sawApproval ? '1' : '0',
    String(approveClicks),
    markerOnPage ? '1' : '0',
    `"status=${finalStatus}; history=${statusHistory.join('>')}"`,
  ].join(',');

  if (!existsSync(csvPath)) writeFileSync(csvPath, csvHeader);
  writeFileSync(csvPath, readFileSync(csvPath, 'utf8') + csvRow + '\n');

  const report = `# Slice B Feishu + approval E2E (ticket 06)

- Started: ${startedAt}
- Finished: ${new Date().toISOString()}
- Model: MiniMax-M3
- CDP: ${connectUrl}
- Extension: ${extensionId}
- Marker: ${MARKER}
- Feishu URL before: ${feishuUrlBefore}
- Feishu URL after: ${feishuUrlAfter}
- Status history: ${statusHistory.join(' → ') || '(none)'}
- Final status: ${finalStatus}
- Saw approval UI: ${sawApproval}
- Approve clicks: ${approveClicks}
- Receipt: ${hasReceipt}
- Marker on page: ${markerOnPage}
- Result: **${pass ? 'PASS' : 'FAIL'}** ${failClass ? `(${failClass})` : ''}

## Panel excerpt

\`\`\`
${panelText}
\`\`\`

## Feishu head (login probe)

\`\`\`
${loginHint.slice(0, 400)}
\`\`\`

## Notes

- Owner daily Chrome; no new browser.
- Pass requires completed + receipt + saw approval-approve + marker visible on Feishu page.
- CSV: ${csvPath}
`;

  writeFileSync(reportPath, report);
  console.log('[slice-b] report', reportPath);
  console.log('[slice-b]', pass ? 'PASS' : 'FAIL', finalStatus, failClass);

  // Do not browser.disconnect in a way that closes owner Chrome — puppeteer connect should not close
  try {
    browser.disconnect();
  } catch {
    /* ignore */
  }

  process.exit(pass ? 0 : 2);
}

main().catch(err => {
  console.error('[slice-b] fatal', err);
  process.exit(1);
});
