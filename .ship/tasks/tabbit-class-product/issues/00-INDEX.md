# Tickets index — tabbit-class-product

**Parent spec:** `.ship/tasks/tabbit-class-product/spec/SPEC.md`  
**Parent issue:** https://github.com/yishu-ziyu/scion/issues/1  
**Seams:** S1–S5 accepted  
**Matt:** `/to-tickets` · work frontier with `/implement` + `/tdd`, clear context between tickets

## Graph

```text
01 task UI ─────────────┬──► 02 observe-act loop ──► 03 Slice A YouTube E2E ──┬──► 06 Slice B Feishu
                        │                                                      └──► 07 Slice C media
                        ├──► 04 failure categories
                        └──► 05 external-commit approval ─────────────────────► (also blocks 06)
```

## Frontier (start now)

| ID | Title | Blocked by | GitHub |
|----|--------|------------|--------|
| **01** | Task mode + steps + done UI | None | #2 |
| 02 | Observe→act loop navigate | 01 | #3 |
| 03 | Slice A YouTube E2E | 02 | #4 |
| 04 | Failure categories | 01 | #5 |
| 05 | External-commit approval | 01 | #6 |
| 06 | Slice B Feishu | 03, 05 | #7 |
| 07 | Slice C media pause | 03 | #8 |

**First implement:** `01` only → `/implement` + `/tdd` on #2.

## Out of these tickets

Cross-conversation memory, 妙招广场, full browser, multi-model shelf, Python browser-use default.
