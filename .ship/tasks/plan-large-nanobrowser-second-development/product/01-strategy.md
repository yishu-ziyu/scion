# Strategy

## BRD: Why This Is Worth Doing

Browsers are where many personal workflows already happen, but the user still performs every click, field entry, tab switch, and state check manually. Existing Nanobrowser proves that an extension can operate the owner's real Chrome with a configurable model stack; the second-development opportunity is to turn that technical demo into a dependable delegation loop.

The value is not “AI in a sidebar”. It is converting a natural-language goal into a completed, inspectable browser outcome while the user keeps control of consequential actions.

## MRD: Market, User, Competition

Primary user: a browser-heavy individual who already works inside logged-in web applications and wants to delegate multi-step operations without moving data into a separate cloud browser.

Relevant alternatives:

- Tabbit: full browser product with Agent execution, contextual `@` references, and reusable “妙招”.
- ChatGPT Atlas: similar browser-agent direction, now being discontinued as a standalone browser while OpenAI moves the capability into desktop and Chrome surfaces.
- Upstream Nanobrowser: open-source Chrome extension with broad action primitives, follow-up tasks, and replay, but without a strong completion/approval/skill product contract.
- Manual work and website-specific automation: reliable when maintained, but expensive to create for every website and brittle across layout changes.

## Switching Reason

The user stays in the Chrome profile they already trust, keeps existing logins, uses a BYOK model stack, sees what the Agent is doing, approves consequential actions, and receives proof that the task actually reached its goal. Successful tasks can become local Skills instead of being rebuilt from scratch.

## C-side Behavior Loop

- Start: a repetitive or inconvenient browser task appears.
- Delegate: state the goal in the side panel and optionally provide Skill inputs.
- Supervise: watch progress or respond to an approval/user-action request.
- Verify: inspect the completion receipt and resulting page state.
- Continue: issue a contextual follow-up such as “pause it” or “change the department”.
- Reuse: save a successful task as a local Skill and run it again with new inputs.
- Drop-off risk: false completion, loss of task context, excessive confirmation prompts, login friction, or a Skill that is merely brittle action replay.

## Decision

- Do: build a Chrome-side browser action Agent whose contract is verified task completion and continuous control.
- Do: include the smallest useful local Skill loop in the first implementation cycle.
- Do not do: build a Chromium fork, desktop-wide Agent, enterprise platform, parallel Agent system, or Skill marketplace.
- Evidence: Owner's Feishu/Bilibili scenarios; [Meituan Tabbit launch](https://www.meituan.com/news/NN260612179003187); [Tabbit guide](https://www.tabbit.com/guide/usage); [OpenAI Atlas transition](https://help.openai.com/en/articles/20001371-evolving-atlas-into-chatgpt-for-browser-based-agentic-work); local Nanobrowser source inspection.
