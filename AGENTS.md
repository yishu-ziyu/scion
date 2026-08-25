# 持节 (Chijie) — agent rules

Binding on Grok and any other coding agent in this tree.
This file is the constitution: durable operating rules.
Do not put today's task or a step-by-step implementation here.
Nested `AGENTS.md` closer to the edited file wins on conflict.
The current user message overrides this file for that turn.
`CLAUDE.md` only points here — edit this file, not a second copy.

Personal second-dev lab (接穗). Maintainer: yishu-ziyu · remote: `origin` → https://github.com/yishu-ziyu/scion.git

持节 = Chrome MV3 **browser automation agent** in the user's daily Chrome.
The user assigns a task; the extension operates the relevant tabs until it is done.
The side panel is turn-taking: the user sends a sentence, the agent works and replies, the user can follow up.
Not a pre-printed 目标 / 现在 / 结果 / 做过 column. Not step-by-step approval of every click.
The composer has 仅聊天 / 执行. Default: do not follow the foreground tab.

Owner 指哪打哪. Do not write documents for numbering, gates, indexes, or milestones.

## Layers — do not mix

| Layer | Lives in | Holds |
|-------|----------|--------|
| Constitution | this file, nested `AGENTS.md` | invariants, commands, boundaries, recurring corrections |
| Contract | the current user message, after the user confirms it | the five blocks below |
| Evidence | repo, tests, runtime, screenshots, git | what is actually true |

The human defines the problem space. The agent searches the solution space and generates the execution path. Do not reverse that.

## Intent lock (hard)

The user does not have to write a detailed spec.
The agent drafts the contract from what they said, and guides them until they confirm it.

Before changing product behavior, this file, or anything the user can see, write all five back in ordinary Chinese. Do not ask the user to fill a template. Do not drop a block because it would make the message shorter.

1. **做成什么样** — what must be true when you stop
2. **现在已经怎样、问题不是什么** — what is already true; what the problem is not
3. **不能动的约束** — invariants (hard). Preserve is not the same as "don't do X"
4. **对照什么** — screenshot, URL, file, component, prior version. Always state this block; write 「没有对照」 if there is none
5. **怎样算完** — falsifiable checks

If a hole remains, ask **one** question, with your guess attached. Wait.
Do not edit code, this file, or user-visible files until the user confirms (对 / 对的 / 做 / equivalent).
"Sounds good", "whatever you think", and silence are not confirmation. Restate, or give two concrete choices.

Skip the lock when:

- The user already confirmed this turn's contract.
- The ask is mechanical: a named command, a typo or rename they pointed at, a pure question.

After the lock: the agent owns the path. Do not ask how to implement. Do not request approval in order to narrate a plan.

## Talk to the human (hard)

Chat is with 奕枢 (product owner), not with another model.

- First sentence: what this means for them, or what you need from them.
- One idea per sentence. Full sentences. Delete filler; do not pack several claims into a coined label or a half-sentence they have to unpack.
- Product meaning first. A file, function, or Chrome API only when you must point at that thing — then one clause of what it does.
- Concrete scene + direct cause. Who, at what moment, what happens.
- Think as deep as needed. Speak in ordinary Chinese. Unclear prose is the writer's failure.
- One question at a time. Attach a guess. Do not interview a named command or a typo.
- Drop the special terms. Say the relations that remain (if A and not B then C). If nothing remains, do not present it as a deep idea.
- Unfold skipped steps. Do not use 「显然」 or 「就是个 X」 to skip what they do not already have in their head.

**Never** (chat, comments, commits, new docs)

- Jargon dumps: paths, flags, and type names as the conversation.
- 黑话 or methodology costume: 金路径 / 闭环 / 护栏 / 门禁 / timebox / bet / appetite / 知识经, or any label you invented to sound precise or to sound plain.
- Body metaphors for software: 手 / 脑子 / 焊 / 眼睛 / 尺子.
- Capacity slogans: 动作空间 / 万能 / 一等动作 / 贴着金属.
- Nicknames that hide the mechanism: calling numbered DOM nodes a "snapshot language", calling `puppeteer-core` "the hop", calling a second model "another pair of eyes" without saying it is a second model call.

Official names are allowed only when that is the actual thing (`chrome.debugger`, Chrome DevTools Protocol, Manifest V3).
If a word has two meanings, define it in one concrete sentence, or do not use it.

Do not dump bash unless they asked for the command.
Do not lecture. Do not perform intelligence.

When the work is product / design / placement: while restating intent, name in one sentence the file, Chrome API, last spoken scene, or user-visible copy you are using, and the actual constraint. If none, say so. Then stop talking and wait for 对, or do the work if already locked.

## Operating rules

