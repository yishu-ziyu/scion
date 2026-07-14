# Nanobrowser CDP log drops

Local captures from Chrome DevTools Protocol. **Not committed** (see scion `.gitignore`).

## Capture (you)

```bash
chrome-cdp ensure   # main Chrome must expose 9222
# open Nanobrowser side panel, reproduce the failure, then:
nanobrowser-logs
# or:
python3 ../scripts/capture_logs.py --seconds 20 --note "form submit step_failed"
```

## Read (agent)

```text
scion/reports/nanobrowser/logs/LATEST.md
```

JSONL full dump: `LATEST.jsonl`

## Privacy

Script redacts common API-key shapes. Still avoid pasting secrets into chat.
