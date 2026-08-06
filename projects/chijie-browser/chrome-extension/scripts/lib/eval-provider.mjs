/**
 * Eval-only LLM provider seed helpers.
 *
 * Default remains MiniMax-M3 for formal scores (plan 019).
 * Optional OpenAI-compatible path (Grok via CLIProxyAPI, etc.):
 *
 *   PROVIDER=custom_openai \
 *   BASE_URL=http://127.0.0.1:8317/v1 \
 *   MODEL=grok-4.5 \
 *   OPENAI_API_KEY=...   # or GROK_EVAL_API_KEY / EVAL_API_KEY
 *
 * Never hardcode keys. client.env is loaded as a fallback only.
 */
import { existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const out = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    let text = line.trim();
    if (!text || text.startsWith('#')) continue;
    if (text.startsWith('export ')) text = text.slice(7).trim();
    const index = text.indexOf('=');
    if (index <= 0) continue;
    const key = text.slice(0, index).trim();
    let value = text.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function resolveModel() {
  return process.env.MODEL || process.env.MINIMAX_MODEL || 'MiniMax-M3';
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = (value || '').trim();
    if (text) return text;
  }
  return '';
}

function readKeyFromFiles(keys, files) {
  for (const file of files) {
    const env = parseEnvFile(file);
    for (const key of keys) {
      const value = (env[key] || '').trim();
      if (value) return value;
    }
  }
  return '';
}

const envFileCandidates = [
  path.join(os.homedir(), '.cli-proxy-api/client.env'),
  path.join(os.homedir(), '.config/ai-providers/env.local'),
  path.join(os.homedir(), '.config/ai-providers/.env'),
  path.resolve(__dirname, '../../../../.env.local'),
  path.resolve(__dirname, '../../../.env.local'),
];

export function resolveOpenAICompatApiKey() {
  const fromEnv = firstNonEmpty(
    process.env.EVAL_API_KEY,
    process.env.GROK_EVAL_API_KEY,
    process.env.OPENAI_API_KEY,
  );
  if (fromEnv) return fromEnv;
  return readKeyFromFiles(['EVAL_API_KEY', 'GROK_EVAL_API_KEY', 'OPENAI_API_KEY'], envFileCandidates);
}

export function resolveMiniMaxApiKey() {
  const fromEnv = firstNonEmpty(process.env.MINIMAX_API_KEY, process.env.MINIMAX_TOKEN_PLAN_KEY);
  if (fromEnv) return fromEnv;
  const fromFiles = readKeyFromFiles(
    ['MINIMAX_API_KEY', 'MINIMAX_TOKEN_PLAN_KEY'],
    envFileCandidates.filter(file => !file.includes('cli-proxy-api')),
  );
  if (fromFiles) return fromFiles;
  const secretsPath = path.resolve(__dirname, '../../src/personal/secrets.local.ts');
  if (existsSync(secretsPath)) {
    const text = readFileSync(secretsPath, 'utf8');
    const match = text.match(/PERSONAL_MINIMAX_API_KEY\s*=\s*['"]([^'"]+)['"]/);
    if (match?.[1]) return match[1];
  }
  return '';
}

/**
 * Resolve which provider the eval e2e scripts should inject into chrome.storage.
 * Requires explicit PROVIDER / EVAL_PROVIDER for non-MiniMax paths so formal
 * MiniMax scores never switch by accident.
 */
export function resolveEvalProvider() {
  const provider = firstNonEmpty(process.env.EVAL_PROVIDER, process.env.PROVIDER).toLowerCase();
  const model = resolveModel();

  if (provider === 'custom_openai' || provider === 'openai' || provider === 'grok_proxy') {
    const baseUrl = firstNonEmpty(
      process.env.EVAL_BASE_URL,
      process.env.BASE_URL,
      process.env.OPENAI_BASE_URL,
      'http://127.0.0.1:8317/v1',
    ).replace(/\/+$/, '');
    return {
      kind: 'openai_compat',
      providerId: 'eval_custom',
      name: 'Eval OpenAI-compatible',
      type: 'custom_openai',
      apiKey: resolveOpenAICompatApiKey(),
      baseUrl,
      model,
    };
  }

  return {
    kind: 'minimax',
    providerId: 'minimax',
    name: 'MiniMax',
    type: 'custom_openai',
    apiKey: resolveMiniMaxApiKey(),
    baseUrl: firstNonEmpty(process.env.MINIMAX_BASE_URL, 'https://api.minimaxi.com/v1').replace(/\/+$/, ''),
    model: firstNonEmpty(process.env.MINIMAX_MODEL, process.env.MODEL, 'MiniMax-M3'),
  };
}

export function buildEvalStoragePayload(cfg) {
  if (!cfg.apiKey) {
    if (cfg.kind === 'minimax') {
      throw new Error('MINIMAX_API_KEY is required (env or ~/.config/ai-providers/env.local)');
    }
    throw new Error(
      'OPENAI_API_KEY / GROK_EVAL_API_KEY / EVAL_API_KEY required for custom eval provider (e.g. source ~/.cli-proxy-api/client.env)',
    );
  }
  return {
    'llm-api-keys': {
      providers: {
        [cfg.providerId]: {
          name: cfg.name,
          type: cfg.type,
          apiKey: cfg.apiKey,
          baseUrl: cfg.baseUrl,
          modelNames: [cfg.model],
          createdAt: Date.now(),
        },
      },
    },
    'agent-models': {
      agents: {
        planner: {
          provider: cfg.providerId,
          modelName: cfg.model,
          parameters: { temperature: 0.1, topP: 0.1 },
        },
        navigator: {
          provider: cfg.providerId,
          modelName: cfg.model,
          parameters: { temperature: 0.1, topP: 0.1 },
        },
      },
    },
    'general-settings': {
      maxSteps: 100,
      maxActionsPerStep: 5,
      maxFailures: 3,
      useVision: false,
      useVisionForPlanner: false,
      planningInterval: 3,
      displayHighlights: false,
      minWaitPageLoad: 250,
      agentCoreBackend: 'control',
    },
  };
}

/** Seed planner/navigator LLM settings into extension storage (eval only). */
export async function seedEvalLlm(panel) {
  const cfg = resolveEvalProvider();
  const payload = buildEvalStoragePayload(cfg);
  console.log(
    `[eval-provider] seed kind=${cfg.kind} providerId=${cfg.providerId} model=${cfg.model} baseUrl=${cfg.baseUrl} keyLen=${cfg.apiKey.length}`,
  );
  await panel.evaluate(async storagePayload => chrome.storage.local.set(storagePayload), payload);
  return cfg;
}

export function hasEvalApiKey() {
  try {
    return Boolean(resolveEvalProvider().apiKey);
  } catch {
    return false;
  }
}
