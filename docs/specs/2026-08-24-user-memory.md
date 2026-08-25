# 用户确立的事实（跨任务记忆）

日期：2026-08-24  
状态：已实现（合入工作区）  
产品：持节。生产路径仍是 `createLlmControlDriver` + `runObserveActLoop`。

## 场景

用户在独立记忆页写下「我常用谷歌邮箱」。Agent 抽成条目「常用邮箱 = mail.google.com」。用户可改这条目。下次「打开邮箱」直接开谷歌，不再问哪家。把条目改成微软后，下次开微软。

任务里亲口确认「是，谷歌是我常用邮箱」写入**同一张表**。

## 现在

只有 `chrome.storage.local` 键 `usual-mailbox-v1`。只服务邮箱开哪家。SPEC 把它标成 Ask first。

## 目标

用户确立过的事实跨任务还能用。原文可以留着当来源；决定时只读结构化条目。

```text
用户写下原文 或 任务里确认
        │
        ▼
Agent 抽成「这是什么 → 值」（密码类丢掉）
        │
        ▼
条目写入 chrome.storage（用户可改、可删）
        │
        ▼
下次 decide 只读条目，不读原文
```

## 非目标

- 浏览记录、开过的标签、页上扫到的字
- 聊天全文检索
- 把整页笔记塞进模型
- 密码 / API key / cookie
- 新人选一界面、第二只笔记产品

## 存储

`packages/storage`：`userMemoryStore`，键 `user-memory-v1`。

```ts
type UserMemoryFact = {
  id: string;
  kind: string; // 用户可见，如 常用邮箱
  value: string; // 如 mail.google.com
  sourceText?: string;
  updatedAt: number;
};

type UserMemoryState = {
  facts: UserMemoryFact[];
  sourceText: string; // 原文，不当决定输入
};
```

同 `kind`（规范化后）合并为一条。旧键 `usual-mailbox-v1` 在第一次读取时迁入「常用邮箱」。

## 页面

独立扩展页 `pages/memory` → `dist/memory/index.html`。不是侧栏，不塞进模型设置。侧栏有入口。空状态说明下一步：写下事实，再整理成条目。

## 决定

`buildControlUserPrompt` 在 Task 之后插入条目块。`resolveMailboxOpen` 的 `confirmedHost` 来自条目，不再单独读旧键。
