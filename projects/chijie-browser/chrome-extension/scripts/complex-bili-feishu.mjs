/**
 * Overnight complex task: Bilibili home row + favorites first row → Feishu doc.
 * CDP only; does not launch Chrome. Auto-clicks approval / wait-continue while owner sleeps.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect } from 'puppeteer-core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const connectUrl = process.env.CDP_URL || 'http://127.0.0.1:9222';
const extensionId = process.env.EXTENSION_ID || 'ndgepamohiegdnpooefoedambmcimaii';
const docUrl =
  process.env.FEISHU_DOC_URL ||
  'https://zib9x25efxe.feishu.cn/docx/S0Vgd9zotoSwS1xx2dicC80xn1b';
const timeout = Number(process.env.E2E_TIMEOUT_MS || 1_200_000);
const reportDir =
  process.env.REPORT_DIR ||
  path.resolve(__dirname, '../../../../reports/nanobrowser/overnight');

const instruction = [
  '打开哔哩哔哩网站 www.bilibili.com。',
  '第一步：在首页读取「第一行」可见视频的标题名称（首页推荐区横向第一排每个视频的标题文字），记下列表 A。',
  '第二步：进入收藏夹（收藏或「我的收藏」），打开默认/第一个收藏夹，读取列表中第一行视频的标题名称，记为列表 B。',
  `第三步：打开飞书文档 ${docUrl}`,
  '在真正写入文档正文之前必须停下等待我批准。',
  '我批准后只写入一次，格式：',
  '【B站首页第一行】',
  '- 标题…',
  '【收藏夹第一行】',
  '- 标题…',
  '不要改文档标题，不要追加无关内容。',
  '完成后根据飞书页面已出现这些标题文字且显示已保存/同步再结束。禁止假完成。',
].join('');

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSafe(filePath).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i <= 0) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}

function readFileSafe(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

async function seedMiniMax(page) {
  let key = process.env.MINIMAX_API_KEY || process.env.MINIMAX_TOKEN_PLAN_KEY || '';
  if (!key) {
    for (const file of [
      path.join(os.homedir(), '.config/ai-providers/env.local'),
      path.join(os.homedir(), '.config/ai-providers/.env'),
    ]) {
      const env = parseEnvFile(file);
      key = (env.MINIMAX_API_KEY || env.MINIMAX_TOKEN_PLAN_KEY || '').trim();
      if (key) break;
    }
  }
  if (!key) {
    console.warn('[complex] no MiniMax key; relying on extension storage');
    return;
  }
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
          maxSteps: 100,
          maxActionsPerStep: 5,
          maxFailures: 5,
          agentCoreBackend: 'control',
        },
      }),
    { apiKey: key, model, baseUrl },
  );
}

async function main() {
  const startedAt = new Date().toISOString();
  mkdirSync(reportDir, { recursive: true });
  const browser = await connect({ browserURL: connectUrl.replace(/\/$/, ''), defaultViewport: null });
  console.log('[complex] connected', connectUrl);

  let bili = null;
  for (const p of await browser.pages()) {
    const u = p.url();
    if (/^https?:\/\/(www\.)?bilibili\.com/i.test(u)) {
      bili = p;
      break;
    }
  }
  if (!bili) {
    bili = await browser.newPage();
    await bili.goto('https://www.bilibili.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
  await bili.bringToFront();
  console.log('[complex] bilibili', bili.url());

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
  if (!hasGoal) throw new Error('goal-input missing');

  await panel.evaluate(() => {
    const stop = [...document.querySelectorAll('button')].find(b => /停止|Stop/i.test(b.textContent || ''));
    stop?.click();
  });
  await new Promise(r => setTimeout(r, 800));

  await panel.bringToFront();
  await panel.evaluate(text => {
    const el = document.querySelector('[data-testid="goal-input"]');
    const proto = window.HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    setter ? setter.call(el, text) : (el.value = text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, instruction);

  await bili.bringToFront();
  await new Promise(r => setTimeout(r, 400));
  await panel.evaluate(() => document.querySelector('[data-testid="goal-send"]')?.click());
  console.log('[complex] goal sent');

  const deadline = Date.now() + timeout;
  let finalStatus = null;
  let sawApproval = false;
  let approveClicks = 0;
  let sawActive = false;
  let hasReceipt = false;
  let panelText = '';
  const history = [];

  while (Date.now() < deadline) {
    const snap = await panel
      .evaluate(() => ({
        status: document.querySelector('[data-testid="task-status"]')?.getAttribute('data-status') || null,
        hasApprove: Boolean(document.querySelector('[data-testid="approval-approve"]')),
        hasWaitContinue: Boolean(document.querySelector('[data-testid="wait-continue"]')),
        hasWaitRetry: Boolean(document.querySelector('[data-testid="wait-retry"]')),
        hasConfirm: Boolean(document.querySelector('[data-testid="criterion-confirm"]')),
        hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
        body: (document.body?.innerText || '').slice(0, 1800),
      }))
      .catch(() => null);

    if (!snap) {
      await new Promise(r => setTimeout(r, 2000));
      continue;
    }

    finalStatus = snap.status;
    panelText = snap.body;
    if (snap.status && history.at(-1) !== snap.status) history.push(snap.status);
    if (['running', 'waiting_approval', 'waiting_user'].includes(snap.status || '')) sawActive = true;
    if (sawActive && snap.hasReceipt) hasReceipt = true;

    if (snap.hasApprove && approveClicks < 5) {
      await panel.evaluate(() => document.querySelector('[data-testid="approval-approve"]')?.click());
      approveClicks += 1;
      sawApproval = true;
      console.log('[complex] approval-approve', approveClicks);
      await new Promise(r => setTimeout(r, 1500));
    }

    if (snap.hasWaitContinue || snap.hasWaitRetry || snap.hasConfirm) {
      await panel.evaluate(() => {
        document.querySelector('[data-testid="wait-continue"]')?.click();
        document.querySelector('[data-testid="wait-retry"]')?.click();
        document.querySelector('[data-testid="criterion-confirm"]')?.click();
      });
      console.log('[complex] wait/confirm click');
      await new Promise(r => setTimeout(r, 1500));
    }

    if (Date.now() % 20000 < 2500) {
      console.log('[complex] tick', snap.status, 'approve', sawApproval, 'receipt', hasReceipt);
    }

    if (sawActive && snap.status === 'completed' && hasReceipt) break;
    if (sawActive && (snap.status === 'failed' || snap.status === 'cancelled')) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  let feishuText = '';
  for (const p of await browser.pages()) {
    if (/feishu\.cn\/docx/i.test(p.url())) {
      feishuText = await p.evaluate(() => (document.body?.innerText || '').slice(0, 2500)).catch(() => '');
    }
  }

  const looksWritten =
    /【B站首页|收藏夹第一行|bilibili|B站首页/i.test(feishuText) ||
    (feishuText.split('\n').filter(l => l.trim().startsWith('-')).length >= 2);

  const pass = sawActive && finalStatus === 'completed' && hasReceipt && sawApproval && looksWritten;

  const report = `# Complex: B站首页+收藏 → 飞书

- Started: ${startedAt}
- Finished: ${new Date().toISOString()}
- Doc: ${docUrl}
- Status history: ${history.join(' → ') || '(none)'}
- Final status: ${finalStatus}
- Saw active: ${sawActive}
- Saw approval: ${sawApproval} (clicks=${approveClicks})
- Receipt: ${hasReceipt}
- Feishu looks written: ${looksWritten}
- Result: **${pass ? 'PASS' : 'FAIL'}**

## Panel excerpt

\`\`\`
${panelText}
\`\`\`

## Feishu excerpt

\`\`\`
${feishuText.slice(0, 1500)}
\`\`\`

## Notes

- Owner-asleep automation may click approval-approve and wait-continue/retry.
- Matt: PASS only if completed+receipt+approval seen+feishu body has list structure.
`;

  const out = path.join(reportDir, 'complex-bili-feishu-run.md');
  writeFileSync(out, report);
  console.log('[complex] report', out, pass ? 'PASS' : 'FAIL', finalStatus);

  try {
    browser.disconnect();
  } catch {
    /* ignore */
  }
  process.exit(pass ? 0 : 2);
}

main().catch(err => {
  console.error('[complex] fatal', err);
  try {
    mkdirSync(reportDir, { recursive: true });
    writeFileSync(
      path.join(reportDir, 'complex-bili-feishu-run.md'),
      `# Complex FAIL fatal\n\n${String(err?.stack || err)}\n`,
    );
  } catch {
    /* ignore */
  }
  process.exit(1);
});
