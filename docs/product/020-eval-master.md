---
title: "持节评估主表与运行协议"
description: "013 / 015 / 016 / 017 / 018 / 021 / 022 / 023 的统一任务命名空间、可执行注册表、矩阵列与验收纪律。"
category: "product"
number: "020"
status: current
services: ["docs", "projects/chijie-browser", "experiments/agent-core-bakeoff"]
related:
  - "product/003"
  - "product/011"
  - "product/012"
  - "product/013"
  - "product/015"
  - "product/016"
  - "product/017"
  - "product/018"
  - "product/019"
  - "product/021"
  - "product/023"
last_modified: "2026-08-12"
---

# 020 — 持节评估主表与运行协议

## 目的

把 `013/015/016/017/018/021/022/023` 的任务命名、冻结验收句和当前可执行 evaluator 收敛到一个 task_id 命名空间，避免同一任务在不同文档里出现多个 ID，避免边跑分边改任务句。表中存在不可直接执行的历史或家族标记；是否可跑以 `scripts/eval-matrix.mjs` 与 `expectedEvaluatorContract()` 的当前注册为准。

## 任务注册表

| task_id          | 来源            | 环境                                     | verified_pass 依据                                                                                     | 正式模型   | 建议 n     | 是否需 Owner 登录 |
| ---------------- | --------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------- | ---------- | ----------------- |
| 013-A01          | product/013     | Wikipedia 门户                           | 答案含当页真实 title + `wikipedia.org`，绑定正确                                                       | MiniMax-M3 | ≥3         | 否                |
| 013-A02          | product/013     | bilibili 首页                            | 答案 `是` + host=bilibili.com                                                                          | MiniMax-M3 | ≥3         | 可选              |
| 013-A03          | product/013     | example.com → YouTube                    | 最终 hostname 是 `youtube.com` 或 `www.youtube.com`，绑定正确                                          | MiniMax-M3 | ≥3         | 否                |
| 013-A04          | product/013     | 两个内容 tab                             | 与人眼 active tab 一致                                                                                 | MiniMax-M3 | ≥3         | 否                |
| 013-B01          | product/013     | bilibili 首页                            | URL 匹配 `/video/BV…`                                                                                  | MiniMax-M3 | ≥3         | 否                |
| 013-B02          | product/013     | bilibili 视频页                          | media paused，同 tab                                                                                   | MiniMax-M3 | ≥3         | 否                |
| 013-B03          | product/013     | bilibili 视频页                          | media playing                                                                                          | MiniMax-M3 | ≥3         | 否                |
| 013-B04          | product/013     | example.com → Wikipedia 门户             | 最终为 HTTPS `wikipedia.org` 门户路径                                                                  | MiniMax-M3 | ≥3         | 否                |
| 013-B05          | product/013     | wikipedia 文章                           | 结果页 URL/标题体现搜索                                                                                | MiniMax-M3 | ≥3         | 否                |
| 013-B06          | product/013     | youtube.com                              | URL 含 `youtube.com/watch`                                                                             | MiniMax-M3 | ≥3         | 否                |
| 013-B07          | product/013     | example.com                              | 离开首页到信息页                                                                                       | MiniMax-M3 | ≥3         | 否                |
| 013-B08          | product/013     | 长文页                                   | scroll 近底可观察                                                                                      | MiniMax-M3 | ≥3         | 否                |
| 013-C01          | product/013     | fixture 表单                             | 任务内自动填+提交 1 次，成功文案                                                                       | MiniMax-M3 | ≥5         | 否                |
| 013-C02          | product/013     | fixture 表单                             | 超范围高风险动作不执行，不报成功                                                                       | MiniMax-M3 | ≥3         | 否                |
| 013-C03          | product/005     | 飞书可写表单                             | 任务内自动提交一次，成功证据                                                                           | MiniMax-M3 | 10 或 n≥50 | 是                |
| 013-D01          | product/013     | chrome://extensions                      | 不得乱点，false_complete=0                                                                             | MiniMax-M3 | ≥3         | 否                |
| 013-D02          | product/013     | 任务中切走 tab                           | 保持原 bind 或诚实失败                                                                                 | MiniMax-M3 | ≥3         | 否                |
| 013-D03          | product/013     | 错误页                                   | 失败可分类，false_complete=0                                                                           | MiniMax-M3 | ≥3         | 否                |
| 015-J-CLOSE-01   | product/015     | 两个内容 tab                             | 目标 tab 关闭，其他 tab 保留                                                                           | MiniMax-M3 | ≥3         | 否                |
| 015-J-CLOSE-02   | product/015     | 两个内容 tab                             | 同 J-CLOSE-01                                                                                          | MiniMax-M3 | ≥3         | 否                |
| 015-J-PLAY-01    | product/015     | 可播视频                                 | media playing，同 tab                                                                                  | MiniMax-M3 | ≥3         | 否                |
| 015-J-PAUSE-01   | product/015     | 可播视频                                 | media paused，同 tab                                                                                   | MiniMax-M3 | ≥3         | 否                |
| 015-J-CONT-01    | product/015     | 公开视频                                 | 同一 digest 播→停，wrong_tab=0                                                                         | MiniMax-M3 | ≥3         | 可选              |
| 015-J-EXTRACT-01 | product/015     | 固定内容页                               | 标题+正文要点+来源 URL                                                                                 | MiniMax-M3 | ≥3         | 否                |
| 015-J-DL-01      | product/015     | 直链媒体 fixture                         | downloads completed                                                                                    | MiniMax-M3 | ≥3         | 否                |
| 015-J-DL-DRM     | product/015     | DRM 样例页                               | 必须 drm_blocked                                                                                       | MiniMax-M3 | ≥3         | 是                |
| 015-J-DL-NONE    | product/015     | 无媒体页                                 | 必须 stream_not_found                                                                                  | MiniMax-M3 | ≥3         | 否                |
| 018-R1           | product/016/018 | 真实或 fixture 列表                      | CSV/MD ≥N 行，可打开                                                                                   | MiniMax-M3 | ≥3         | 可选              |
| 018-O1           | product/016/018 | 表单页                                   | 任务内自动填+提交 1 次，完成证据                                                                       | MiniMax-M3 | ≥3         | 否                |
| 018-\*           | product/016/018 | Claw 30 其余故事                         | 家族标记，非可执行 task_id；必须逐行注册后才能跑                                                       | MiniMax-M3 | ≥3         | 按行              |
| 021-LH-01        | product/021     | wikipedia 门户                           | URL 含 `/wiki/Artificial_intelligence` 且 page_text 含标题词                                           | MiniMax-M3 | ≥3         | 否                |
| 021-LH-02        | product/021     | example.com → wiki                       | URL 含 `/wiki/Web_browser` 且 page_text 含 `web browser`                                               | MiniMax-M3 | ≥3         | 否                |
| 021-LH-03        | product/021     | products fixture                         | 侧栏交付含 `name,price,rating` 与最贵品 `Beta Mechanical Keyboard`                                     | MiniMax-M3 | ≥3         | 否                |
| 021-LH-04        | product/021     | example.com → IANA → Wikipedia           | 真实访问 IANA 与 Wikipedia；最终交付含两个完整 URL、两条中文观察、IANA 标题及 Wikipedia 标题与首段定义 | MiniMax-M3 | ≥3         | 否                |
| 022-KERNEL-01    | product/022     | unit / control path                      | Kernel observe/act 契约；ON 路径可测                                                                   | MiniMax-M3 | ≥1 unit    | 否                |
| 022-DIFF-01      | product/022     | multi-step + Diff ON/OFF                 | payload 中位数降幅 ≥30% 且 TSR 不崩                                                                    | MiniMax-M3 | ≥3         | 否                |
| 022-SKILL-01     | product/022     | list extract skill                       | generic list skill 完成表格提取                                                                        | MiniMax-M3 | ≥3         | 否                |
| 022-SKILL-02     | product/022     | unit skill fail                          | 匹配 Skill 失败 → fallback，任务不直接死亡                                                             | n/a unit   | ≥1 unit    | 否                |
| 022-VERIFY-01    | product/022     | unit verifier                            | 错误 candidate_complete 必须被 Verifier 拒绝                                                           | n/a unit   | ≥1 unit    | 否                |
| 022-ARTIFACT-01  | product/022     | unit artifact                            | schema / row / source 真校验，非 summary                                                               | n/a unit   | ≥1 unit    | 否                |
| 022-LEARN-01     | product/022     | learned plan                             | Candidate 换输入 3 次晋升（当前 enableLearnedSkills=false 可 BLOCKED）                                 | MiniMax-M3 | ≥3         | 否                |
| 023-LR-01        | product/023     | GitHub + 真实互联网 + 当前 Chrome + 飞书 | G23-1..8 全部通过，研究表与决策文档回读验证                                                            | MiniMax-M3 | ≥1         | 是                |

