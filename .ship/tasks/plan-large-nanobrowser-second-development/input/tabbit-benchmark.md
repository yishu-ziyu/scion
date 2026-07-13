# Tabbit benchmark — intake evidence

Date: 2026-07-13

## Identification

The referenced Meituan product is **Tabbit 1.0**, announced by Meituan's GN06 team. Meituan describes it as an AI-native browser that executes complex tasks across software and web pages. During public beta, Meituan reported Agent task success improving from 53.1% to 91.8% and gave an HR example spanning resume screening through PPT generation.

Source: [Meituan announcement](https://www.meituan.com/news/NN260612179003187)

## Product loop verified from official materials

1. **Give a goal** — the user describes a complex task in natural language.
2. **Ground it in browser context** — `@` can reference tabs, tab groups, screenshots, bookmarks, and local files.
3. **Act, not answer** — Agent mode opens pages, clicks, fills forms, crosses sites, and delivers a result in an isolated tab group.
4. **Keep the user in control** — consequential actions such as placing an order stop for final confirmation.
5. **Reuse successful work** — prompts, generated scripts, and completed tasks can be saved as a “妙招” and invoked again with `/`.

Sources: [Tabbit AI browser overview](https://go.tabbit.ai/ai-liulanqi/zh-cn), [Tabbit official usage guide](https://www.tabbit.com/guide/usage)

## OpenAI comparison

The discontinued OpenAI product is **ChatGPT Atlas**. OpenAI says Atlas will stop working on 2026-08-09 and is moving browser-agent capabilities into ChatGPT, Codex, the desktop app, and a Chrome extension/sidebar. The important product signal is not that browser action failed; it is that replacing the user's browser created avoidable adoption and maintenance cost while the action capability remains valuable.

Sources: [OpenAI Atlas deprecation notice](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work), [original Atlas announcement](https://openai.com/zh-Hans-CN/index/introducing-chatgpt-atlas/)

## What Nanobrowser already has

- General browser primitives: navigate, click, input text, open/switch/close tabs, scroll, select dropdowns, send keys, wait, and finish.
- Follow-up tasks can reuse the current executor and message context.
- Pause, resume, cancellation, history storage, and action replay already exist.
- The current fork runs inside the owner's real Chrome and already uses the logged-in browser state.

Local evidence:

- `projects/nanobrowser/chrome-extension/src/background/agent/actions/schemas.ts`
- `projects/nanobrowser/chrome-extension/src/background/index.ts`
- `projects/nanobrowser/chrome-extension/src/background/agent/executor.ts`

## The real second-development gap

Nanobrowser currently has many of the low-level actions, but its product contract is still “attempt a prompt”. The target contract is “complete a browser task and prove the outcome”. The important gaps are:

- **Durable task context:** closing the side panel currently cancels the executor; one global executor also prevents clean task isolation.
- **Verified completion:** task success is currently a Planner `done` judgment, not evidence that the intended side effect occurred.
- **Continuous control:** follow-up exists technically, but must reliably bind “pause it” or “continue that form” to the same task, tab, and object.
- **Safe side effects:** submission, purchase, deletion, messaging, and permission changes need explicit approval boundaries and an action trail.
- **Reusable capability:** raw action replay is brittle. A reusable semantic skill can express intent and required outcome without hard-coding stale element indexes.

## Product conclusion

Do not clone a full Chromium browser in this cycle. Keep the existing Chrome extension and build the missing action runtime around the browser the user already uses.

The product is:

> A browser action agent in the Chrome side panel: give it a goal, let it use the current logged-in browser to complete the whole multi-step task, verify the result, and keep controlling the same task with follow-up instructions.

This is intentionally broader than a research agent and narrower than a general desktop agent: the execution boundary is work that can be completed inside browser pages.
