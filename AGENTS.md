# 持节 (Chijie) — agent rules

Personal second-dev lab (接穗). Maintainer: yishu-ziyu · remote: `origin` → https://github.com/yishu-ziyu/scion.git

持节 = Chrome MV3 **long-horizon task Agent**：把交出去的事做完，交出能核对的结果。侧栏报目标 / 现在 / 结果。不是侧栏聊天，不是逐步审批。

Owner 指哪打哪。不要为了编号、闸门、索引、里程碑去写文档。

## Language (hard)

During development, write and speak so a reader can point at a file, a function, a Chrome API, or a sentence the user will see.

Do not use technical slang, coined labels, or metaphors that can be read two ways. If a phrase sounds clever but does not name the thing, rewrite it.

**Always**

- Name the path, symbol, protocol, or user-visible copy.
- Official names are allowed only when that is the actual thing (`chrome.debugger`, Chrome DevTools Protocol, Manifest V3).
- If a word has two meanings, define it in one concrete sentence before using it, or do not use it.

**Never** (in chat, comments, commits, or new docs; do not rename existing code unless asked)

- Body metaphors for software: 手 / 脑子 / 焊 / 眼睛 / 尺子.
- Capacity slogans: 动作空间 / 万能 / 一等动作 / 贴着金属.
- Process or framework theater: 金路径 / 闭环 / 护栏 / 门禁 / bitter lesson as a brand.
- Nicknames that hide the mechanism: calling numbered DOM nodes a "snapshot language", calling `puppeteer-core` "the hop", calling a second model "another pair of eyes" without saying it is a second model call.

Say the mechanism: which function runs, what it reads, what it writes, what the user sees if it fails.

Verify the function and design after implementation, and keep on iterating and verifying until it's production ready. Work until you genuinely cannot improve further. Aim as high as you can.

This directory is the product. Commit from this root. Do not create a second extension tree.

## Lessons

- Do not bring the user's current tab or window to the front while the agent works, unless the user chose 跟随 (`TaskSession.followForeground`). Default `BrowserContext.switchTab` / `openTab` / `navigateTo` attach in the background. 接管 (`takeover`) pauses the task and reveals the page so the user can drive. Side panel shows 目标 / 现在 / 结果.
- Computer-use (`orca computer`) must not steal the user's front app. Never `--restore-window`, `orca open`, or `osascript activate`. Prefer `orca serve` (no desktop window) and `get-app-state --no-screenshot`. If the target has no on-screen window, stop; do not restore it.
