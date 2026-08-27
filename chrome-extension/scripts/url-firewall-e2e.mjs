/**
 * URL firewall browser proof.
 *
 * A rejected URL must never reach CDP Page.navigate. Chrome executes
 * javascript: URLs before reporting ERR_ABORTED, so catching that error is
 * not evidence of safety.
 */
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { launch } from 'puppeteer-core';
import { openFoundUrl } from '../../pages/side-panel/src/presentation/open-found-url.ts';
import { isUrlAllowed } from '../src/background/browser/util.ts';
import { resolveChromeForEval } from './lib/eval-provider.mjs';

const sentinel = 'URL_FIREWALL_SENTINEL_8f13';
const profilePath = path.join(os.tmpdir(), `scion-url-firewall-e2e-${process.pid}`);
const fixtureHtml = `<!doctype html><html><head><title>${sentinel}</title></head><body><main id="sentinel">${sentinel}</main></body></html>`;
const server = http.createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(fixtureHtml);
});

let browser;
let sinkCalls = 0;
let callbackCalls = 0;

function closeServer() {
  return new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launch({
    executablePath: resolveChromeForEval(),
    headless: true,
    userDataDir: profilePath,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-background-networking'],
  });

  const page = await browser.newPage();
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  const cdp = await page.createCDPSession();
  const snapshot = () =>
    page.evaluate(() => ({
      url: location.href,
      title: document.title,
      dom: document.documentElement.outerHTML,
    }));
  const navigateSink = async rawUrl => {
    sinkCalls += 1;
    return cdp.send('Page.navigate', { url: rawUrl });
  };
  const guardedNavigate = async rawUrl => {
    if (!isUrlAllowed(rawUrl, [], [])) return false;
    await navigateSink(rawUrl);
    return true;
  };
  globalThis.chrome = { tabs: { create: ({ url }) => navigateSink(url) } };

  const mutation =
    "document.title='URL_FIREWALL_BYPASSED';document.body.innerHTML='<p id=\"pwned\">changed</p>';void 0";
  const attacks = [
    { label: 'literal javascript', url: `javascript:${mutation}` },
    {
      label: 'javascript with LF',
      url: `java
script:${mutation}`,
    },
  ];

  for (const attack of attacks) {
    const before = await snapshot();
    assert.equal(before.title, sentinel, `${attack.label}: fixture title was not the sentinel`);
    const callsBefore = sinkCalls;
    const callbacksBefore = callbackCalls;

    const accepted = await guardedNavigate(attack.url);
    openFoundUrl(attack.url, () => {
      callbackCalls += 1;
    });
    openFoundUrl(attack.url);
    await Promise.resolve();

    assert.equal(accepted, false, `${attack.label}: firewall accepted the URL`);
    assert.equal(sinkCalls, callsBefore, `${attack.label}: CDP Page.navigate was called`);
    assert.equal(callbackCalls, callbacksBefore, `${attack.label}: onOpenUrl was called`);
    assert.deepEqual(await snapshot(), before, `${attack.label}: title or DOM changed after rejection`);
  }

  assert.equal(sinkCalls, 0, 'dangerous URLs reached the CDP navigation sink');
  console.log(
    JSON.stringify({
      ok: true,
      attacks: attacks.map(attack => attack.label),
      sinkCalls,
      callbackCalls,
      title: (await snapshot()).title,
    }),
  );
} finally {
  delete globalThis.chrome;
  if (browser) await browser.close().catch(() => undefined);
  if (server.listening) await closeServer().catch(() => undefined);
  await rm(profilePath, { recursive: true, force: true });
}
