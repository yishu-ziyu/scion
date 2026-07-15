# Slice A protocol — open YouTube (ticket 03)

**Status:** frozen for acceptance  
**Model (formal):** MiniMax-M3  
**Shell:** Chrome extension side panel (task mode)  
**Core:** control backend (observe→act→re-observe)

## Instruction

```text
打开 YouTube
```

(English equivalent OK: `Open YouTube`)

## Pass

1. A **content tab** loads a `youtube.com` URL (not `chrome-extension://`).
2. Side panel shows **human-readable execution steps** (or step list while running).
3. Task ends **completed** with **completion receipt** (verified done).
4. No completed+receipt if navigation never reached YouTube (**no false complete**).

## Fail classes

| Code | Meaning |
|------|---------|
| login_wall | captcha / force login on YouTube |
| selector_miss | could not navigate / target missing |
| model_loop | max steps / JSON thrash |
| false_complete | UI said done without YouTube tab |
| other | see notes |

## How to run

### Automated (preferred when dist + key ready)

```bash
cd ~/projects/chijie-browser
pnpm build
# Main Chrome with extension loaded, CDP up:
CDP_URL=http://127.0.0.1:9222 node chrome-extension/scripts/slice-a-youtube-e2e.mjs
# Or temp Chrome for Testing + load dist:
node chrome-extension/scripts/slice-a-youtube-e2e.mjs
```

Report: `reports/nanobrowser/golden/slice-a-youtube-*.md`

### Manual

1. Load unpacked `projects/chijie-browser/dist`
2. Keep a normal content tab active
3. Open **side panel** (not only extension URL as tab if avoidable)
4. Task mode: `打开 YouTube` → Send
5. Confirm YouTube tab + 完成回执 + 执行步骤

## Automated unit evidence (no live YouTube)

- Navigate fixture + TaskManager: `control-backend-journey` navigate-first
- No false complete on nav failure: same file, ticket 03 case
