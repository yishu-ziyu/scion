# Problem and solution

## Problem Summary

Current browser Agents can produce plausible sequences of clicks, but the user cannot reliably delegate a task because four guarantees are missing:

1. **Whole-task execution:** the Agent may stop at navigation or an intermediate state.
2. **Continuous context:** follow-up references may lose the original task, tab, or object.
3. **Verified completion:** the model can claim success without observable proof.
4. **Safe reuse:** historical replay is brittle, while arbitrary script execution is unsafe.

## Severity and Frequency

- Severity is high: an incorrect submit, purchase, deletion, or message can create an external side effect; a false “done” destroys trust.
- Frequency is expected to be high for browser-heavy users because every delegated task crosses the same lifecycle boundary.
- Owner evidence: Feishu form completion and Bilibili playback/pausing are explicitly desired.
- Code evidence: the global Executor, model-only completion check, and action replay paths are directly visible in the current source.

## Solution Idea

Introduce a task-session contract around the existing Executor:

- persist the goal, current browser targets, status, completion criteria, approvals, and evidence;
- route new and follow-up instructions through the same task session;
- require supported observable completion evidence before marking success;
- gate high-impact actions before they execute;
- save a successful semantic task template as a local Skill with inputs, success criteria, and approval policy.

Reuse the current action registry, BrowserContext, Planner/Navigator, chat storage patterns, URL firewall, and side-panel UI. Do not add website-specific adapters for Feishu or Bilibili.

## Evidence

- Owner confirmed the Tabbit-like action model and local Skill requirement.
- Tabbit validates demand for action execution plus reusable workflows.
- OpenAI's Atlas transition supports keeping the capability inside an existing browser surface.

## Non-goals

- Guaranteed automation of every website.
- CAPTCHA bypass or automatic credential entry.
- Native desktop application control.
- Cloud execution while Chrome is closed.
- Parallel tasks, Skill sharing, marketplace, billing, or enterprise administration.
