/**
 * Wave 1 / 3 / long-horizon eval matrix runner (plan 019/020/021).
 *
 * Spawns the production extension e2e scripts, parses their matrix_row lines,
 * and writes a standard CSV + summary under reports/nanobrowser/eval.
 *
 * Usage (formal MiniMax scores — plan 019 default):
 *   TASKS=018-O1,018-R1 RUNS=1 MODEL=MiniMax-M3 pnpm eval:matrix
 *   TASK_SET=long_horizon RUNS=1 MODEL=MiniMax-M3 pnpm eval:matrix
 *   DRY_RUN=1 TASK_SET=long_horizon pnpm eval:matrix
 *
 * Optional OpenAI-compatible model-swap (e.g. Grok 4.5 via CLIProxyAPI; not formal scores):
 *   source ~/.cli-proxy-api/client.env
 *   PROVIDER=custom_openai BASE_URL=http://127.0.0.1:8317/v1 MODEL=grok-4.5 \
 *     TASKS=018-O1 RUNS=1 pnpm eval:matrix
 *   # or: pnpm eval:grok
 *
 * Env:
 *   TASKS                    comma task ids (overrides TASK_SET)
 *   TASK_SET                 default|fixture|public_ab|long_horizon
 *   DRY_RUN=1                validate task registration only (no Chrome)
 *   PROVIDER / EVAL_PROVIDER  custom_openai|openai|grok_proxy (omit = MiniMax)
 *   BASE_URL / EVAL_BASE_URL  OpenAI-compatible root (default http://127.0.0.1:8317/v1)
 *   MODEL / MINIMAX_MODEL     model id
 *   OPENAI_API_KEY | GROK_EVAL_API_KEY | EVAL_API_KEY  (never hardcode)
 */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalizeMatrixRow,
  inferAttachMode,
  matrixProtocolCount,
  missingMatrixRow,
  parseMatrixRows,
  reconcileRunnerExit,
  validateRunnerMatrixRow,
} from './lib/eval-harness.mjs';
import {
  evalMetrics,
  parseEvalCsv,
  serializeEvalCsv,
  validateCampaignCsvAttestation,
  validateEvidenceRows,
  validateEvalRows,
} from './lib/eval-gate.mjs';
import {
  assertSafeCampaignStamp,
  assertRealpathContained,
  computeEvalArmHash,
  computeEvalRunId,
  distAttestation,
  evalArmTuple,
  evaluatorHashAtCommit,
  expectedRunEvidenceRelativeDir,
  expectedEvaluatorContract,
  listFiles,
  readEvalTrustKey,
  readGitIdentity,
  readWorkspaceStatus,
  sha256,
  signEvalPayload,
  sourceHashAtCommit,
  taskDefinitionHashAtCommit,
  verifyEvalPayloadSignature,
} from './lib/eval-provenance.mjs';
import { resolveEvalIdentity } from '../chrome-extension/scripts/lib/eval-provider.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const scionRoot = projectRoot;
const canonicalReportDir = path.resolve(projectRoot, 'reports/nanobrowser/eval');
const reportDir = process.env.REPORT_DIR ? path.resolve(process.env.REPORT_DIR) : canonicalReportDir;

/** Named task sets. TASKS=... overrides TASK_SET when both are set. */
const TASK_SETS = {
  default: ['018-O1', '018-R1'],
  fixture: ['018-O1', '018-R1'],
  public_ab: ['013-A01', '013-A02', '013-A03', '013-B01', '013-B04', '013-B05', '013-B06', '013-B07', '013-B08'],
  // product/021 long-horizon mini set: multi-phase, no Owner login
  long_horizon: ['021-LH-01', '021-LH-02', '021-LH-03', '021-LH-04'],
  // product/022 Phase 0 release baseline task set (formal MiniMax)
  phase0_022: [
    '013-A01',
    '013-A03',
    '013-B04',
    '013-B05',
    '013-B06',
    '013-B07',
    '013-B08',
    '018-O1',
    '018-R1',
    '021-LH-01',
    '021-LH-02',
    '021-LH-03',
    '021-LH-04',
  ],
  // product/022 dedicated harness tasks (unit/driver scripts where registered)
  harness_022: [
    '022-KERNEL-01',
    '022-DIFF-01',
    '022-SKILL-01',
    '022-SKILL-02',
    '022-VERIFY-01',
    '022-ARTIFACT-01',
    '022-LEARN-01',
  ],
  // Frontier Eval v1 — hard long-horizon discriminators (outcome-only scoring)
  frontier_v1: ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8'],
};

function resolveTasks() {
  if (Object.hasOwn(process.env, 'TASKS')) {
    const explicit = process.env.TASKS.split(',')
      .map(item => item.trim())
      .filter(Boolean);
    if (explicit.length === 0) throw new Error('TASKS was provided but contains zero task ids');
    return explicit;
  }
  const setName = (process.env.TASK_SET || 'default').trim();
  const set = TASK_SETS[setName];
  if (!set) {
    const known = Object.keys(TASK_SETS).join(', ');
    throw new Error(`unknown TASK_SET=${setName}; known: ${known}`);
  }
  return [...set];
}

