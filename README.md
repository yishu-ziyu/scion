# scion · 持节

个人实验室 monorepo：**持节 (Chijie)** — 运行在用户 Chrome 中的 **长程任务 Agent**（MV3 扩展）。

**scion**（接穗）：嫁接在开源砧木上。当前唯一活着的扩展嫁接是 `projects/chijie-browser/`（Nanobrowser 衍生）。

维护：yishu-ziyu · 远程：https://github.com/yishu-ziyu/scion

## 仓库是什么

| 路径 | 角色 |
|------|------|
| `projects/chijie-browser/` | 唯一扩展 monorepo（改代码 / 构建 / Load unpacked `dist/`） |
| `docs/` | 产品、设计、决策（见索引） |
| `reports/` | E2E / 跑分证据（目录名 `nanobrowser` 为历史遗留） |
| `experiments/` | 可选 bake-off；不是交付主路径 |

**一句话产品：** 用户交出自然语言长程目标；Agent 在日常 Chrome 里拆计划、自主跨页执行、保持上下文；**只有页面证据通过才算完成**（模型说 done 不够）。任务级授权，**不**做逐步审批。

## 事实源优先级（冲突时谁赢）

```text
021 长程任务 Agent 北极星
  → decisions/004 任务级自主
  → 020 评估协议与 task_id
  → 019 Harness / Eval / 外环路线
  → run_state.yaml 执行状态（不得与上冲突）
```

历史文档（003 / 011 / 016 / 017 / 018 等）可保留研究价值，**不得**覆盖上列。
完整规则：[AGENTS.md](./AGENTS.md)。

## 当前进度（摘要）

权威产品目标：[`docs/product/021-long-horizon-task-agent.md`](./docs/product/021-long-horizon-task-agent.md)
执行状态：`.ship/tasks/plan-large-nanobrowser-second-development/control/run_state.yaml`

| 项 | 状态（以 2026-08-06 证据为准） |
|----|------|
| 任务级自主（无默认审批门） | **已落地**（decision 004） |
| Mission / Plan + 长程上下文压缩 | **已落地**（确定性 archive + plan memory） |
| 长程迷你集 `021-LH-01..03` | **正式批通过**（见 agent-book 迭代报告） |
| Outer-loop Skill 候选 | **已跑**（`reports/nanobrowser/outer-rl/skills/candidates/`） |
| Claw 30（016/017/018） | **历史评测资产 / 参考集**，非当前北极星 |

证据入口：`reports/nanobrowser/agent-book-iteration/2026-08-06-iteration-report.md`。

## 从这里开始

| 文档 | 何时看 |
|------|--------|
| [AGENTS.md](./AGENTS.md) | Agent 硬规则与事实源链 |
| [ENGINEERING.md](./ENGINEERING.md) | 卫生条、布局、git |
| [CONTEXT.md](./CONTEXT.md) | 产品词汇 |
| [docs/DOCS_INDEX.md](./docs/DOCS_INDEX.md) | 编号产品/设计文档 |
| [HANDOVER.md](./HANDOVER.md) | MiniMax 注入、CDP、日志 |
| [projects/chijie-browser/PRODUCT.md](./projects/chijie-browser/PRODUCT.md) | 品牌命名 |
| [projects/chijie-browser/README.md](./projects/chijie-browser/README.md) | 扩展命令与布局 |

## 快速开始（扩展）

```bash
cd projects/chijie-browser   # 或 ~/projects/chijie-browser（若有 symlink）
pnpm install
# 密钥（gitignore）：chrome-extension/src/personal/secrets.local.ts
pnpm build
```

Chrome → **扩展程序 → 加载已解压的扩展程序** →
`projects/chijie-browser/dist`

```bash
pnpm type-check
pnpm lint
pnpm -F chrome-extension test
pnpm e2e:action-agent    # fixture 表单 + skill + 媒体
pnpm e2e:r1-extract      # 列表抽 CSV
pnpm dev                 # watch
```

Node `>=22.12.0`，只用 **pnpm**（见扩展树 `.nvmrc`）。

## 本机路径

```text
/Users/mahaoxuan/Desktop/AI产品经理/自研产品/scion
```

可选 symlink：

- `~/projects/scion` → 本目录
- `~/projects/chijie-browser` → `projects/chijie-browser`
- `~/projects/oss-forks` → 本目录（旧别名）

**只有这一棵树。** 不要在仓库外再复制整份扩展。

## 上游

砧木：[nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser)。
冻结的上游营销副本：[docs/upstream/nanobrowser/](./docs/upstream/nanobrowser/)。

## License

扩展嫁接保留上游 LICENSE：`projects/chijie-browser/LICENSE`。
本根下的 lab 文档与产品文字由维护者管理。
