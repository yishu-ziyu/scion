/**
 * Grok 4.5 model-swap / debug eval via local CLIProxyAPI (OpenAI-compatible).
 *
 * Formal accuracy scores stay MiniMax-M3 (plan 019). This path is for
 * harness-vs-model debugging only; it does not change production defaults.
 *
 * Usage:
 *   source ~/.cli-proxy-api/client.env && pnpm eval:grok
 *   source ~/.cli-proxy-api/client.env && TASKS=018-O1 RUNS=1 pnpm eval:grok
 *   SMOKE_ONLY=1 pnpm eval:grok
 *
 * Defaults (override with env):
 *   PROVIDER=custom_openai
 *   BASE_URL=http://127.0.0.1:8317/v1
 *   MODEL=grok-4.5
 *   API key: OPENAI_API_KEY or GROK_EVAL_API_KEY or EVAL_API_KEY (never hardcode)
 *
 * Equivalent matrix call:
 *   source ~/.cli-proxy-api/client.env && \
 *     PROVIDER=custom_openai BASE_URL=http://127.0.0.1:8317/v1 MODEL=grok-4.5 \
 *     TASKS=018-O1,018-R1 RUNS=1 pnpm eval:matrix
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scionRoot = projectRoot;
const reportDir = path.join(scionRoot, 'reports/nanobrowser/eval');
const matrixScript = path.join(__dirname, 'eval-matrix.mjs');
const clientEnvPath = path.join(os.homedir(), '.cli-proxy-api/client.env');

function parseEnvFile(filePath) {
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

function loadClientEnvFallback() {
  if (process.env.OPENAI_API_KEY || process.env.GROK_EVAL_API_KEY || process.env.EVAL_API_KEY) {
    return;
  }
  const env = parseEnvFile(clientEnvPath);
  for (const key of ['OPENAI_API_KEY', 'GROK_EVAL_API_KEY', 'EVAL_API_KEY', 'OPENAI_BASE_URL']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key];
  }
}

function resolveApiKey() {
  return (
    process.env.EVAL_API_KEY ||
    process.env.GROK_EVAL_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ''
  ).trim();
}

function redact(text, key) {
  if (!key || !text) return text;
  return text.split(key).join('[REDACTED]');
}

async function smoke8317({ baseUrl, model, apiKey }) {
  const root = baseUrl.replace(/\/+$/, '');
  const result = {
    ok: false,
    baseUrl: root,
    model,
    keyLen: apiKey.length,
    modelsHttp: 0,
    grokModels: [],
    chatHttp: 0,
    chatModel: '',
    chatPreview: '',
    error: '',
  };

  try {
    const modelsRes = await fetch(`${root}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    result.modelsHttp = modelsRes.status;
    const modelsBody = await modelsRes.text();
    if (!modelsRes.ok) {
      result.error = `models HTTP ${modelsRes.status}: ${redact(modelsBody, apiKey).slice(0, 200)}`;
      return result;
    }
    const modelsJson = JSON.parse(modelsBody);
    const ids = (modelsJson.data || []).map(item => item.id);
    result.grokModels = ids.filter(id => /grok/i.test(id)).sort();
    if (!ids.includes(model) && !result.grokModels.some(id => id.startsWith(model))) {
      result.error = `model ${model} not listed on ${root}/models (have: ${result.grokModels.join(', ') || 'none'})`;
      // still try chat; some proxies alias ids
    }

    const chatRes = await fetch(`${root}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
        max_tokens: 16,
        temperature: 0,
      }),
    });
    result.chatHttp = chatRes.status;
    const chatBody = await chatRes.text();
    result.chatPreview = redact(chatBody, apiKey).slice(0, 240);
    if (!chatRes.ok) {
      result.error = `chat HTTP ${chatRes.status}: ${result.chatPreview}`;
      return result;
    }
    const chatJson = JSON.parse(chatBody);
    result.chatModel = chatJson.model || model;
    const content = chatJson.choices?.[0]?.message?.content || '';
    result.ok = /pong/i.test(content) || chatRes.status === 200;
    if (!result.ok) result.error = `unexpected chat content: ${content.slice(0, 120)}`;
  } catch (error) {
    result.error = String(error?.message || error);
  }
  return result;
}

function writeSmokeReport(smoke) {
  mkdirSync(reportDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10) + '-' + new Date().toISOString().slice(11, 19).replaceAll(':', '');
  const reportPath = path.join(reportDir, `${stamp}-grok-8317-smoke.md`);
  const body = `# Grok CLIProxyAPI smoke (${stamp})

- ok: **${smoke.ok ? 'yes' : 'no'}**
- baseUrl: \`${smoke.baseUrl}\`
- requested model: \`${smoke.model}\`
- key present: ${smoke.keyLen > 0 ? `yes (len=${smoke.keyLen})` : 'no'}
- GET /models HTTP: ${smoke.modelsHttp}
- grok model ids: ${smoke.grokModels.length ? smoke.grokModels.map(id => `\`${id}\``).join(', ') : '(none)'}
- POST /chat/completions HTTP: ${smoke.chatHttp}
- chat response model: \`${smoke.chatModel || ''}\`
- chat preview: \`${(smoke.chatPreview || '').replace(/`/g, "'")}\`
- error: ${smoke.error || '(none)'}

## How to run full Grok eval

\`\`\`bash
source ~/.cli-proxy-api/client.env
pnpm eval:grok
# or limited:
TASKS=018-O1 RUNS=1 pnpm eval:grok
# or matrix directly:
PROVIDER=custom_openai BASE_URL=http://127.0.0.1:8317/v1 MODEL=grok-4.5 \\
  TASKS=018-O1,018-R1 RUNS=1 pnpm eval:matrix
\`\`\`

Formal scores remain MiniMax-M3 (plan 019). Grok is model-swap / debug only.
`;
  writeFileSync(reportPath, body, 'utf8');
  return reportPath;
}

async function main() {
  loadClientEnvFallback();

  const provider = process.env.PROVIDER || process.env.EVAL_PROVIDER || 'custom_openai';
  const baseUrl =
    process.env.BASE_URL || process.env.EVAL_BASE_URL || process.env.OPENAI_BASE_URL || 'http://127.0.0.1:8317/v1';
  const model = process.env.MODEL || 'grok-4.5';
  const apiKey = resolveApiKey();

  if (!apiKey) {
    console.error(
      '[eval:grok] Missing OPENAI_API_KEY / GROK_EVAL_API_KEY / EVAL_API_KEY. Run: source ~/.cli-proxy-api/client.env',
    );
    process.exitCode = 1;
    return;
  }

  console.log(`[eval:grok] smoke ${baseUrl} model=${model} keyLen=${apiKey.length}`);
  const smoke = await smoke8317({ baseUrl, model, apiKey });
  const reportPath = writeSmokeReport(smoke);
  console.log(`[eval:grok] smoke ok=${smoke.ok} report=${reportPath}`);
  if (smoke.grokModels.length) {
    console.log(`[eval:grok] grok models: ${smoke.grokModels.join(', ')}`);
  }
  if (!smoke.ok) {
    console.error(`[eval:grok] smoke failed: ${smoke.error}`);
    process.exitCode = 1;
    return;
  }

  if (process.env.SMOKE_ONLY === '1') {
    console.log('[eval:grok] SMOKE_ONLY=1 — skip matrix');
    return;
  }

  const stamp =
    process.env.MATRIX_STAMP ||
    new Date().toISOString().slice(0, 10) + '-grok-4-5-' + new Date().toISOString().slice(11, 19).replaceAll(':', '');

  const env = {
    ...process.env,
    PROVIDER: provider,
    EVAL_PROVIDER: provider,
    BASE_URL: baseUrl,
    EVAL_BASE_URL: baseUrl,
    MODEL: model,
    MINIMAX_MODEL: model,
    WAVE: process.env.WAVE || 'W1-model-swap-grok',
    MATRIX_STAMP: stamp,
    POLICY_TAG: process.env.POLICY_TAG || 'model-swap-grok',
  };

  console.log(`[eval:grok] matrix PROVIDER=${provider} BASE_URL=${baseUrl} MODEL=${model}`);
  const result = spawnSync(process.execPath, [matrixScript], {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  });
  process.exitCode = result.status ?? 1;
}

main().catch(error => {
  console.error('[eval:grok] FAIL', error);
  process.exitCode = 1;
});
