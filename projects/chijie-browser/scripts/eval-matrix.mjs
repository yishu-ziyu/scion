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
import { spawn, spawnSync } from 'node:child_process';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const reportDir = process.env.REPORT_DIR
  ? path.resolve(process.env.REPORT_DIR)
  : path.resolve(projectRoot, '../../reports/nanobrowser/eval');

/** Named task sets. TASKS=... overrides TASK_SET when both are set. */
const TASK_SETS = {
  default: ['018-O1', '018-R1'],
  fixture: ['018-O1', '018-R1'],
  public_ab: ['013-A01', '013-A02', '013-A03', '013-B01', '013-B04', '013-B05', '013-B06', '013-B07', '013-B08'],
  // product/021 long-horizon mini set: multi-phase, no Owner login
  long_horizon: ['021-LH-01', '021-LH-02', '021-LH-03'],
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
};

function resolveTasks() {
  if (process.env.TASKS) {
    return process.env.TASKS.split(',')
      .map(item => item.trim())
      .filter(Boolean);
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
const runs = Number(process.env.RUNS || 1);
const model = process.env.MODEL || process.env.MINIMAX_MODEL || 'MiniMax-M3';
const evalProvider = process.env.EVAL_PROVIDER || process.env.PROVIDER || 'minimax';
const evalBaseUrl = process.env.EVAL_BASE_URL || process.env.BASE_URL || '';
const promptVersion = process.env.PROMPT_VERSION || 'chijie-control-v0.3.0';
const policyTag = process.env.POLICY_TAG || 'baseline';
const dryRun = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';
const gitSha =
  process.env.GIT_SHA ||
  (() => {
    try {
      const result = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
        cwd: projectRoot,
        encoding: 'utf8',
      });
      return result.stdout?.trim() || '';
    } catch {
      return '';
    }
  })();
const stamp =
  process.env.MATRIX_STAMP ||
  new Date().toISOString().slice(0, 10) + '-' + new Date().toISOString().slice(11, 19).replaceAll(':', '');
const csvPath = path.join(reportDir, `${stamp}-eval-matrix.csv`);
const summaryPath = path.join(reportDir, `${stamp}-eval-summary.md`);

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
      GOAL:
        '进入英文维基；搜索并打开 Artificial intelligence 条目；确认 URL 在 wiki/Artificial_intelligence 后再完成。不要在门户或搜索结果列表页报完成。',
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
      GOAL:
        '离开 example.com；打开 https://en.wikipedia.org/wiki/Web_browser ；确认页面正文含 web browser 后再完成。不要把普通维基页面当成登录墙。',
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
      GOAL:
        '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取至少 5 行 name,price,rating 表格；3) 在回复中写出最贵商品的名称（应为 Beta Mechanical Keyboard）与价格。表格头必须含 name,price,rating。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'name,price,rating||Beta Mechanical Keyboard',
      E2E_TIMEOUT_MS: '180000',
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
      GOAL:
        '这是一个多阶段任务：1) 阅读当前产品列表页；2) 提取至少 5 行 name,price,rating 表格；3) 在回复中写出最贵商品的名称（应为 Beta Mechanical Keyboard）与价格。表格头必须含 name,price,rating。',
      VERIFY: 'body_contains_all',
      EXPECTED: 'name,price,rating||Beta Mechanical Keyboard',
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
};

