#!/usr/bin/env node
/**
 * Reload 持节 unpacked extension in an already-running Chrome with remote
 * debugging enabled — without touching your browsing state.
 *
 * Why: Chrome >=137 branded builds ignore --load-extension, and an unpacked
 * extension keeps its old service worker until it is reloaded from
 * chrome://extensions. This script clicks that Reload button for you.
 *
 * Usage:
 *   node scripts/reload-extension.mjs
 *   CDP_URL=http://127.0.0.1:9222 node scripts/reload-extension.mjs
 *   node scripts/reload-extension.mjs --ext-id mfchbnlipidpfbddkpinjnfigfanhgne
 *   node scripts/reload-extension.mjs --dry-run
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// puppeteer-core lives in the chrome-extension workspace; resolve it from there.
const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'chrome-extension');
const workspaceRequire = createRequire(path.join(workspaceRoot, 'package.json'));
const { connect } = workspaceRequire('puppeteer-core');

const args = process.argv.slice(2);
const cdpUrl = process.env.CDP_URL || process.env.CONNECT_URL || 'http://127.0.0.1:9222';
const knownId = args.includes('--ext-id') ? args[args.indexOf('--ext-id') + 1] : '';
const dryRun = args.includes('--dry-run');
const EXT_ID_RE = /^[a-p]{32}$/;

function log(message) {
  console.log(`[reload-extension] ${message}`);
}

/** Read the extension list from chrome://extensions (webui shadow DOM). */
async function listExtensions(page) {
  await page.goto('chrome://extensions', { waitUntil: 'domcontentloaded', timeout: 20_000 });
  await page.waitForFunction(() => document.querySelector('extensions-manager'), { timeout: 15_000 });
  return page.evaluate(() => {
    const manager = document.querySelector('extensions-manager');
    const list = manager?.shadowRoot?.querySelector('extensions-item-list');
    const items = [...(list?.shadowRoot?.querySelectorAll('extensions-item') ?? [])];
    return items.map(item => ({
      id: item.getAttribute('id'),
      name: item.shadowRoot?.querySelector('#name')?.textContent?.trim() ?? '',
      version: item.shadowRoot?.querySelector('#version')?.textContent?.trim() ?? '',
      enabled: (item.shadowRoot?.querySelector('#enable-toggle')?.getAttribute('aria-pressed') ?? '') === 'true',
    }));
  });
}

let browser;
try {
  browser = await connect({ browserURL: cdpUrl, defaultViewport: null });
} catch (error) {
  log(`无法连接 ${cdpUrl}：${error.message}`);
  log('目标 Chrome 需要以 --remote-debugging-port=9222 启动。');
  process.exit(1);
}

const probe = await browser.newPage();
const all = await listExtensions(probe);
const candidates = all.filter(entry => EXT_ID_RE.test(entry.id));
const pick =
  (knownId && candidates.find(entry => entry.id === knownId)) ||
  (!knownId && candidates.find(entry => /持节|chijie|scion/i.test(entry.name)));

if (!pick) {
  await probe.close();
  await browser.disconnect();
  log(`未找到目标扩展。候选：${candidates.map(entry => `${entry.name}(${entry.id})`).join(', ')}`);
  log('可先用 --ext-id <id> 显式指定。');
  process.exit(2);
}

log(`${dryRun ? '[dry-run] 将重新加载：' : '重新加载：'}${pick.name} ${pick.version} (${pick.id})`);
if (dryRun) {
  await probe.close();
  await browser.disconnect();
  process.exit(0);
}

// Click Reload on the matching item; then wait for the new service worker to answer.
const reloaded = await probe.evaluate(id => {
  const manager = document.querySelector('extensions-manager');
  const list = manager?.shadowRoot?.querySelector('extensions-item-list');
  const item = [...(list?.shadowRoot?.querySelectorAll('extensions-item') ?? [])].find(entry => entry.getAttribute('id') === id);
  const button = item?.shadowRoot?.querySelector('#dev-reload-button') ?? item?.shadowRoot?.querySelector('#reload');
  if (!button) return false;
  button.click();
  return true;
}, pick.id);

if (!reloaded) {
  await probe.close();
  await browser.disconnect();
  log('没有找到 Reload 按钮（扩展可能未启用开发者模式加载，路径不匹配）。');
  process.exit(3);
}

// Confirm the extension answers and the new build is served (marker check only;
// response sizes are not comparable to the dist file on disk).
const panel = await browser.newPage();
await panel.goto(`chrome-extension://${pick.id}/side-panel/index.html`, { waitUntil: 'domcontentloaded', timeout: 20_000 });
await new Promise(resolve => setTimeout(resolve, 1_200));
const served = await panel
  .evaluate(async () => {
    const manifest = await fetch(chrome.runtime.getURL('manifest.json')).then(response => response.json());
    const alive = typeof chrome.runtime.getManifest === 'function' && Boolean(chrome.runtime.getManifest().version);
    return { version: manifest.version, alive };
  })
  .catch(() => null);
await panel.close();
await probe.close();
await browser.disconnect();

if (served?.alive) {
  log(`Reload 完成。扩展 v${served.version} 已重新加载，可以重新发任务验证。`);
} else {
  log('Reload 已执行，但扩展页探测失败——手动打开侧栏确认一次即可。');
}