const tasks = resolveTasks();
const runs = process.env.RUNS === undefined ? 1 : Number(process.env.RUNS);
const resolvedEvalIdentity = resolveEvalIdentity();
const model = resolvedEvalIdentity.model;
const evalProvider = resolvedEvalIdentity.provider;
const providerBaseUrl = resolvedEvalIdentity.base_url;
const featureFlagsHash = sha256(JSON.stringify(resolvedEvalIdentity.feature_flags));
const evalBaseUrl = process.env.EVAL_BASE_URL || process.env.BASE_URL || '';
const promptVersion = process.env.PROMPT_VERSION || 'chijie-control-v0.3.0';
const policyTag = process.env.POLICY_TAG || 'baseline';
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const gitIdentity = readGitIdentity(scionRoot);
const gitSha = gitIdentity.git_sha;
const stamp = assertSafeCampaignStamp(
  process.env.MATRIX_STAMP || new Date().toISOString().replaceAll(':', '').replaceAll('.', '-').replace('Z', 'Z'),
);
const csvPath = path.join(reportDir, `${stamp}-eval-matrix.csv`);
const summaryPath = path.join(reportDir, `${stamp}-eval-summary.md`);
const campaignPath = path.join(reportDir, `${stamp}-eval-campaign.json`);

const taskCommands = {
  '018-O1': {
    script: ['chrome-extension/scripts/action-agent-e2e.mjs'],
    env: { E2E_SKIP_MEDIA: '1' },
  },
  '018-R1': { script: ['chrome-extension/scripts/r1-extract-e2e.mjs'], env: {} },
  '013-C01': { script: ['chrome-extension/scripts/action-agent-e2e.mjs'], env: {} },
  '015-J-CONT-01': { script: ['chrome-extension/scripts/action-agent-e2e.mjs'], env: {} },
  '013-A02': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.bilibili.com',
      GOAL: '当前页是不是 bilibili 首页？只回答是或否并给出 URL host',
      VERIFY: 'body_contains',
      EXPECTED: 'bilibili.com',
    },
  },
  '013-A01': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.wikipedia.org',
      GOAL: '用一句话说明当前页标题和网站域名',
      VERIFY: 'body_contains',
      EXPECTED: 'wikipedia.org',
    },
  },
  '013-A03': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://example.com',
      GOAL: '打开 YouTube',
      VERIFY: 'url_contains',
      EXPECTED: 'youtube.com',
    },
  },
  '013-B01': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.bilibili.com',
      GOAL: '打开第一行第一个视频',
      VERIFY: 'url_starts_with',
      EXPECTED: 'https://www.bilibili.com/video/',
    },
  },
  '013-B02': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.bilibili.com/video/BV1hiGA6bEAN/',
      GOAL: '暂停当前视频',
      VERIFY: 'media_paused',
      EXPECTED: '',
    },
  },
  '013-B03': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.bilibili.com/video/BV1hiGA6bEAN/',
      GOAL: '播放当前视频',
      VERIFY: 'media_playing',
      EXPECTED: '',
    },
  },
  '013-B04': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://example.com',
      GOAL: '打开 https://www.wikipedia.org',
      VERIFY: 'url_starts_with',
      EXPECTED: 'https://www.wikipedia.org',
    },
  },
  '013-B05': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      GOAL: '在页内搜索框输入 Agent 并提交搜索',
      VERIFY: 'url_contains',
      EXPECTED: 'wikipedia.org/wiki/Agent',
    },
  },
  '013-B06': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.youtube.com',
      GOAL: '打开首页上第一个视频',
      VERIFY: 'url_contains',
      EXPECTED: 'youtube.com/watch',
    },
  },
  '013-B07': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://example.com',
      GOAL: '点击页面上的 More information... 链接',
      VERIFY: 'url_contains',
      EXPECTED: 'iana.org',
    },
  },
  '013-B08': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://en.wikipedia.org/wiki/Artificial_intelligence',
      GOAL: '滚到页面底部',
      VERIFY: 'scroll_bottom',
      EXPECTED: '',
    },
  },

  // --- product/021 long-horizon mini set (multi-phase, no Owner login) ---
  // Portal → search/navigate → article URL + page text fact.
  '021-LH-01': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://www.wikipedia.org',
      GOAL: '进入英文维基；搜索并打开 Artificial intelligence 条目；确认 URL 在 wiki/Artificial_intelligence 后再完成。不要在门户或搜索结果列表页报完成。',
      VERIFY: 'url_and_page_text',
      EXPECTED: 'wikipedia.org/wiki/Artificial_intelligence||Artificial intelligence',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  // Leave example.com → open wiki article → confirm page text.
  '021-LH-02': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://example.com',
      GOAL: '离开 example.com；打开 https://en.wikipedia.org/wiki/Web_browser ；确认页面正文含 web browser 后再完成。不要把普通维基页面当成登录墙。',
      VERIFY: 'url_and_page_text',
      EXPECTED: 'wikipedia.org/wiki/Web_browser||web browser',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  // Local products fixture → extract table → name most expensive item.
  '021-LH-03': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'fixture://products',
      GOAL: '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取所有行为 name,price,rating CSV；3) 根据页面数据在回复中写出最贵商品的名称与价格。',
      VERIFY: 'products_extract',
      EXPECTED: '',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  // Native dogfood regression: preserve evidence across two real sources and deliver both.
  '021-LH-04': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'https://example.com',
      GOAL: '这是一个双来源交付任务，请在当前任务绑定标签页中依次完成：1) 点击 More information 访问 IANA Example Domains；2) 记录 IANA 页面标题和完整 URL；3) 再打开 https://en.wikipedia.org/wiki/Web_browser；4) 读取 Wikipedia 标题和首段定义的第一句。最终交付必须只在完成两站后输出，包含两个完整 URL、IANA 标题 Example Domains、Wikipedia 标题 Web browser、Wikipedia 首段第一句英文原文，以及“观察一：”和“观察二：”开头的两条中文观察。任一项缺失都不得完成。',
      VERIFY: 'multi_source_delivery',
      EXPECTED:
        'https://www.iana.org/help/example-domains||https://en.wikipedia.org/wiki/Web_browser||Example Domains||Web browser',
      E2E_TIMEOUT_MS: '240000',
    },
  },

  // product/022 dedicated gates — unit harness (browser e2e subset runs via phase0_022)
  '022-KERNEL-01': { script: ['scripts/eval-022-unit-gates.mjs'], env: { UNIT_TASK_FILTER: '022-KERNEL-01' } },
  '022-DIFF-01': { script: ['scripts/eval-022-unit-gates.mjs'], env: { UNIT_TASK_FILTER: '022-DIFF-01' } },
  // List/table extract skill path: reuse LH-03 fixture goal under dedicated task id (no new product code).
  '022-SKILL-01': {
    script: ['chrome-extension/scripts/eval-public-task.mjs'],
    env: {
      TARGET_URL: 'fixture://products',
      GOAL: '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取所有行为 name,price,rating CSV；3) 根据页面数据在回复中写出最贵商品的名称与价格。',
      VERIFY: 'products_extract',
      EXPECTED: '',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  '022-SKILL-02': { script: ['scripts/eval-022-unit-gates.mjs'], env: { UNIT_TASK_FILTER: '022-SKILL-02' } },
  '022-VERIFY-01': { script: ['scripts/eval-022-unit-gates.mjs'], env: { UNIT_TASK_FILTER: '022-VERIFY-01' } },
  '022-ARTIFACT-01': { script: ['scripts/eval-022-unit-gates.mjs'], env: { UNIT_TASK_FILTER: '022-ARTIFACT-01' } },
  '022-LEARN-01': {
    script: ['scripts/eval-022-unit-gates.mjs'],
    env: { UNIT_TASK_FILTER: '022-LEARN-01' },
  },

  // --- Frontier Eval v1 (reports/nanobrowser/frontier-eval-v1) ---
  // Scoring is user-outcome only; EXTENSION_PATH selects product under test.
  // Calibrated after smoke floor: multi-step fixtures with headroom, not zero-pass walls.
  F1: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/catalog.html',
      GOAL: '当前是 Interactive Catalog 表格（默认已列出全部商品）。请从表格中找出三款 capsule：Orion Capsule、Nova Capsule、Vega Capsule，在回复中写出各自 price：2100000、1800000、2900000（必须三款齐全）。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'Orion Capsule||Nova Capsule||Vega Capsule||2100000||1800000||2900000',
      E2E_TIMEOUT_MS: '120000',
    },
  },
  F2: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/catalog.html',
      GOAL: '多阶段：1) Category 选 module；2) Sort 选 rating；3) Apply；4) Expand Beta Dock Module；5) 回复 serial 与 price：Z-MOD-0042 与 510000。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'Z-MOD-0042||510000',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  F3: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/catalog.html',
      GOAL: '从表格读取三款 capsule 的名称与价格 2100000/1800000/2900000 并回复。页面可能中途刷新：刷新后继续完成，不要放弃。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'Orion Capsule||Nova Capsule||Vega Capsule||2100000||1800000||2900000',
      INTERRUPT_AFTER_MS: '8000',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  F4: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/catalog.html',
      GOAL: '从表格读取三款 capsule 名称与价格 2100000/1800000/2900000 并回复。若 active tab 被切到无关站，必须回到本 catalog 页完成。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'Orion Capsule||Nova Capsule||Vega Capsule||2100000||1800000||2900000',
      WRONG_TAB_AFTER_MS: '6000',
      E2E_TIMEOUT_MS: '180000',
    },
  },
  F5: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/trap.html',
      GOAL: '当前页价格错误。点击 “Go to Interactive catalog (correct prices)”，从 catalog 表格读取三款 capsule 真实价格 2100000/1800000/2900000 与名称并回复。禁止使用 999/888。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'Orion Capsule||Nova Capsule||Vega Capsule||2100000||1800000||2900000',
      E2E_TIMEOUT_MS: '150000',
    },
  },
  F6: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/catalog.html',
      GOAL: '点击 Expand 打开 Orion Capsule 行，读取 source_ref。回复须同时包含 Orion Capsule、2100000、SRC-ORION-01。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'Orion Capsule||2100000||SRC-ORION-01',
      E2E_TIMEOUT_MS: '150000',
    },
  },
  F7: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/delay.html',
      GOAL: 'Simple search 会失败。使用 Advanced search（约 2 秒后出现），查询输入 hidden report，回复 RT-77-OK 或 Hidden Report 77。',
      VERIFY: 'frontier_recovery',
      E2E_TIMEOUT_MS: '150000',
    },
  },
  F8: {
    trusted: false,
    script: ['chrome-extension/scripts/eval-frontier-task.mjs'],
    env: {
      TARGET_URL: 'fixture://frontier/spa.html',
      GOAL: '同页：展开 Dock Ring B 的 details（Expand details），回复 serial Z-MOD-0042。如列表过长可先 Category=dock 再 Apply。',
      VERIFY: 'frontier_spa_serial',
      E2E_TIMEOUT_MS: '150000',
    },
  },
};

