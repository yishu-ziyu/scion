# 持节 (Chijie) · Chrome extension

可验证的 **浏览器行动 Agent**（Chrome MV3 侧栏）。

本包基于 [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser) 的个人嫁接，产品名为 **持节**。  
实验室 monorepo：[yishu-ziyu/scion](https://github.com/yishu-ziyu/scion)。

| 层 | 值 |
|----|-----|
| 产品 | 持节 / Chijie |
| 包名 | `chijie-browser` |
| 版本 | 见 `package.json` |
| Load unpacked | `pnpm build` 后加载 `./dist` |
| 品牌 | [PRODUCT.md](./PRODUCT.md) |

## 产品要点（当前）

- **任务侧栏**：目标、活动步骤、提交前审批、完成回执与证据；对话区不被任务卡压扁。
- **Feature-first UI**：先用户目标与路径，再映射现有 `chijie-*` 组件（见 lab `docs/design/006`）。
- **完成必须可核对**：仅有 URL 形态不够；**404 /「页面不可用」不会标绿完成**。
- **确定性捷径（fixture / 常见句）**：表单填+批提交（O1）、列表抽 CSV（R1 tracer）、媒体播停、理解类问答等。

### Claw 30 记分（lab）

权威表：`../../docs/product/018-claw-30-live-scorecard.md`  
证据目录：`../../reports/nanobrowser/claw-30/`

| 状态（约） | 含义 |
|------------|------|
| O1 **pass** | 本地表单：填 → 提交前停 → 批 1 次 → 完成 |
| R1 **partial** | 本地商品列表抽出 CSV（非 Amazon 真机） |
| 其余 | 多为 `not_run`；个性化工作不得抢在全表之前 |

随机真机问题以你的反馈为准；日常扩展会话日志默认**不会**自动进仓库。

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
# 表单审批 + skill 重跑 + 媒体播停 + 隐私检查
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
| `../../CONTEXT.md` | 词汇：Task、receipt、external_commit… |
| `../../docs/DOCS_INDEX.md` | 编号文档索引 |
| `../../docs/product/018-claw-30-live-scorecard.md` | Claw 30 真机记分 |
| `../../docs/design/004-chijie-calm-task-console.md` | 侧栏视觉/三态 |
| `../../docs/design/005-chijie-task-ux-from-claw.md` | 任务 UX 契约 |
| `../../docs/design/006-feature-first-sidepanel-flows.md` | 功能→流→原子映射 |
| `../../docs/upstream/nanobrowser/` | 上游营销归档 |

## License

见 [LICENSE](./LICENSE)（嫁接保留上游 Nanobrowser 许可）。
