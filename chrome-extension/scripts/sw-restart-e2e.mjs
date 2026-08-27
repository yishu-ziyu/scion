/**
 * 019-SW: service-worker restart must not lose the task or double-commit.
 *
 * Flow: fixture form task → kill the extension service worker mid-run →
 * reopen the panel (SW restarts, TaskManager.recover continues reversible
 * running work) → one external commit lands, receipt unique. Do not click
 * resume. An in-flight external_commit must not double-submit.
 *
 * Launch mode only: killing the owner Chrome's SW in CDP connect mode would
 * disturb a live user session, so this scenario refuses CDP_URL/CONNECT_URL.
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from 'puppeteer-core';
import { resolveChromeForEval, seedEvalLlm } from './lib/eval-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, '../../dist');
const profilePath = path.join(os.tmpdir(), `scion-sw-restart-${process.pid}`);
const runs = Number(process.env.RUNS || 1);
const timeout = Number(process.env.E2E_TIMEOUT_MS || 180_000);
const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
const sentinel = 'FIELD_SENTINEL_SW_7721';

let browser;
let submissions = 0;
let extensionId = '';
let phase = 'bootstrap';

function failSnapshot(panel, label) {
  return panel.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const tasks = Object.values(all['task-runtime-v1'] || {}).map(task => ({
      id: task?.id?.slice(0, 8),
      status: task?.status,
      round: task?.rounds?.at(-1)?.id?.slice(0, 8),
      rounds: (task?.rounds || []).map(round => ({
        status: round.status,
        waitReason: round.waitReason,
        lastError: (round.lastError || '').slice(0, 240),
        attempts: (round.attempts || []).map(a => `${a.actionName}:${a.state}:${a.effect}`),
      })),
    }));
    return { tasks, keys: Object.keys(all) };
  }).then(info => console.log(`[e2e] phase=${phase} dump ${label}`, JSON.stringify(info).slice(0, 2500)));
}

/** Fixture server: form page + external-commit counter. */
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (request.method === 'POST' && url.pathname === '/submit') {
    submissions += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    return response.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname === '/count') return response.end(String(submissions));
  const html = await readFile(path.resolve(__dirname, '../test/fixtures/form.html'), 'utf8');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(html);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function waitForTestId(page, testId) {
  return page.waitForSelector(`[data-testid="${testId}"]`, { timeout });
}

async function typeInto(page, testId, text) {
  await waitForTestId(page, testId);
  await page.evaluate(
    (tid, value) => {
      const el = document.querySelector(`[data-testid="${tid}"]`);
      if (!el) throw new Error(`missing ${tid}`);
      const proto =
        el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, value) : (el.value = value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    },
    testId,
    text,
  );
}

async function press(page, testId) {
  await page.evaluate(tid => {
    const el = document.querySelector(`[data-testid="${tid}"]`);
    if (!el) throw new Error(`missing ${tid}`);
    el.click();
  }, testId);
}

async function submitCount() {
  return Number(await (await fetch(`${origin}/count`)).text());
}

async function readTaskProof(panel) {
  return panel.evaluate(async () => {
    const stored = await chrome.storage.local.get(['task-runtime-v1']);
    const tasks = Object.values(stored['task-runtime-v1'] || {}).filter(Boolean);
    const task = tasks.sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))[0] || null;
    const round = task
      ? (task.rounds || []).find(item => item.id === task.currentRoundId) || (task.rounds || []).at(-1)
      : null;
    const card = document.querySelector('[data-testid="task-status"]');
    return {
      taskId: task?.id || '',
      status: task?.status || '',
      roundId: round?.id || '',
      roundStatus: round?.status || '',
      waitReason: round?.waitReason || '',
      attempts: (round?.attempts || []).map(a => ({ action: a.actionName, state: a.state, effect: a.effect })),
      evidenceCount: round?.evidence?.length ?? 0,
      criteriaCount: round?.criteria?.length ?? 0,
      revision: task?.revision ?? 0,
      cardStatus: card?.getAttribute('data-status') || null,
      cardText: (card?.innerText || '').slice(0, 300),
      hasResume: Boolean(document.querySelector('[data-testid="composer-resume"]')),
      hasReceipt: Boolean(document.querySelector('[data-testid="completion-receipt"]')),
      receiptIds: [...document.querySelectorAll('[data-testid="completion-receipt"]')].map(
        el => el.getAttribute('data-receipt-id') || '',
      ),
    };
  });
}