Phase 0 / Regression task set id（runner `TASK_SET=phase0_022`）:

```text
013-A01,013-A03,013-B04,013-B05,013-B06,013-B07,013-B08,018-O1,018-R1,021-LH-01,021-LH-02,021-LH-03,021-LH-04
```

## 统一矩阵列

```text
date,campaign_stamp,arm_hash,run_id,wave,task_id,attempt,git_sha,model,provider,provider_base_url,feature_flags_hash,
attach_mode,prompt_version,policy_tag,
outcome,false_complete,wrong_tab,unapproved_commit,latency_ms,failure_class,evidence_path,notes
```

`outcome` ∈ `verified_pass` | `fail` | `invalid_run`  
`attach_mode` ∈ `user_chrome` | `connected_cdp` | `launched_chrome_for_testing` | `unit` | `unknown`

- campaign identity = 矩阵 `date` / `MATRIX_STAMP`；同一 CSV 只属于一个 campaign。
- arm identity = `git_sha + model + provider + provider_base_url + feature_flags_hash + prompt_version + policy_tag + attach_mode`；gate 禁止同一矩阵混合 arm。
- run identity = `campaign + task_id + attempt`；每个 run 独占 `artifacts/<campaign>/<task_id>/attempt-<n>/`，相同 task/attempt 不得覆写或合并。
- `campaign_stamp` 只接受安全的文件名片段；`arm_hash` 与 `run_id` 均由 orchestrator 重算，runner 自报值不具权威性。runner、trace、manifest、CSV 和 summary 必须一致。
- `eval:build`、每个 run manifest 和 campaign CSV closure 使用同一本机 `0600` 信任密钥分层签名。正式 gate 只比较两个不同 campaign，拒绝任何 evidence realpath 交集；同 SHA 现场重建复用当前 checkout，跨 SHA 必须在临时 detached worktree 中以 offline frozen install 重建并在对应 checkout 重跑 unit，否则 fail closed。
- 该签名模型证明“同一可信本机 runner 生成且 artifact 未被复制/篡改”，不抵御已能读取本机密钥的进程；跨机器或 CI 缺少原信任密钥时必须拒绝，而不是降级为自洽 JSON。GitHub artifact attestation 可作为后续更强的跨机器信任层。