function runApplicability({ taskId, command, attachMode, verificationPayload, outcome, unapprovedCommit }) {
  if (attachMode === 'unit') {
    return {
      eval_level: 'L1',
      seed: 'not_applicable_no_provider_seed',
      persona_id: 'not_applicable_l1',
      persona_version: 'not_applicable_l1',
      simulator_model: 'not_applicable_l1',
      simulator_prompt_version: 'not_applicable_l1',
      profile_or_fixture_id: 'not_applicable_unit',
      start_url: 'not_applicable_unit',
      bound_tab_id: 'not_applicable_unit',
      side_effect_verdict: 'not_applicable_unit',
    };
  }
  const observedStartUrl = String(verificationPayload?.bound_tab?.url || '').trim();
  const declaredTarget = String(command?.env?.TARGET_URL || '').trim();
  const fixtureId = declaredTarget.startsWith('fixture://')
    ? declaredTarget
    : taskId === '018-R1'
      ? 'fixture://products'
      : ['018-O1', '013-C01', '015-J-CONT-01'].includes(taskId)
        ? 'fixture://form'
        : '';
  const boundTabId = verificationPayload?.bound_tab?.id;
  const externalCommitApplicable = ['018-O1', '013-C01', '015-J-CONT-01'].includes(taskId);
  return {
    eval_level: 'L1',
    seed: 'not_applicable_no_provider_seed',
    persona_id: 'not_applicable_l1',
    persona_version: 'not_applicable_l1',
    simulator_model: 'not_applicable_l1',
    simulator_prompt_version: 'not_applicable_l1',
    profile_or_fixture_id:
      fixtureId || (attachMode === 'launched_chrome_for_testing' ? 'ephemeral_cft_profile' : 'external_cdp_profile'),
    start_url:
      observedStartUrl || (outcome === 'verified_pass' ? 'missing_observed_start_url' : 'not_observed_run_failed'),
    bound_tab_id: Number.isInteger(boundTabId)
      ? boundTabId
      : outcome === 'verified_pass'
        ? 'missing_observed_bound_tab'
        : 'not_observed_run_failed',
    side_effect_verdict: externalCommitApplicable
      ? Number(unapprovedCommit) === 1
        ? 'observed_out_of_scope_or_duplicate'
        : 'observed_no_out_of_scope_commit'
      : 'not_applicable_no_external_commit_contract',
  };
}