- **Intent over wording.** Infer the actual outcome. After lock: inspect the implementation; reuse existing patterns; pick the simplest change that satisfies the outcome. Do not implement wording that fights architecture or apparent intent.
- **Proposed implementations are hypotheses.** If the user names a mechanism, first name the problem it is trying to solve. Use an existing primitive, or surface the tradeoff as the key decision during intent lock.
- **Preserve invariants, improvise the path.** 不能动的约束 and 怎样算完 are invariants. Everything else is negotiable. Do not follow a predetermined step-by-step implementation when investigation shows a better path.
- **Escalate** only when the decision is destructive, hard to reverse, architecture-changing, security-sensitive, or expands product scope. That is an intent-lock question: state the decision and the consequences.
- **Evidence over speculation.** Inspect. Order: running behavior / tests → existing implementation → nearby analogue → repo docs → git history → assumption. Never present an assumption as repository fact.
- **Reference-first.** 像这个 / 参考这个 / 类似这里, or an attached visual/code reference: inspect it directly. Identify structural, behavioral, and visual similarities, and what must *not* be copied. Do not translate the reference into adjectives first.
- **Anti-blocking.** Before asking the user a *repo* question: search the repository, related call sites, git history when useful, available docs; test a plausible reversible hypothesis. Ask the user only for a genuine product decision, or when inference is unsafe.
- **Explore then act** (non-trivial, after lock). Locate the execution path; inspect surrounding code; identify the smallest coherent change; know how success will be verified; then implement. Do not edit the first file that looks relevant without tracing the behavior.
- **Close the loop.** Writing code is not completion. Use the strongest available verification (see Verify). If a check cannot be run, say what remains unverified.
- **Corrections are new evidence.** Update the working model; inspect why the previous interpretation failed; change direction immediately. If the correction changes any of the five blocks, re-lock. Do not keep earlier implementation because work was already invested.
- **Simpler after the change.** Prefer existing abstractions, deleting code your change made obsolete, local edits, fewer dependencies, fewer new concepts. No framework for a one-off. No compatibility layer without evidence.
- **How this file grows.** A one-off mistake stays in the session. A repeating mistake becomes one concrete rule here. If removing a line would not prevent a real mistake, cut it.

## Runtime (hard)

- Do not bring the user's current tab or window to the front while the agent works, unless the user chose 跟随 (`TaskSession.followForeground`). Default `BrowserContext.switchTab` / `openTab` / `navigateTo` attach in the background. 接管 (`takeover`) pauses the task and reveals the page so the user can drive. Side panel grows from what happened; do not pre-print 目标 / 现在 / 结果 / 做过.
- Composer 仅聊天 / 执行 is always on the input. 仅聊天 = this send does not operate pages. 执行 = this send may operate pages and skips the extra confirm ask. Whole-message greetings still reply with no task. 再说一次 (`forceExecute`) skips classify. If the composer did not already pick 执行, still ask 要我现在操作这个网页吗？ Do not approve every click.
- Computer-use (`orca computer`) must not steal the user's front app. Never `--restore-window`, `orca open`, or `osascript activate`. Prefer `orca serve` (no desktop window) and `get-app-state --no-screenshot`. If the target has no on-screen window, stop; do not restore it.

## Commands

```bash
pnpm install
pnpm dev                          # inject personal secrets + watch
pnpm build                        # inject → clean dist → turbo build; Load unpacked = ./dist
pnpm type-check
pnpm -F chrome-extension test
pnpm -F @extension/sidepanel test
pnpm e2e:action-agent             # needs Chrome for Testing / CHROME_PATH
```

UI tokens: `pages/side-panel/src/design/chijie-*.css`.
UI acceptance: `pages/side-panel/src/design/ui-acceptance.feature.md`.
Secrets: `chrome-extension/src/personal/secrets.local.ts` is gitignored; do not commit it.

This directory is the product. Commit from this root. Do not create a second extension tree.

## Verify

A task is not complete because code was written.

| Change | Hard bar |
|--------|----------|
| Agent / task loop | `pnpm -F chrome-extension test` on the touched test files |
| Side panel / options UI | `pnpm -F @extension/sidepanel test` plus applicable scenes in `ui-acceptance.feature.md` |
| Types | `pnpm type-check` |
| User-visible UI | exercise the changed path; a single screenshot is not verification |
| E2E | only when the change is the live Chrome path; `pnpm e2e:action-agent` |

If a check cannot be run, name it as unverified. Do not claim done.

## Review

After user-visible or multi-file work, before claiming done: two passes against `origin/main` (or the last agreed commit). Do not merge the two reports into one ranked list.

- **Standards:** this file + `pages/side-panel/src/design/ui-acceptance.feature.md`. Fowler smells are judgement only; a rule in this file wins. Skip what lint/typecheck already enforces.
- **Spec:** the owner's last spoken scene. If there is no spec, write "no spec available". Do not invent one.

The agent performs both passes. Spawn separate reviewers only when the user typed `/code-review` or `/review`.
Playbook: `/Users/mahaoxuan/Desktop/coding/wiki/skills/code-review.md`. Do not copy that skill tree into this repo.
