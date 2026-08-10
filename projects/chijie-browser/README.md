# 持节 (Chijie) · Chrome extension

运行在用户 Chrome 中的 **长程任务 Agent**（Chrome MV3 侧栏）。

本包基于 [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) 的个人嫁接，产品名为 **持节**。
实验室 monorepo：[yishu-ziyu/scion](https://github.com/yishu-ziyu/scion)。

| 层 | 值 |
|----|-----|
| 产品 | 持节 / Chijie |
| 形态 | Long-horizon task Agent（Mission/Plan、任务级自主、可验证交付） |
| 包名 | `chijie-browser` |
| 版本 | 见 `package.json` |
| Load unpacked | `pnpm build` 后加载 `./dist` |
| 品牌 | [PRODUCT.md](./PRODUCT.md) |

## 产品要点（当前）

- **任务侧栏**：目标、计划阶段、活动步骤、完成回执与证据；对话区不被任务卡压扁。
- **任务级自主**：用户给出目标即授权范围内行动；**不做**逐步“提交前审批”主流程（见 lab `docs/decisions/004`）。
- **完成必须可核对**：仅有 URL 形态不够；**404 /「页面不可用」不会标绿完成**。
- **长程能力**：Mission/Plan、上下文压缩、长程评估迷你集（`021-LH-*`）；正式分绑定 MiniMax-M3。

### 历史评测资产（非北极星）

Claw 30（`docs/product/016`–`018`）与旧 parity 矩阵是 **历史评测 / 参考集**，不是当前产品方向。
当前北极星：`../../docs/product/021-long-horizon-task-agent.md`。

## 环境

- Node `>=22.12.0`（`.nvmrc`）
- 只用 **pnpm**（`package.json` 的 `packageManager`）

## 常用命令

```bash
pnpm install
pnpm build                 # 注入个人密钥 → 清 dist → turbo build
pnpm dev                   # inject + turbo watch
pnpm type-check
pnpm lint
pnpm -F chrome-extension test
pnpm zip                   # build + zip → dist-zip/
```

### 端到端（需 Chrome for Testing / 配置的 CHROME_PATH）

```bash
# fixture 表单 + skill 重跑 + 媒体播停 + 隐私检查
pnpm e2e:action-agent
# 或
pnpm -F chrome-extension e2e:action-agent

# R1 列表 → CSV 成果
pnpm e2e:r1-extract
# 或
pnpm -F chrome-extension e2e:r1-extract
```

Agent 命令细节：[AGENTS.md](./AGENTS.md)。
实验室卫生条：[../../ENGINEERING.md](../../ENGINEERING.md)。

## 目录

```text
chrome-extension/     # MV3 service worker、agent、浏览器控制
  src/background/     # 任务循环、observe-act、DOM/标签
  src/personal/       # MiniMax bootstrap + secrets.local.ts（gitignore）
  scripts/            # action-agent-e2e、r1-extract-e2e 等
  test/fixtures/      # form / media / products 本地页
pages/
  side-panel/         # 主任务 UI
  options/            # 设置
  content/            # 内容脚本（页内「正在替你操作」等）
packages/             # i18n、storage、ui、schema-utils…
dist/                 # 构建产物 — Load unpacked 指向这里
```

## 密钥

不要提交密钥。

```bash
cp chrome-extension/src/personal/secrets.local.example.ts \
   chrome-extension/src/personal/secrets.local.ts
# 填值，或使用 lab 文档中的 inject:personal / 环境源
```

分析类 env 示例：[`.env.example`](./.env.example)。

## 产品文档（lab 根）

| 文档 | 用途 |
|------|------|
| `../../AGENTS.md` | 事实源优先级（硬规则） |
| `../../CONTEXT.md` | 词汇：Task、receipt、external_commit… |
| `../../docs/product/021-long-horizon-task-agent.md` | **当前北极星** |
| `../../docs/decisions/004-task-scoped-autonomy.md` | 任务级自主 |
| `../../docs/product/020-eval-master.md` | 评估契约 |
| `../../docs/DOCS_INDEX.md` | 编号文档索引 |
| `../../docs/upstream/nanobrowser/` | 上游营销归档 |

## License

见 [LICENSE](./LICENSE)（嫁接保留上游 Nanobrowser 许可）。
