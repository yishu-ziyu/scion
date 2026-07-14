import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Stagehand } from '@browserbasehq/stagehand';
import { resolveMiniMaxConfig } from './minimax-env.mjs';
import { createMiniMaxLlmClient } from './minimax-openai-client.mjs';

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
 * Local Stagehand + MiniMax-M3 (OpenAI-compatible).
 * Credentials: ~/.config/ai-providers/env.local (never commit).
 */
export async function createLocalStagehand() {
  const mm = resolveMiniMaxConfig();
  if (!mm.hasKey) {
    throw new Error(
      'MiniMax API key missing. Put MINIMAX_API_KEY in ~/.config/ai-providers/env.local (same as Nanobrowser).',
    );
  }

  process.env.OPENAI_API_KEY = mm.apiKey;
  process.env.OPENAI_BASE_URL = mm.baseURL;

  const headless = process.env.HEADLESS === 'true';
  const executablePath = resolveChromePath();

  console.log(
    JSON.stringify({
      msg: 'p1-stagehand model',
      modelName: mm.modelName,
      baseURL: mm.baseURL,
      keySource: mm.keySource,
      keyLen: mm.apiKey.length,
      chrome: executablePath || 'default',
      headless,
    }),
  );

  const llmClient = createMiniMaxLlmClient({
    apiKey: mm.apiKey,
    baseURL: mm.baseURL,
    modelName: mm.modelName,
  });

  const stagehand = new Stagehand({
    env: 'LOCAL',
    llmClient,
    model: {
      modelName: mm.modelName,
      apiKey: mm.apiKey,
      baseURL: mm.baseURL,
    },
    verbose: process.env.STAGEHAND_VERBOSE === '1' ? 1 : 0,
    localBrowserLaunchOptions: {
      headless,
      executablePath,
      viewport: { width: 1280, height: 800 },
    },
  });
  await stagehand.init();
  return stagehand;
}
