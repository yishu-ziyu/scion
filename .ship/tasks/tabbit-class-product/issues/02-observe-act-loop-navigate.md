# 02 — Observe → act → re-observe loop (navigate-first)

**What to build:** The in-extension **agent loop** (browser-use architecture, TypeScript) for a **navigation-first** toolset: observe page → state summary → model chooses action → execute via browser control → re-observe; mid-model parse/retry. Wired through TaskManager so **01**’s step list and completion receive real events—not a parallel ghost system.

**Blocked by:** 01 — Task mode + steps + done UI

**Status:** implemented

**Seams:** S3, S4, S2

- [x] Loop is observe → decide → act → re-observe for at least `go_to_url` / wait / done
- [x] Recoverable parse/decision failures retry without killing the whole task by default
- [x] Steps and status update through product contract (TaskManager path)
- [x] Unit/integration tests at control-loop + Task journey seams (no full YouTube required)
- [x] Extension tab is not treated as the task content target

**Notes:** Pure engine `observe-act-loop.ts`; LLM control uses it; navigate fixture + TaskManager journey.
