# Product blueprint

## Product Solution

The side panel becomes a task console rather than only a chat transcript. Each instruction creates or continues a task session with an explicit state, observable progress, pending approvals, completion criteria, and a final receipt. A completed task can be saved as a local Skill and rerun with new inputs.

## Positioning

An open, local-first browser action Agent for the Chrome profile the user already uses: it acts across real logged-in pages, proves the result, and remains controllable.

It is not a new browser, a research-only assistant, or a general desktop Agent.

## Core Flow

```text
goal or Skill inputs
→ create/continue task session
→ plan next browser actions
→ action safety check
→ execute on real page
→ observe result
→ continue / request approval / request user action
→ verify completion criteria
→ completion receipt
→ optional save as local Skill
```

## Evolution Blueprint

### Cycle 1 — dependable single task

- one active task session;
- whole-task execution using existing actions;
- follow-up control bound to the session;
- completion evidence and approval gates;
- local Skill save and rerun;
- Feishu-like form and Bilibili-like media journeys.

### Later, only after evidence

- background continuation across UI closure;
- multiple parallel tasks;
- richer `@` context sources;
- Skill import/export and sharing;
- more completion predicate types;
- additional model providers and routing policies.

## Scope Boundary

The Agent may operate HTTP(S) pages visible to the extension under the existing URL firewall. It will not enter credentials, bypass CAPTCHA, control native desktop applications, or silently perform high-impact external commits.