function runTask(taskId, attempt) {
  const command = taskCommands[taskId];
  if (!command) {
    return Promise.resolve({
      code: 2,
      out: `matrix_row ${JSON.stringify({
        task_id: taskId,
        attempt,
        model,
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
  return new Promise(resolve => {
    const child = spawn(process.execPath, command.script, {
      cwd: projectRoot,
      env: {
        ...process.env,
        RUNS: '1',
        EVAL_TASK_ID: taskId,
        MODEL: model,
        MINIMAX_MODEL: model,
        PROVIDER: process.env.PROVIDER || process.env.EVAL_PROVIDER || '',
        EVAL_PROVIDER: process.env.EVAL_PROVIDER || process.env.PROVIDER || '',
        BASE_URL: process.env.BASE_URL || process.env.EVAL_BASE_URL || '',
        EVAL_BASE_URL: process.env.EVAL_BASE_URL || process.env.BASE_URL || '',
        PROMPT_VERSION: promptVersion,
        POLICY_TAG: policyTag,
        R1_REPORT_DIR: path.join(reportDir, 'r1', taskId),
        ...command.env,
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

function parseRows(out, fallbackRow) {
  const rows = [];
  const re = /matrix_row\s+(\{[\s\S]*?\})/g;
  for (const match of out.matchAll(re)) {
    try {
      rows.push(JSON.parse(match[1]));
    } catch {
      // ignore malformed row
    }
  }
  return rows.length > 0 ? rows : [fallbackRow];
}

async function main() {
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
        `  OK   ${taskId}: script=${command.script.join(' ')} env=[${envKeys.join(',') || 'none'}]` +
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

  await mkdir(reportDir, { recursive: true });
  const header =
    'date,wave,task_id,attempt,git_sha,model,attach_mode,prompt_version,policy_tag,outcome,false_complete,wrong_tab,unapproved_commit,latency_ms,failure_class,evidence_path,notes\n';
  await writeFile(csvPath, header, 'utf8');

  const rows = [];
  for (const taskId of tasks) {
    for (let attempt = 1; attempt <= runs; attempt += 1) {
      console.log(`\n==== ${taskId} attempt ${attempt}/${runs} ====`);
      const startedAt = Date.now();
      const result = await runTask(taskId, attempt);
      const fallback = {
        task_id: taskId,
        attempt,
        model,
        prompt_version: promptVersion,
        policy_tag: policyTag,
        outcome: result.code === 0 ? 'verified_pass' : 'fail',
        false_complete: 0,
        wrong_tab: 0,
        unapproved_commit: 0,
        latency_ms: Date.now() - startedAt,
        failure_class: result.code === 0 ? '' : 'other',
        notes: `exit=${result.code}`,
      };
      const parsed = parseRows(result.out, fallback).map(row => ({
        date: stamp,
        wave: process.env.WAVE || 'W1',
        git_sha: gitSha,
        attach_mode: process.env.ATTACH_MODE || 'user_chrome',
        evidence_path: '',
        ...row,
      }));
      for (const row of parsed) {
        rows.push(row);
        await appendFile(
          csvPath,
          [
            row.date,
            row.wave,
            row.task_id,
            row.attempt,
            row.git_sha,
            row.model,
            row.attach_mode,
            row.prompt_version,
            row.policy_tag,
            row.outcome,
            row.false_complete ?? 0,
            row.wrong_tab ?? 0,
            row.unapproved_commit ?? 0,
            row.latency_ms ?? '',
            row.failure_class ?? '',
            row.evidence_path ?? '',
            String(row.notes ?? '')
              .replaceAll(',', ';')
              .replace(/\r?\n/g, ' '),
          ].join(',') + '\n',
          'utf8',
        );
      }
    }
  }

  const pass = rows.filter(row => row.outcome === 'verified_pass').length;
  const fail = rows.filter(row => row.outcome === 'fail').length;
  const invalid = rows.filter(row => row.outcome === 'invalid_run').length;
  const failureClasses = Object.fromEntries(
    [...new Set(rows.map(row => row.failure_class).filter(Boolean))].map(key => [
      key,
      rows.filter(row => row.failure_class === key).length,
    ]),
  );
  const summary = `# Eval matrix ${stamp}

- Tasks: ${tasks.join(', ')}
- Task set: ${process.env.TASK_SET || (process.env.TASKS ? 'custom-TASKS' : 'default')}
- Model: ${model}
- Provider: ${evalProvider}${evalBaseUrl ? ` (${evalBaseUrl})` : ''}
- Prompt version: ${promptVersion}
- Policy tag: ${policyTag}
- Total rows: ${rows.length}

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
`;
  await writeFile(summaryPath, summary, 'utf8');
  console.log(summary);
  process.exitCode = fail > 0 || invalid > 0 ? 1 : 0;
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