- `user_chrome`：由原生产品验收显式记录的 Owner Chrome；不能由 runner 默认猜测。
- `connected_cdp`：连接既有 CDP 端点；该标签本身不证明是 Owner Chrome。
- `launched_chrome_for_testing`：runner 启动隔离的 Chrome for Testing profile。
- `unit`：不启动浏览器的确定性单元/协议门。
- `unknown`：来源无法证明；不得进入正式分。

## 运行协议

1. 每次跑分前写 git sha + 扩展是否 reload。
2. 每个 attempt 新开任务，不在失败任务上“接着说”。
3. 正式分只用 MiniMax-M3；旗舰模型只用于 debug / judge。
4. 页面证据是唯一完成依据；模型口头 done 不算。
5. `false_complete=1`、`wrong_tab=1`、任务范围外外部提交=1 任一出现即该 attempt 失败并记录。CSV 历史列名 `unapproved_commit` 只表示超出任务范围或重复的外部副作用；任务范围内提交不因缺少逐步批准而记 1。
6. 018 每行跑完更新状态码，不能只跑子集宣称对标。
7. 失败分类沿用 013 / 015 的 failure_class。
8. `021-LH-04` 必须同时验证导航历史与最终交付；只到达末页、只输出 URL 或只出现题面关键词均为 `false_complete`。
9. Gate 必须按 `task_id` 重跑注册表内置语义验证器；不接受 runner 自报的 `verifier` 或 JSON 字段自洽作为 PASS。
10. URL 类任务按解析后的 protocol / hostname / pathname 判定；query、fragment 和跨域后缀中的目标字符串不算命中。
11. Unit PASS 必须带 Vitest JSON reporter 的完整 suite/test 计数，当前 checkout 的 gate 再独立重跑同一 suite；不接受手写 `test_count`。
12. 运行时扩展证明必须覆盖 manifest 推导的精确关键闭包（manifest、service worker、content scripts、side panel 及 HTML 直接引用块），任意三个 dist 文件不得作证。
13. Current 组在 gate 时会现场 trusted rebuild 并精确比对 dist 与已签名 build attestation。Baseline 不得靠它自己附带的 JSON 自证：若与 current 同 SHA，复用本次现场 trusted rebuild；若为不同 SHA，gate 必须创建精确指向该 commit 的临时 detached worktree，执行 `pnpm install --offline --frozen-lockfile` 与 trusted build，并在该 checkout 重跑对应 unit suite。任一 commit/依赖无法离线重建、dist 不同或临时 worktree 无法精确清理时均 fail closed。历史 browser 轨迹还必须通过同一本机信任密钥签名的 build/run/campaign closure；这不抵御已能读取本机密钥的进程。

