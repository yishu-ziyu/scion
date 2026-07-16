# gnhf run: scion-only-residual-f6a45b

Objective: see .gnhf/runs/scion-only-residual-f6a45b/prompt.md

## Iteration Log

### Iteration 1

**Summary:** Closed the Feishu single-write safety gap by blocking continuation after an approved commit has an uncertain outcome.

**Changes:**
- TaskManager now rejects natural-language follow-ups from `waiting_user / commit_outcome_uncertain`, preventing a possible duplicate external write.
- Strengthened the regression to prove the original round remains current, no receipt appears, no driver continuation occurs, and the write executes exactly once.
- Recorded Matt-style test and exit-code evidence in `reports/nanobrowser/overnight/gnhf-notes.md`; 231 extension tests, lint, formatting, and production build passed.

**Learnings:**
- The existing non-resumable protection covered `resume` but not `follow_up`, allowing “continue” to create a new round after an uncertain approved write.
- Preventing the new round also prevents a sticky or misleading receipt from appearing on this unsafe continuation path.
- Workspace type-check remains exit 2 solely from documented unrelated baseline diagnostics; neither changed source nor regression file is implicated.