/** Open the side panel as an extension page and seed the eval LLM. */
async function openPanel(target) {
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extensionId}/side-panel/index.html`, { waitUntil: 'domcontentloaded' });
  await seedEvalLlm(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const hasGoal = await panel.evaluate(() => Boolean(document.querySelector('[data-testid="goal-input"]')));
    if (hasGoal) break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 800));
  return panel;
}

async function sendGoal(panel, target, instruction) {
  await typeInto(panel, 'goal-input', instruction);
  assert.equal(await panel.$eval('[data-testid="goal-input"]', el => el.value), instruction);
  await target.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 200));
  await press(panel, 'goal-send');
}

/** Wait until the round shows a first observed attempt and no commit landed yet. */
async function waitInterruptibleWindow(panel) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const proof = await readTaskProof(panel);
    const sawObserved = proof.attempts.some(a => a.action === 'observe' && a.state === 'observed');
    const commitLanded = proof.attempts.some(
      a => a.effect === 'external_commit' && ['executing', 'observed', 'uncertain'].includes(a.state),
    );
    if (proof.status === 'running' && sawObserved && !commitLanded) return proof;
    if (['failed', 'cancelled'].includes(proof.status)) {
      await failSnapshot(panel, 'prekill-failed');
      throw new Error(`task ${proof.status} before kill: ${proof.cardText}`);
    }
    if (proof.receiptIds.length > 0) {
      await failSnapshot(panel, 'completed-before-kill');
      throw new Error('task completed before the SW kill window');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw new Error('timeout waiting for interruptible window');
}

async function killServiceWorker() {
  const target = browser
    .targets()
    .find(entry => entry.type() === 'service_worker' && entry.url().startsWith(`chrome-extension://${extensionId}`));
  if (!target) throw new Error(`service worker target not found for ${extensionId}`);
  const worker = await target.worker();
  await worker.close();
  const dead = Date.now();
  while (Date.now() - dead < 15_000) {
    const still = browser
      .targets()
      .some(entry => entry.type() === 'service_worker' && entry.url().startsWith(`chrome-extension://${extensionId}`));
    if (!still) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('service worker still alive 15s after closeTarget');
}

async function wipeTaskState(panel) {
  // Owned temp profile: safe to reset between runs.
  await panel.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const remove = Object.keys(all).filter(key => key === 'task-runtime-v1' || key.startsWith('chat_messages_'));
    if (remove.length) await chrome.storage.local.remove(remove);
    await chrome.storage.local.remove('chat_sessions_meta').catch(() => {});
  });
}

