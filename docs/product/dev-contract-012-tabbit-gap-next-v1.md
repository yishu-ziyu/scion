---
title: "dev-contract-012 tabbit gap next knife v1"
status: frozen
version: v1
owner: G1
spec_author: G2
implementer: G3
verifier: G4
created: "2026-07-16"
depends_on: "docs/product/009-tabbit-gap-ledger.md"
after: "ticket-06 Feishu Slice B (product order; not a code dep)"
alternate_deferred: "context tray (tabs+selection) → contract-013 候选"
---

# Contract 012-v1 — Tabbit 缩差下一刀：多源读取 → 结构化结果

## 问题（G1）

06（飞书真实填写—批准—单次提交）回答「能不能把一件网页工作交给持节」。
06 之后，用户仍停在「点完网页」：没有**可带走的工作成果**。

**本刀问题：** 当用户给出 2–N 个公开可读来源（URL / 已打开标签页 URL）并要求整理时，持节必须产出**结构化结果**（侧栏可见 + 可复制 Markdown），而不是只报「任务完成」或一串动作日志。

> **刀选（冻结）：** 009 缩差顺序「接着」= **多源读取 → 结构化结果**。  
> **备选（本版不做）：** 上下文托盘（标签组 + 选区）→ 单独立 `013`，不与本刀混写。

## 非目标

- 不重写 / fork 完整浏览器；终局仍是 Chrome 插件
- 不动 **W\*** 协作窗
- 不改写票 **06** 飞书旅程与真站验收口径
- 不做完整上下文托盘（标签组 UI、收藏、本地文件上传、截图引用）- 留给 013
- 不做跨会话记忆、妙招广场、多模型货架
- 不做自动外发到飞书/邮件（外部写入若有，必须另开合同 + 一次批准）
- 不把内部评测集做成产品菜单入口

## 范围（唯一竖切）

**用户可见路径：**

1. 用户在侧栏发起任务，指令含「读取 / 总结 / 对比」类意图，并给出 **≥2** 个来源（URL 列表，或明确指向多个已打开标签的 URL）。
2. 持节在 control 路径下依次（或有限并行）**读取**这些来源的可观察文本（当前页 / 导航打开后的页文本；失败可分类）。
3. 任务结束时状态为 `completed` **仅当**产出了结构化结果；结果至少包含：
   - **来源列表**（每个 URL + 短标题或失败类）
   - **要点**（≥3 条 bullet，或显式说明某源不足）
   - **可选：对比/结论段**（多源时一句汇总）
4. 结果在**侧栏任务表面**可见（任务卡 / 结果区），并支持**一键复制为 Markdown**（剪贴板）。
5. 任一本源读取失败：该源记失败类（对齐既有 taxonomy 精神，可用 `other` / 源级 `read_failed`），**不得**因单源失败把整任务标 `completed` 且空结果；多源部分成功时允许 `completed` 且结果内标注失败源。
6. 遵守既有红线：无假完成；无未批准的外部提交（本刀默认**只读 + 本地结构化**，不写外站）。

**允许改动（G3 最小集，按需）：**

- Task / control 路径：多 URL 读取编排与结果落盘字段
- 侧栏：结构化结果展示 + 复制 Markdown
- 单测 / 小 fixture（本地 HTML 多页）证明链路
- 不强制真站 Owner 登录（本刀默认公开页或本地 fixture）

## 数据形状（冻结最小 schema）

任务完成后，快照或 round 上须有可序列化结构（字段名可微调，语义不可丢）：

```ts
type StructuredReadResult = {
  sources: Array<{
    url: string;
    title?: string;
    ok: boolean;
    failureCategory?: string; // 源级；ok=false 时建议有
    excerpt?: string;         // 短摘录，可选
  }>;
  bullets: string[];          // length >= 3 当至少 1 源 ok；否则可空并整任务 failed
  summary?: string;
  markdown: string;           // 与 UI 复制内容一致
};
```

## Evals（G4 必须；至少 2 条）

| ID | 当… | 应… | 测缝 |
|----|-----|-----|------|
| **E1** | fixture 或 mock：2 个本地 HTML 源均可读，任务指令为「总结这两个来源」 | 任务 `completed`；`StructuredReadResult.sources.length === 2` 且均 `ok`；`bullets.length >= 3`；`markdown` 非空且含两源 URL 或标题 | 单测（推荐：结果组装纯函数 + TaskManager/driver 冒泡） |
| **E2** | 2 源中 1 源读取失败、1 源成功 | 结果内失败源 `ok=false` 且有失败类；成功源要点仍出现；**不得**空 `markdown` 却 `completed`；若 0 源成功则整任务 `failed` | 同包单测 |
| **E3**（建议） | 调用「复制 Markdown」路径（函数级） | 返回字符串 === `result.markdown` | 侧栏或 presentation 单测 |

命令（G3 落地后写死；G4 以 exit 0 为准）。占位：

```bash
# G3 回传时替换为真实路径；G4 不得接受「未写测」的 PASS
pnpm -F chrome-extension test -- <path-to-012-tests>
pnpm -F @extension/sidepanel test -- <path-to-012-ui-tests>
```

不要求本刀：飞书 06 真站、B 站 07、人工截图进 PASS 门禁（L3 另记）。

## 完成定义

- [ ] G3：实现最小竖切 + E1/E2（E3 可选）单测绿
- [ ] G4：命令 exit 0 + 对照本文件 schema / 验收项
- [ ] G1：LIVE / LONG_HORIZON 记 012 状态；013 上下文托盘仅在本刀 PASS/DONE 后开

## 验收项列表（BDD）

1. 当我给出 ≥2 个可读来源并要求整理，我应在侧栏看到结构化结果（来源 + 要点 + Markdown），而不是只有动作日志。
2. 当有源失败时，我应在结果里看到该源失败，而不是静默当成全成功。
3. 当零源成功时，任务不得 `completed` 且空结果。
4. 当我复制结果时，剪贴板/返回值是同一份 Markdown。
5. 本刀不触浏览器重写、不触 W*、不改 06 飞书口径、不做上下文托盘全量。

## 回传格式

**G3：** 改动文件；测试命令；exit code；schema 落点路径；未做项  
**G4：** PASS/FAIL；证据路径；失败类  

## 与 009 / 备选刀关系

| 顺序 | 刀 | 合同 |
|------|----|------|
| 现在（P0 真站） | 飞书可托付 | 票 06 / 既有协议（本刀不替代） |
| **本刀** | 多源读取 → 结构化结果 | **012-v1** |
| 下一候选 | 上下文托盘：标签 + 选区进同一 Task | 013（未开） |