function runTask(taskId, attempt, evidenceDir, traceDumpDir, runIdentity) {
  const command = taskCommands[taskId];
  if (!command) {
    return Promise.resolve({
      code: 2,
      out: `matrix_row ${JSON.stringify({
        task_id: taskId,
        attempt,
        model,
        provider: evalProvider,
        provider_base_url: providerBaseUrl,
        feature_flags_hash: featureFlagsHash,
        attach_mode: 'unknown',
        prompt_version: promptVersion,
        policy_tag: policyTag,
        outcome: 'invalid_run',
        false_complete: 0,
        wrong_tab: 0,
        unapproved_commit: 0,
        latency_ms: 0,
        failure_class: 'env',
        notes: `no runner registered for ${taskId}`,
      })}`,
    });
  }
  if (command.trusted === false) {
    return Promise.resolve({
      code: 2,
      out: `matrix_row ${JSON.stringify({
        task_id: taskId,
        attempt,
        model,
        provider: evalProvider,
        provider_base_url: providerBaseUrl,
        feature_flags_hash: featureFlagsHash,
        attach_mode: inferAttachMode({ script: command.script }),
        prompt_version: promptVersion,
        policy_tag: policyTag,
        outcome: 'invalid_run',
        false_complete: 0,
        wrong_tab: 0,
        unapproved_commit: 0,
        latency_ms: 0,
        failure_class: 'untrusted_oracle',
        evidence_path: '',
        notes: 'task prompt exposes the legacy oracle; excluded fail-closed until dynamic grader lands',
      })}`,
    });
  }
  return new Promise(resolve => {
    const child = spawn(process.execPath, command.script, {
      cwd: projectRoot,
      env: {
        ...process.env,
        ...command.env,
        RUNS: '1',
        EVAL_TASK_ID: taskId,
        EVAL_ATTEMPT: String(attempt),
        MODEL: model,
        MINIMAX_MODEL: model,
        PROVIDER: process.env.PROVIDER || process.env.EVAL_PROVIDER || '',
        EVAL_PROVIDER: process.env.EVAL_PROVIDER || process.env.PROVIDER || '',
        BASE_URL: process.env.BASE_URL || process.env.EVAL_BASE_URL || '',
        EVAL_BASE_URL: process.env.EVAL_BASE_URL || process.env.BASE_URL || '',
        PROMPT_VERSION: promptVersion,
        POLICY_TAG: policyTag,
        EVAL_FEATURE_FLAGS_HASH: featureFlagsHash,
        MATRIX_STAMP: runIdentity.campaign_stamp,
        EVAL_CAMPAIGN_STAMP: runIdentity.campaign_stamp,
        EVAL_ARM_HASH: runIdentity.arm_hash,
        EVAL_RUN_ID: runIdentity.run_id,
        R1_REPORT_DIR: path.join(evidenceDir, 'r1'),
        EVIDENCE_DIR: evidenceDir,
        TRACE_DUMP_DIR: traceDumpDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', chunk => {
      out += chunk;
      process.stdout.write(chunk);
    });
    child.stderr.on('data', chunk => {
      out += chunk;
      process.stderr.write(chunk);
    });
    child.on('close', code => resolve({ code: code ?? 1, out }));
  });
}

async function relativeEvidencePath(filePath) {
  const realFile = await assertRealpathContained(scionRoot, filePath);
  const relative = path.relative(await realpath(scionRoot), realFile);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`evidence path escapes scion root: ${filePath}`);
  }
  return relative.replaceAll(path.sep, '/');
}

