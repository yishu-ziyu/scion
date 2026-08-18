/**
 * Wave 1 model-swap wrapper (plan 019).
 *
 * Runs the same eval matrix with multiple models to distinguish model bottlenecks
 * from Harness bottlenecks.
 *
 * Usage (MiniMax formal path):
 *   MODELS=MiniMax-M3,GLM-4.6 pnpm eval:model-swap
 *
 * Grok via CLIProxyAPI (debug only; prefer pnpm eval:grok):
 *   source ~/.cli-proxy-api/client.env
 *   PROVIDER=custom_openai BASE_URL=http://127.0.0.1:8317/v1 \
 *     MODELS=grok-4.5 pnpm eval:model-swap
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(__dirname, 'eval-matrix.mjs');
const models = (process.env.MODELS || process.env.MODEL || 'MiniMax-M3')
  .split(',')
  .map(item => item.trim())
  .filter(Boolean);

for (const model of models) {
  console.log(`\n==== model swap: ${model} ====`);
  const stamp = new Date().toISOString().slice(0, 10) + '-' + model.replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase();
  const result = spawnSync(process.execPath, [script], {
    env: {
      ...process.env,
      MODEL: model,
      MATRIX_STAMP: stamp,
      WAVE: 'W1-model-swap',
    },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exitCode = result.status ?? 1;
}
