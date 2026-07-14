import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/**
 * Resolve MiniMax credentials the same way Nanobrowser e2e does.
 * Never log the raw key.
 */
export function resolveMiniMaxConfig() {
  const files = [
    path.join(os.homedir(), '.config/ai-providers/env.local'),
    path.join(os.homedir(), '.config/ai-providers/.env'),
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../../../../../projects/nanobrowser/.env.local'),
  ];

  let fileEnv = {};
  for (const file of files) {
    fileEnv = { ...fileEnv, ...parseEnvFile(file) };
  }

  // secrets.local.ts (gitignored) fallback
  const secretsPath = path.resolve(
    __dirname,
    '../../../../../projects/nanobrowser/chrome-extension/src/personal/secrets.local.ts',
  );
  if (existsSync(secretsPath)) {
    const text = readFileSync(secretsPath, 'utf8');
    const match = text.match(/PERSONAL_MINIMAX_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1] && !fileEnv.MINIMAX_API_KEY) {
      fileEnv.MINIMAX_API_KEY = match[1];
    }
  }

  const apiKey = (
    process.env.MINIMAX_API_KEY ||
    process.env.MINIMAX_TOKEN_PLAN_KEY ||
    process.env.OPENAI_API_KEY ||
    fileEnv.MINIMAX_API_KEY ||
    fileEnv.MINIMAX_TOKEN_PLAN_KEY ||
    fileEnv.OPENAI_API_KEY ||
    ''
  ).trim();

  const baseURL = (
    process.env.MINIMAX_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    fileEnv.MINIMAX_BASE_URL ||
    fileEnv.OPENAI_BASE_URL ||
    'https://api.minimaxi.com/v1'
  ).trim();

  const modelName = (
    process.env.STAGEHAND_MODEL ||
    process.env.MINIMAX_MODEL ||
    fileEnv.STAGEHAND_MODEL ||
    fileEnv.MINIMAX_MODEL ||
    'MiniMax-M3'
  ).trim();

  return {
    apiKey,
    baseURL,
    modelName,
    hasKey: Boolean(apiKey),
    keySource: process.env.MINIMAX_API_KEY
      ? 'env.MINIMAX_API_KEY'
      : process.env.MINIMAX_TOKEN_PLAN_KEY
        ? 'env.MINIMAX_TOKEN_PLAN_KEY'
        : fileEnv.MINIMAX_API_KEY
          ? 'ai-providers/env.local'
          : fileEnv.MINIMAX_TOKEN_PLAN_KEY
            ? 'ai-providers token plan'
            : 'missing',
  };
}
