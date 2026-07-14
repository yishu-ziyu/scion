import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Stagehand } from '@browserbasehq/stagehand';

function resolveChromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = [
    path.join(
      os.homedir(),
      'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    ),
    '/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Local Stagehand. Prefer mid-tier models via STAGEHAND_MODEL.
 * Product rule: mid models must be good enough — do not require flagship for pass.
 */
export async function createLocalStagehand() {
  const model = process.env.STAGEHAND_MODEL || 'openai/gpt-4o-mini';
  const headless = process.env.HEADLESS === 'true';
  const executablePath = resolveChromePath();
  const stagehand = new Stagehand({
    env: 'LOCAL',
    // Model name surface differs by Stagehand version; keep string override via env docs.
    modelName: model,
    modelClientOptions: process.env.OPENAI_BASE_URL
      ? { apiKey: process.env.OPENAI_API_KEY, baseURL: process.env.OPENAI_BASE_URL }
      : undefined,
    localBrowserLaunchOptions: {
      headless,
      executablePath,
      viewport: { width: 1280, height: 800 },
    },
  });
  await stagehand.init();
  return stagehand;
}
