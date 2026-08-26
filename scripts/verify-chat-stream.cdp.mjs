#!/usr/bin/env node
/**
 * Drive the side panel over CDP: send 「你好」 on the chat path and capture
 * whether assistant text streams in incrementally (chat_stream_delta).
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'chrome-extension');
const { connect } = createRequire(path.join(workspaceRoot, 'package.json'))('puppeteer-core');

const EXT_ID = 'mfchbnlipidpfbddkpinjnfigfanhgne';
const browser = await connect({ browserURL: 'http://127.0.0.1:9222', defaultViewport: null });

const page = await browser.newPage();
// instrument BEFORE page scripts run: wrap chrome.runtime.connect
await page.evaluateOnNewDocument(() => {
  window.__chatStreamFrames = [];
  const origConnect = chrome.runtime.connect.bind(chrome.runtime);
  chrome.runtime.connect = (...args) => {
    const port = origConnect(...args);
    const origPost = port.postMessage.bind(port);
    port.postMessage = msg => {
      if (msg && msg.type === 'chat_stream') window.__chatStreamFrames.push({ dir: 'out', type: msg.type });
      return origPost(msg);
    };
    port.onMessage.addListener(msg => {
      if (msg && typeof msg.type === 'string' && msg.type.startsWith('chat_stream')) {
        window.__chatStreamFrames.push({ dir: 'in', type: msg.type, len: msg.text ? msg.text.length : 0, t: performance.now() });
      }
    });
    return port;
  };
});

await page.goto(`chrome-extension://${EXT_ID}/side-panel/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="goal-input"]', { timeout: 20000 });
await new Promise(r => setTimeout(r, 500));

await page.click('[data-testid="goal-input"]');
await page.type('[data-testid="goal-input"]', '你好', { delay: 20 });

// sample the growing assistant text while streaming
const samples = [];
const sampler = setInterval(async () => {
  try {
    const text = await page.evaluate(() => document.body.innerText);
    samples.push(text.length);
  } catch {}
}, 150);

await page.keyboard.press('Enter');

// wait for a chat_stream_done frame (max 60s)
const result = await page.waitForFunction(
  () => window.__chatStreamFrames.some(f => f.type === 'chat_stream_done') ||
        window.__chatStreamFrames.some(f => f.type === 'chat_stream_error'),
  { timeout: 60000 },
).then(() => 'finished').catch(() => 'timeout');
clearInterval(sampler);

const frames = await page.evaluate(() => window.__chatStreamFrames);
const finalText = await page.evaluate(() => document.body.innerText);
const deltas = frames.filter(f => f.type === 'chat_stream_delta');
const t0 = frames.find(f => f.dir === 'in')?.t ?? 0;
const lastDelta = deltas.at(-1)?.t ?? 0;
const doneT = frames.find(f => f.type === 'chat_stream_done')?.t ?? 0;
console.log('first delta ms:', Math.round(t0), 'last delta at ms:', Math.round(lastDelta), 'done at ms:', Math.round(doneT), 'done-after-last-delta ms:', Math.round(doneT - lastDelta));
console.log('result:', result);
console.log('frames out:', frames.filter(f => f.dir === 'out').length, 'deltas in:', deltas.length);
console.log('done:', frames.some(f => f.type === 'chat_stream_done'), 'error frames:', frames.filter(f => f.type === 'chat_stream_error'));
console.log('text-length samples while streaming:', samples.join(','));
console.log('--- final visible text (tail) ---');

await page.close();
await browser.disconnect();