async function sha256File(filePath) {
  return sha256(await readFile(filePath));
}

async function collectRunProvenance(trustKey) {
  const currentIdentity = readGitIdentity(scionRoot);
  const status = readWorkspaceStatus(scionRoot);
  const sourceHash = sourceHashAtCommit(scionRoot, gitSha);
  const dist = await distAttestation(scionRoot, projectRoot);
  const attestationPath = process.env.EVAL_BUILD_ATTESTATION
    ? path.resolve(process.env.EVAL_BUILD_ATTESTATION)
    : path.join(scionRoot, 'reports/nanobrowser/eval/build-attestations', `${gitSha}.json`);
  let attestation = null;
  try {
    await assertRealpathContained(scionRoot, attestationPath);
    attestation = JSON.parse(await readFile(attestationPath, 'utf8'));
  } catch {
    // A formal run without eval:build evidence is invalid, never guessed from mtimes.
  }
  const currentManifest = JSON.parse(await readFile(path.join(projectRoot, 'dist/manifest.json'), 'utf8'));
  const attestationValid =
    currentIdentity.git_sha === gitSha &&
    attestation?.schema_version === 'chijie-eval-build-v1' &&
    attestation?.git_sha === currentIdentity.git_sha &&
    attestation?.git_branch === currentIdentity.git_branch &&
    attestation?.source_hash === sourceHash &&
    attestation?.dist_hash === dist.hash &&
    attestation?.extension_version === String(currentManifest.version || '') &&
    attestation?.build_command === 'pnpm build' &&
    attestation?.build_exit_code === 0 &&
    verifyEvalPayloadSignature(attestation, trustKey, 'attestation_hmac') &&
    JSON.stringify(attestation?.dist_files) === JSON.stringify(dist.files) &&
    JSON.stringify(attestation?.runtime_critical_files) === JSON.stringify(dist.runtime_files);
  return {
    dirty_state: status.blocking.length || currentIdentity.git_sha !== gitSha ? 'dirty' : 'clean',
    dirty_policy: 'tracked-and-untracked-with-root-allowlist',
    untracked_exclusions: status.allowedUntracked,
    source_hash: sourceHash,
    dist_hash: dist.hash,
    dist_files: dist.files,
    runtime_critical_files: dist.runtime_files,
    dist_source_state: attestationValid ? 'current' : 'unattested',
    build_attestation_path: attestation ? await relativeEvidencePath(attestationPath) : '',
    extension_version: String(currentManifest.version || ''),
    git_sha_observed: currentIdentity.git_sha,
    git_branch: currentIdentity.git_branch,
    build_attestation_file: attestationValid ? attestationPath : '',
  };
}

async function resolveRunnerEvidence(row) {
  const files = [];
  const errors = [];
  for (const declared of String(row?.evidence_path || '')
    .split(';')
    .map(value => value.trim())
    .filter(Boolean)) {
    const filePath = path.isAbsolute(declared) ? declared : path.resolve(projectRoot, declared);
    try {
      await relativeEvidencePath(filePath);
      if (!(await stat(filePath)).isFile()) throw new Error('not a file');
      files.push(filePath);
    } catch (error) {
      errors.push(`${declared}: ${error.message}`);
    }
  }
  return { files, errors };
}

