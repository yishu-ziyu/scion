/** Build the exact committed source and emit a non-mtime eval attestation. */
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  distAttestation,
  ensureEvalTrustKey,
  readGitIdentity,
  readWorkspaceStatus,
  signEvalPayload,
  sourceHashAtCommit,
} from './lib/eval-provenance.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scionRoot = path.resolve(projectRoot, '../..');

async function runBuild() {
  return new Promise(resolve => {
    const child = spawn('pnpm', ['build'], { cwd: projectRoot, env: process.env, stdio: 'inherit' });
    child.on('close', code => resolve(code ?? 1));
  });
}

async function main() {
  const identity = readGitIdentity(scionRoot);
  const before = readWorkspaceStatus(scionRoot);
  if (before.blocking.length > 0) {
    throw new Error(`refuse eval build from dirty source: ${before.blocking.map(item => item.path).join(',')}`);
  }
  const sourceHash = sourceHashAtCommit(scionRoot, identity.git_sha);
  const trustKey = await ensureEvalTrustKey();
  const startedAt = new Date().toISOString();
  const exitCode = await runBuild();
  if (exitCode !== 0) throw new Error(`pnpm build exited ${exitCode}`);
  const after = readWorkspaceStatus(scionRoot);
  if (after.blocking.length > 0) {
    throw new Error(`build changed tracked/source files: ${after.blocking.map(item => item.path).join(',')}`);
  }
  const dist = await distAttestation(scionRoot, projectRoot);
  const manifest = JSON.parse(
    await import('node:fs/promises').then(fs => fs.readFile(path.join(projectRoot, 'dist/manifest.json'), 'utf8')),
  );
  const attestation = signEvalPayload(
    {
      schema_version: 'chijie-eval-build-v1',
      ...identity,
      source_hash: sourceHash,
      dist_hash: dist.hash,
      extension_version: String(manifest.version || ''),
      build_command: 'pnpm build',
      build_exit_code: exitCode,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      dist_files: dist.files,
      runtime_critical_files: dist.runtime_files,
    },
    trustKey,
    'attestation_hmac',
  );
  const output = process.env.EVAL_BUILD_ATTESTATION
    ? path.resolve(process.env.EVAL_BUILD_ATTESTATION)
    : path.join(scionRoot, 'reports/nanobrowser/eval/build-attestations', `${identity.git_sha}.json`);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(attestation, null, 2) + '\n', 'utf8');
  console.log(`[eval-build] attestation=${path.relative(scionRoot, output)} dist_hash=${dist.hash}`);
}

main().catch(error => {
  console.error('[eval-build] FAIL', error);
  process.exitCode = 1;
});