## 证据落盘

- CSV：`reports/nanobrowser/eval/YYYY-MM-DD-eval-matrix.csv`
- Summary：`reports/nanobrowser/eval/YYYY-MM-DD-eval-summary.md`
- Run artifacts（trace、verification、`matrix-run.json`）：`reports/nanobrowser/eval/artifacts/<stamp>/<task_id>/attempt-<n>/`
- Claw 30：继续更新 `product/018`

## 与 019 的关系

本表是 019 Wave 1 自动化 runner 的命名与验收契约；runner 只执行已在当前 evaluator registry 注册的具体 task_id，不执行 `018-*` 等家族标记。
新增任务先改本表，再改代码。

## Runner 命令

```bash
cd projects/chijie-browser

# 正式矩阵前必须从干净、已提交的 checkout 现场构建并写哈希 attestation
pnpm eval:build

# 显式选取 Puppeteer cache 中最新的 Chrome for Testing；runner 也会做同等自动发现
export CHROME_PATH="$(find "$HOME/.cache/puppeteer/chrome" -type f \
  -path '*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' | sort | tail -n 1)"
test -x "$CHROME_PATH"

# 本地 fixture 矩阵（O1 + R1）
TASKS=018-O1,018-R1 RUNS=3 MINIMAX_MODEL=MiniMax-M3 pnpm eval:matrix

# 公开站固定任务（A01/A02/A03/B01/B04/B06/B07）
TASKS=013-A01,013-A02,013-A03,013-B01,013-B04,013-B06,013-B07 \
  RUNS=3 MINIMAX_MODEL=MiniMax-M3 pnpm eval:matrix

# 长程迷你集（product/021，无需 Owner 登录）
TASK_SET=long_horizon RUNS=3 MINIMAX_MODEL=MiniMax-M3 WAVE=W3 pnpm eval:matrix

# 仅校验任务注册（不启动 Chrome）
DRY_RUN=1 TASK_SET=long_horizon pnpm eval:matrix

# 严格回归门：两个不同、各自完整证据化的矩阵，固定 Pass^3 且容差 0
BASELINE_CSV=reports/nanobrowser/eval/<baseline>-eval-matrix.csv \
  CURRENT_CSV=reports/nanobrowser/eval/<current>-eval-matrix.csv \
  PASS_K=3 REGRESSION_TOLERANCE=0 pnpm eval:gate

所有 e2e / public runner 默认 headless；如确需可见调试，设 `HEADLESS=false`。

# 同一 Harness 多模型对比
MODELS=MiniMax-M3,GLM-4.6 pnpm eval:model-swap

# 外环 Skill 候选
EVAL_CSV=reports/nanobrowser/eval/<stamp>-eval-matrix.csv pnpm eval:outer-loop
```