async function runSwRestartScenario(run) {
  phase = 'setup';
  submissions = 0;
  const target = await browser.newPage();
  await target.goto(`${origin}/form?run=${run}`, { waitUntil: 'domcontentloaded' });
  let panel = await openPanel(target);
  await wipeTaskState(panel);
  await seedEvalLlm(panel);
  await panel.reload({ waitUntil: 'domcontentloaded' });
  await waitForTestId(panel, 'goal-input');
  await target.bringToFront();
  await new Promise(resolve => setTimeout(resolve, 500));

  phase = 'goal';
  await sendGoal(panel, target, `Fill Name with ${sentinel} and submit; success is Saved successfully.`);
  assert.equal(await submitCount(), 0, 'submit count must start at zero');

  phase = 'prekill';
  const preKill = await waitInterruptibleWindow(panel);
  assert.ok(preKill.attempts.some(a => a.action === 'observe' && a.state === 'observed'), 'no observed attempt before kill');

  phase = 'kill-sw';
  await killServiceWorker();
  console.log(`[e2e] run${run} service worker killed (task ${preKill.taskId.slice(0, 8)} status=${preKill.status})`);
  await new Promise(resolve => setTimeout(resolve, 2_500));
  assert.equal(await submitCount(), 0, 'no submit may land during the SW kill');

  phase = 'reopen';
  await panel.close();
  panel = await openPanel(target);
  await new Promise(resolve => setTimeout(resolve, 1_000));

  phase = 'recovered';
  // recover() runs at SW boot and continues reversible running work. The panel
  // may briefly show the pre-recover status, so wait until it is no longer
  // sitting on interrupted / resume.
  const recoveredStart = Date.now();
  let recovered = null;
  while (Date.now() - recoveredStart < 30_000) {
    const probe = await readTaskProof(panel);
    if (['failed', 'cancelled'].includes(probe.status)) {
      await failSnapshot(panel, 'recover-failed');
      throw new Error(`task ${probe.status} after SW restart: ${probe.cardText}`);
    }
    if (probe.waitReason === 'commit_outcome_uncertain') {
      await failSnapshot(panel, 'recover-uncertain-commit');
      throw new Error('reversible running work recovered as uncertain commit');
    }
    if (
      probe.taskId === preKill.taskId &&
      probe.status !== 'interrupted' &&
      ['running', 'completed', 'waiting_user'].includes(probe.status) &&
      probe.hasResume === false
    ) {
      recovered = probe;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!recovered) {
    await failSnapshot(panel, 'recover-timeout');
    throw new Error(`recover did not continue the task; last=${JSON.stringify(await readTaskProof(panel))}`);
  }
  assert.equal(recovered.taskId, preKill.taskId, 'task identity changed across SW restart');
  assert.equal(recovered.roundId, preKill.roundId, 'round identity changed across SW restart');
  assert.ok(recovered.attempts.length >= preKill.attempts.length, 'attempts were truncated across SW restart');
  assert.ok(recovered.evidenceCount >= preKill.evidenceCount, 'evidence was truncated across SW restart');
  assert.ok(recovered.criteriaCount >= preKill.criteriaCount, 'criteria were truncated across SW restart');
  assert.notEqual(recovered.status, 'interrupted', `recover classified ${recovered.status} (expected running)`);
  assert.equal(recovered.hasResume, false, 'resume card must not be required after auto-continue');
  console.log(`[e2e] run${run} recovered: ${recovered.status}, attempts=${recovered.attempts.length} evidence=${recovered.evidenceCount}`);

  phase = 'continue';
  const start = Date.now();
  let done = recovered.status === 'completed' && (await submitCount()) === 1 && recovered.receiptIds.length === 1
    ? { ...recovered, count: 1 }
    : null;
  while (!done && Date.now() - start < timeout) {
    const proof = await readTaskProof(panel);
    const count = await submitCount();
    if (count > 1) throw new Error(`duplicate external commit: submit count=${count}`);
    if (proof.waitReason === 'commit_outcome_uncertain') {
      await failSnapshot(panel, 'continue-uncertain-commit');
      throw new Error('in-flight external_commit recovered as wait; do not double-submit');
    }
    if (proof.status === 'completed' && count === 1 && proof.receiptIds.length === 1) {
      done = { ...proof, count };
      break;
    }
    if (['failed', 'cancelled'].includes(proof.status)) {
      await failSnapshot(panel, 'continue-failed');
      throw new Error(`task ${proof.status} after auto-continue: ${proof.cardText}`);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!done) {
    await failSnapshot(panel, 'continue-timeout');
    throw new Error(`timeout after auto-continue; submit=${await submitCount()} status=${(await readTaskProof(panel)).status}`);
  }
  assert.equal(done.count, 1, `submissions !== 1 (${done.count})`);
  assert.equal(done.receiptIds.length, 1, 'receipt count !== 1');
  assert.ok(done.receiptIds[0], 'receipt id missing');
  assert.ok(done.receiptIds[0] !== preKill.receiptIds?.[0], 'reused a pre-kill receipt');
  const pageEvidence = await target
    .$eval('#saved', element => element.textContent?.trim() || '')
    .catch(() => '');
  assert.equal(pageEvidence, 'Saved successfully', 'page evidence missing after auto-continue');
  // Quiescence: count and receipt must stay stable.
  const receiptToken = done.receiptIds[0];
  for (let confirmations = 0; confirmations < 3; confirmations += 1) {
    await new Promise(resolve => setTimeout(resolve, 500));
    const proof = await readTaskProof(panel);
    const count = await submitCount();
    assert.equal(count, 1, `submit count drifted to ${count} during quiescence`);
    assert.equal(proof.receiptIds.length, 1, 'receipt duplicated during quiescence');
    assert.equal(proof.receiptIds[0], receiptToken, 'receipt changed during quiescence');
  }
  console.log(`[e2e] run${run} SW-restart PASS receipt=${done.receiptIds[0]} submissions=1`);
  await Promise.all([target.close(), panel.close()]);
}

try {
  assert(existsSync(path.join(extensionPath, 'manifest.json')), `missing extension dist at ${extensionPath}`);
  if (connectUrl) {
    throw new Error('sw-restart scenario cannot use connect mode: killing the owner profile SW is not allowed');
  }
  const chromePath = resolveChromeForEval();
  console.log('[e2e] sw-restart chromePath=', chromePath);
  console.log('[e2e] origin=', origin);
  browser = await launch({
    executablePath: chromePath,
    headless: process.env.HEADLESS !== 'false',
    userDataDir: profilePath,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-background-timer-throttling',
    ],
  });
  const manifest = JSON.parse(readFileSync(path.join(extensionPath, 'manifest.json'), 'utf8'));
  const workerFile = String(manifest?.background?.service_worker || '');
  const worker = await browser.waitForTarget(
    entry =>
      entry.type() === 'service_worker' &&
      entry.url().startsWith('chrome-extension://') &&
      (!workerFile || entry.url().endsWith(workerFile)),
    { timeout: 60_000 },
  );
  extensionId = new URL(worker.url()).host;
  console.log('[e2e] extensionId=', extensionId);

  for (let run = 0; run < runs; run += 1) {
    phase = `run${run}`;
    console.log(`[e2e] run ${run + 1}/${runs}`);
    await runSwRestartScenario(run);
  }
  console.log(`sw-restart-e2e PASS runs=${runs}`);
} catch (error) {
  console.error(`[e2e] FAIL phase=${phase}`, error);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close().catch(() => {});
    const { rm } = await import('node:fs/promises');
    await rm(profilePath, { recursive: true, force: true });
  }
  await new Promise(resolve => server.close(resolve));
}
