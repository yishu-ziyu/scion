# scion · 持节

个人实验室 monorepo：**持节 (Chijie)** — Chrome MV3 浏览器行动 Agent。

**scion**（接穗）：嫁接在开源砧木上。当前唯一活着的扩展嫁接是 `projects/chijie-browser/`（Nanobrowser 衍生）。

维护：yishu-ziyu · 远程：https://github.com/yishu-ziyu/scion

## 仓库是什么

| 路径 | 角色 |
|------|------|
| `projects/chijie-browser/` | 唯一扩展 monorepo（改代码 / 构建 / Load unpacked `dist/`） |
| `docs/` | 产品、设计、决策（见索引） |
| `reports/` | E2E / 跑分证据（目录名 `nanobrowser` 为历史遗留） |
| `experiments/` | 可选 bake-off；不是交付主路径 |

**一句话产品：** 在日常 Chrome 里做多步网页任务；步骤人话可读；不可逆提交要审批；**只有页面证据通过才算完成**（404 假完成已堵）。

## 当前进度（摘要）

权威记分：[`docs/product/018-claw-30-live-scorecard.md`](./docs/product/018-claw-30-live-scorecard.md)

| 项 | 状态 |
|----|------|
| O1 表单填→批→提交 | **pass**（fixture e2e） |
| R1 列表→CSV | **partial**（本地列表 e2e；非 Amazon） |
| 其余 Claw 30 | 多为 **not_run** |
| 媒体播/停 e2e | 全绿（非 30 目录条目） |
| 侧栏 | feature-first 任务卡 + 审批/活动/完成；文案去居高临下括号说明 |

证据：`reports/nanobrowser/claw-30/`。  
个性化 / 更深 Jarvis 叙事：**不得**抢在 018 关键路径之前。

## 从这里开始

| 文档 | 何时看 |
|------|--------|
| [ENGINEERING.md](./ENGINEERING.md) | 卫生条、布局、git |
| [AGENTS.md](./AGENTS.md) | 写代码的 Agent 规则 |
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
pnpm e2e:action-agent    # 表单 + skill + 媒体
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