async function main() {
  if (!Number.isInteger(runs) || runs < 1) throw new Error(`RUNS must be a positive integer, got ${process.env.RUNS}`);
  if (tasks.length === 0) throw new Error('zero tasks selected');
  if (new Set(tasks).size !== tasks.length) throw new Error(`TASKS contains duplicates: ${tasks.join(',')}`);
  if (dryRun) {
    const missing = tasks.filter(taskId => !taskCommands[taskId]);
    console.log(`[eval-matrix] DRY_RUN=1 tasks=${tasks.join(',')}`);
    for (const taskId of tasks) {
      const command = taskCommands[taskId];
      if (!command) {
        console.log(`  FAIL ${taskId}: no runner registered`);
        continue;
      }
      const envKeys = Object.keys(command.env || {});
      console.log(
        `  ${command.trusted === false ? 'WARN' : 'OK  '} ${taskId}: script=${command.script.join(' ')} env=[${envKeys.join(',') || 'none'}]` +
          (command.env?.VERIFY ? ` verify=${command.env.VERIFY}` : '') +
          (command.env?.EXPECTED ? ` expected=${JSON.stringify(command.env.EXPECTED)}` : '') +
          (command.env?.TARGET_URL ? ` target=${command.env.TARGET_URL}` : ''),
      );
    }
    if (missing.length) {
      console.error(`[eval-matrix] missing runners: ${missing.join(', ')}`);
      process.exitCode = 1;
      return;
    }
    console.log('[eval-matrix] dry-run OK');
    process.exitCode = 0;
    return;
  }

  if (reportDir !== canonicalReportDir) {
    throw new Error(`formal matrix REPORT_DIR must be ${canonicalReportDir}`);
  }
  await mkdir(reportDir, { recursive: true });
  await relativeEvidencePath(reportDir);
  const trustKey = await readEvalTrustKey();
  const runProvenance = await collectRunProvenance(trustKey);
  const buildAttestationFile = runProvenance.build_attestation_file;
  delete runProvenance.build_attestation_file;
  const rows = [];
  const manifestAttestations = [];
  for (const taskId of tasks) {
    for (let attempt = 1; attempt <= runs; attempt += 1) {
      console.log(`\n==== ${taskId} attempt ${attempt}/${runs} ====`);
      const startedAt = Date.now();
      const runnerScript = taskCommands[taskId]?.script || [];
      const connectUrl = process.env.CDP_URL || process.env.CONNECT_URL || '';
      const inferredAttachMode = inferAttachMode({
        connectUrl,
        script: runnerScript,
      });
      const armTuple = evalArmTuple({
        git_sha: gitSha,
        model,
        provider: evalProvider,
        provider_base_url: providerBaseUrl,
        feature_flags_hash: featureFlagsHash,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        attach_mode: inferredAttachMode,
      });
      const runIdentity = {
        campaign_stamp: stamp,
        arm_hash: computeEvalArmHash(armTuple),
        run_id: computeEvalRunId({ campaignStamp: stamp, taskId, attempt }),
      };
      const runEvidenceRelativeDir = expectedRunEvidenceRelativeDir(stamp, taskId, attempt);
      const runEvidenceDir = path.join(scionRoot, runEvidenceRelativeDir);
      const supportsTraceDump = runnerScript.some(part =>
        /(?:eval-(?:public|frontier)-task|r1-extract-e2e|action-agent-e2e)\.mjs$/.test(part),
      );
      if (process.env.TRACE_DUMP_DIR) {
        throw new Error('eval:matrix owns TRACE_DUMP_DIR inside the immutable run artifact directory');
      }
      const traceDumpDir = supportsTraceDump ? path.join(runEvidenceDir, 'traces') : '';
      let existingRunFiles = [];
      try {
        existingRunFiles = await listFiles(runEvidenceDir);
      } catch {
        // Directory does not exist yet.
      }
      if (existingRunFiles.length > 0) {
        throw new Error(`refuse to reuse non-empty run evidence directory: ${runEvidenceDir}`);
      }
      await mkdir(runEvidenceDir, { recursive: true });
      const localBuildAttestationFile = path.join(runEvidenceDir, 'build-attestation.json');
      if (buildAttestationFile) await copyFile(buildAttestationFile, localBuildAttestationFile);
      if (traceDumpDir) {
        await mkdir(traceDumpDir, { recursive: true });
        await relativeEvidencePath(traceDumpDir);
      }
      const traceFilesBefore = new Set(traceDumpDir ? await listFiles(traceDumpDir) : []);
      const result = await runTask(taskId, attempt, runEvidenceDir, traceDumpDir, runIdentity);
      const postRunProvenance = await collectRunProvenance(trustKey);
      const latencyMs = Date.now() - startedAt;
      const protocolRows = parseMatrixRows(result.out);
      const protocolLineCount = matrixProtocolCount(result.out);
      const protocolErrors = [];
      if (protocolLineCount !== 1 || protocolRows.length !== 1) {
        protocolErrors.push(
          `expected exactly one matrix_row; lines=${protocolLineCount} parsed=${protocolRows.length}`,
        );
      }
      const rawRow =
        protocolRows.length === 1
          ? protocolRows[0]
          : missingMatrixRow({
              taskId,
              attempt,
              model,
              promptVersion,
              policyTag,
              latencyMs,
              exitCode: result.code,
            });
      if (protocolRows.length === 1) {
        protocolErrors.push(
          ...validateRunnerMatrixRow(rawRow, {
            taskId,
            attempt,
            identity: {
              ...runIdentity,
              model,
              provider: evalProvider,
              provider_base_url: providerBaseUrl,
              feature_flags_hash: featureFlagsHash,
              prompt_version: promptVersion,
              policy_tag: policyTag,
            },
          }),
        );
        if (rawRow.attach_mode !== inferredAttachMode) {
          protocolErrors.push(`attach_mode=${rawRow.attach_mode} expected=${inferredAttachMode}`);
        }
      }
      if (inferredAttachMode !== 'unit' && !String(rawRow.browser_version || '').trim()) {
        protocolErrors.push('browser_version=<missing>');
      }
      const runnerEvidence = await resolveRunnerEvidence(rawRow);
      protocolErrors.push(...runnerEvidence.errors.map(error => `runner evidence ${error}`));
      const manifestPath = path.join(runEvidenceDir, 'matrix-run.json');
      const runArtifactFiles = (await listFiles(runEvidenceDir)).filter(filePath => filePath !== manifestPath);
      const newTraceFiles = traceDumpDir
        ? (await listFiles(traceDumpDir)).filter(filePath => !traceFilesBefore.has(filePath))
        : [];
      if (traceDumpDir && newTraceFiles.length === 0)
        protocolErrors.push('trace requested but no trace artifact emitted');
      const artifactFiles = [...new Set([...runArtifactFiles, ...newTraceFiles, ...runnerEvidence.files])];
      for (const field of ['git_sha_observed', 'git_branch', 'dirty_state', 'source_hash', 'dist_hash']) {
        if (JSON.stringify(postRunProvenance[field]) !== JSON.stringify(runProvenance[field])) {
          protocolErrors.push(`run provenance changed during task: ${field}`);
        }
      }
      const verificationEvidenceFile = artifactFiles.find(filePath => /-verification\.json$/.test(filePath));
      let verificationPayload = null;
      if (verificationEvidenceFile) {
        try {
          verificationPayload = JSON.parse(await readFile(verificationEvidenceFile, 'utf8'));
        } catch {
          protocolErrors.push('verification evidence is malformed JSON');
        }
      }
      let row = canonicalizeMatrixRow(reconcileRunnerExit(rawRow, result.code), {
        taskId,
        attempt,
        gitSha,
        model,
        promptVersion,
        policyTag,
        campaignStamp: runIdentity.campaign_stamp,
        armHash: runIdentity.arm_hash,
        runId: runIdentity.run_id,
      });
      row = {
        date: stamp,
        wave: process.env.WAVE || 'W1',
        ...row,
        ...runIdentity,
        provider: evalProvider,
        provider_base_url: providerBaseUrl,
        feature_flags_hash: featureFlagsHash,
        attach_mode: inferredAttachMode,
        false_complete: [0, 1].includes(Number(row.false_complete)) ? Number(row.false_complete) : 0,
        wrong_tab: [0, 1].includes(Number(row.wrong_tab)) ? Number(row.wrong_tab) : 0,
        unapproved_commit: [0, 1].includes(Number(row.unapproved_commit)) ? Number(row.unapproved_commit) : 0,
        latency_ms: Number.isFinite(Number(row.latency_ms)) ? Number(row.latency_ms) : latencyMs,
      };
      if (
        protocolErrors.length > 0 ||
        runProvenance.dirty_state !== 'clean' ||
        runProvenance.dist_source_state !== 'current'
      ) {
        const reasons = [
          ...protocolErrors,
          ...(runProvenance.dirty_state === 'clean' ? [] : ['tracked working tree is dirty']),
          ...(runProvenance.dist_source_state === 'current' ? [] : ['extension dist is stale']),
        ];
        row = {
          ...row,
          outcome: 'invalid_run',
          failure_class: 'harness_protocol',
          notes: `${row.notes ? `${row.notes}; ` : ''}${reasons.join('; ')}`,
        };
      }
      const evaluatorContract = expectedEvaluatorContract(taskId);
      const evidenceFiles = [];
      for (const filePath of artifactFiles) {
        evidenceFiles.push({
          path: await relativeEvidencePath(filePath),
          sha256: await sha256File(filePath),
          kind: newTraceFiles.includes(filePath)
            ? 'trace'
            : filePath === localBuildAttestationFile
              ? 'build_attestation'
              : /-unit-report\.json$/.test(filePath)
                ? 'unit_report'
                : 'evidence',
        });
      }
      const browserVersion =
        inferredAttachMode === 'unit' ? 'not_applicable' : String(rawRow.browser_version || 'unavailable');
      const applicability = runApplicability({
        taskId,
        command: taskCommands[taskId],
        attachMode: inferredAttachMode,
        verificationPayload,
        outcome: row.outcome,
        unapprovedCommit: row.unapproved_commit,
      });
      const unsignedManifest = {
        schema_version: 'chijie-eval-run-v2',
        ...runIdentity,
        arm_tuple: armTuple,
        task_id: taskId,
        attempt,
        git_sha: gitSha,
        model,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        attach_mode: inferredAttachMode,
        outcome: row.outcome,
        false_complete: row.false_complete,
        wrong_tab: row.wrong_tab,
        unapproved_commit: row.unapproved_commit,
        runner: runnerScript,
        exit_code: result.code,
        started_at: new Date(startedAt).toISOString(),
        latency_ms: latencyMs,
        matrix_row_count: protocolLineCount,
        parsed_matrix_row_count: protocolRows.length,
        trace_requested: Boolean(traceDumpDir),
        trace_dump_dir: traceDumpDir ? await relativeEvidencePath(traceDumpDir) : '',
        browser_version: browserVersion,
        provider: evalProvider,
        provider_base_url: providerBaseUrl,
        feature_flags_hash: featureFlagsHash,
        task_definition_hash: taskDefinitionHashAtCommit(scionRoot, gitSha, taskId),
        evaluator_hash: evaluatorHashAtCommit(scionRoot, gitSha, {
          runner: evaluatorContract.runner,
          verifier: evaluatorContract.verifier,
          taskId,
          suiteFiles: evaluatorContract.suite_files || [],
        }).hash,
        verifier: evaluatorContract.verifier,
        runtime_task_id:
          verificationPayload?.runtime_task_id || (inferredAttachMode === 'unit' ? `unit:${taskId}:${attempt}` : ''),
        allowed_tab_ids: Number.isInteger(verificationPayload?.bound_tab?.id) ? [verificationPayload.bound_tab.id] : [],
        ...applicability,
        evidence_files: evidenceFiles,
        ...runProvenance,
        build_attestation_path: await relativeEvidencePath(localBuildAttestationFile),
      };
      delete unsignedManifest.git_sha_observed;
      const manifest = signEvalPayload(unsignedManifest, trustKey, 'run_hmac');
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
      manifestAttestations.push({
        run_id: runIdentity.run_id,
        path: await relativeEvidencePath(manifestPath),
        sha256: await sha256File(manifestPath),
      });
      row.evidence_path = (await Promise.all([manifestPath, ...artifactFiles].map(relativeEvidencePath))).join(';');
      rows.push(row);
    }
  }

  const headers = [
    'date',
    'campaign_stamp',
    'arm_hash',
    'run_id',
    'wave',
    'task_id',
    'attempt',
    'git_sha',
    'model',
    'provider',
    'provider_base_url',
    'feature_flags_hash',
    'attach_mode',
    'prompt_version',
    'policy_tag',
    'outcome',
    'false_complete',
    'wrong_tab',
    'unapproved_commit',
    'latency_ms',
    'failure_class',
    'evidence_path',
    'notes',
  ];
  await writeFile(csvPath, serializeEvalCsv(headers, rows), 'utf8');
  const persistedRows = parseEvalCsv(await readFile(csvPath, 'utf8'));
  // Debug/model-swap campaigns use the same evidence contract, but only the
  // release gate is allowed to enforce the MiniMax production-arm policy.
  const selfErrors = validateEvalRows(persistedRows, 'matrix', { formalPolicy: false });
  const evidenceValidation = await validateEvidenceRows(persistedRows, { workspaceRoot: scionRoot, label: 'matrix' });
  selfErrors.push(...evidenceValidation.errors);
  if (persistedRows.length !== tasks.length * runs) {
    selfErrors.push(`matrix: expected ${tasks.length * runs} rows, got ${persistedRows.length}`);
  }
  if (selfErrors.length > 0) throw new Error(`matrix self-validation failed:\n${selfErrors.join('\n')}`);

  const metrics = evalMetrics(rows, 3);
  const pass = rows.filter(row => row.outcome === 'verified_pass').length;
  const fail = rows.filter(row => row.outcome === 'fail').length;
  const invalid = rows.filter(row => row.outcome === 'invalid_run').length;
  const failureClasses = Object.fromEntries(
    [...new Set(rows.map(row => row.failure_class).filter(Boolean))].map(key => [
      key,
      rows.filter(row => row.failure_class === key).length,
    ]),
  );
  const falseCompleteCount = rows.reduce((sum, row) => sum + Number(row.false_complete || 0), 0);
  const wrongTabCount = rows.reduce((sum, row) => sum + Number(row.wrong_tab || 0), 0);
  const sideEffectCount = rows.reduce((sum, row) => sum + Number(row.unapproved_commit || 0), 0);
  const evidenceComplete = evidenceValidation.manifests.size;
  const armSummary = JSON.stringify(evalArmTuple(rows[0]));
  const taskAttempts = Object.entries(metrics.tasks)
    .map(
      ([taskId, task]) =>
        `| ${taskId} | ${task.attempts} | ${(task.tsr * 100).toFixed(1)}% | ${task.pass_k === null ? 'n/a' : `${task.pass_k * 100}%`} |`,
    )
    .join('\n');
  const runSummary = rows
    .map(row => `| ${row.task_id} | ${row.attempt} | \`${row.run_id}\` | ${row.outcome} |`)
    .join('\n');
  const summary = `# Eval matrix ${stamp}

- Campaign: ${stamp}
- Git: ${gitSha}
- Arm hash: ${rows[0].arm_hash}
- Arm tuple: \`${armSummary}\`
- Tasks: ${tasks.join(', ')}
- Task set: ${process.env.TASK_SET || (process.env.TASKS ? 'custom-TASKS' : 'default')}
- Model: ${model}
- Provider: ${evalProvider}${evalBaseUrl ? ` (${evalBaseUrl})` : ''}
- Prompt version: ${promptVersion}
- Policy tag: ${policyTag}
- Total rows: ${rows.length}
- Attempts per task: ${runs}
- TSR: ${(metrics.tsr * 100).toFixed(1)}%
- Pass^3: ${metrics.pass_k === null ? 'n/a (requires 3 attempts per task)' : `${(metrics.pass_k * 100).toFixed(1)}%`}
- false_complete: ${falseCompleteCount}
- wrong_tab: ${wrongTabCount}
- out-of-scope side effects: ${sideEffectCount}
- Evidence completeness: ${evidenceComplete}/${rows.length} (${((evidenceComplete / rows.length) * 100).toFixed(1)}%)

| Task | Attempts | TSR | Pass^3 |
|---|---:|---:|---:|
${taskAttempts}

| Task | Attempt | Run ID | Outcome |
|---|---:|---|---|
${runSummary}

| Outcome | Count |
|---|---:|
| verified_pass | ${pass} |
| fail | ${fail} |
| invalid_run | ${invalid} |

## Failure classes

${
  Object.keys(failureClasses).length
    ? Object.entries(failureClasses)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join('\n')
    : '- none'
}

CSV: \`${path.relative(projectRoot, csvPath)}\`
Campaign attestation: \`${path.relative(projectRoot, campaignPath)}\`
`;
  await writeFile(summaryPath, summary, 'utf8');
  const campaignAttestation = signEvalPayload(
    {
      schema_version: 'chijie-eval-campaign-v1',
      campaign_stamp: stamp,
      git_sha: gitSha,
      arm_hash: rows[0].arm_hash,
      arm_tuple: evalArmTuple(rows[0]),
      row_count: rows.length,
      csv_path: await relativeEvidencePath(csvPath),
      csv_sha256: await sha256File(csvPath),
      summary_path: await relativeEvidencePath(summaryPath),
      summary_sha256: await sha256File(summaryPath),
      manifests: manifestAttestations,
      created_at: new Date().toISOString(),
    },
    trustKey,
    'campaign_hmac',
  );
  await writeFile(campaignPath, JSON.stringify(campaignAttestation, null, 2) + '\n', 'utf8');
  const campaignValidation = await validateCampaignCsvAttestation(csvPath, persistedRows, scionRoot, 'matrix');
  if (campaignValidation.errors.length > 0) {
    throw new Error(`campaign self-validation failed:\n${campaignValidation.errors.join('\n')}`);
  }
  console.log(summary);
  process.exitCode = fail > 0 || invalid > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
