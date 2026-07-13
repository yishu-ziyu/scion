# Research and current state

## Scenario Research

### Feishu form

Goal: “打开飞书帮我写个表单。”

Required behavior: reach the correct form in the existing login session, fill all requested fields, surface missing information, pause before a consequential submit when required, submit after approval, and verify a success state. Merely opening Feishu is failure.

### Bilibili playback

Goal: “打开 B 站，进入我的收藏夹，播放那个视频。” Follow-up: “暂停这个视频。”

Required behavior: traverse the existing account UI, locate the intended item, start playback, preserve the task-to-tab-to-media binding, then interpret “这个视频” against that same context and verify the paused media state.

## Current Workflow

Without an Agent, the user performs navigation, search, selection, input, submission, and state checking manually. With current Nanobrowser, the user can delegate many of those actions, but the execution is managed by one global Executor and a task is considered complete when the Planner says `done`; there is no first-class completion receipt or approval request.

## Existing Alternatives

### Tabbit

Official materials describe Agent execution in isolated tab groups, cross-site forms and workflows, contextual references, and saving prompts/scripts/tasks as “妙招”. Meituan reported a 91.8% Agent task success rate at the 1.0 launch, but the definition and test set behind that metric are not public.

### ChatGPT Atlas

OpenAI is discontinuing the standalone Atlas browser on 2026-08-09 while retaining browser-agent capabilities in ChatGPT, Codex, desktop, and Chrome surfaces. Inference: browser action remains valuable; a replacement browser shell is not necessary to deliver it.

### Nanobrowser code baseline

Already present:

- action registry for navigation, click, text input, tabs, scrolling, keyboard input, dropdowns, waiting, and completion;
- Planner/Navigator execution loop with browser state inspection;
- follow-up task messages, pause/resume/cancel, chat history, and action replay;
- Chrome local storage, URL firewall, and prompt-injection filtering;
- real Chrome session and MiniMax personal provider bootstrap.

Material gaps:

- `currentExecutor` and `currentPort` are global singletons in the background entrypoint;
- closing the side panel cancels the running executor;
- completion is a model judgment rather than a checked postcondition with evidence;
- replay reuses historical element actions and is not a semantic Skill;
- no central approval gate protects external side effects across every action path;
- follow-up context is not durable across worker/UI lifecycle changes.

## Evidence

- [Tabbit official overview](https://go.tabbit.ai/ai-liulanqi/zh-cn)
- [Tabbit official usage guide](https://www.tabbit.com/guide/usage)
- [Meituan launch report](https://www.meituan.com/news/NN260612179003187)
- [OpenAI Atlas deprecation](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work)
- `projects/nanobrowser/chrome-extension/src/background/index.ts`
- `projects/nanobrowser/chrome-extension/src/background/agent/executor.ts`
- `projects/nanobrowser/chrome-extension/src/background/agent/actions/builder.ts`
- `projects/nanobrowser/packages/storage/lib/chat/history.ts`
- `projects/nanobrowser/packages/storage/lib/prompt/favorites.ts`

## Facts vs assumptions

- Fact: current code exposes broad browser actions, follow-up messaging, and history replay.
- Fact: current completion path accepts Planner `done=true` as task success.
- Fact: Tabbit supports saving completed tasks as reusable “妙招”.
- Assumption: the first user will reuse at least one successful Skill within seven days; this must be tested.
- Assumption: supported generic completion predicates can cover the first Feishu and Bilibili journeys without site-specific adapters.
