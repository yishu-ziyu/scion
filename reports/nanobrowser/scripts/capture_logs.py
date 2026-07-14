#!/usr/bin/env python3
"""Capture Nanobrowser extension console logs via Chrome CDP → reports disk.

Requires main Chrome with remote debugging (chrome-cdp ensure → port 9222).

Usage:
  # After a failed run: attach and dump buffered + live logs for 15s
  python3 capture_logs.py

  # Live capture while you retest (Ctrl+C to stop)
  python3 capture_logs.py --seconds 0

  # Only errors/warnings
  python3 capture_logs.py --level warning --seconds 30

Writes (gitignored under logs/):
  reports/nanobrowser/logs/<stamp>-session.jsonl   full events
  reports/nanobrowser/logs/<stamp>-session.md      human summary
  reports/nanobrowser/logs/LATEST.md               copy of latest summary
  reports/nanobrowser/logs/LATEST.jsonl            copy of latest jsonl
"""

from __future__ import annotations

import argparse
import json
import os
import re
import signal
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

try:
    from websocket import create_connection
except ImportError:
    print("need: pip install websocket-client", file=sys.stderr)
    sys.exit(2)

PORT = int(os.environ.get("CHROME_CDP_PORT", "9222"))
SCRIPT_DIR = Path(__file__).resolve().parent
REPORTS_DIR = SCRIPT_DIR.parent
LOGS_DIR = REPORTS_DIR / "logs"

# Prefer known local unpacked IDs; still auto-detect by SW filename.
KNOWN_EXT_IDS = {
    "pdabbpgmfbchdfkjfgpppeakalckihjh",  # current (post dual-install)
    "nnldlldkcjcooleefoflkgcjobimnaol",  # previous HANDOVER id
}

SECRET_RE = re.compile(
    r"(?i)(api[_-]?key|authorization|bearer|sk-[a-z0-9]{10,}|eyJ[a-zA-Z0-9_-]{20,})"
    r"([\"':=\s]+)([^\s\"']{8,})"
)


def redact(text: str) -> str:
    def repl(m: re.Match[str]) -> str:
        return f"{m.group(1)}{m.group(2)}***REDACTED***"

    return SECRET_RE.sub(repl, text)


def fetch_targets(port: int) -> list[dict]:
    url = f"http://127.0.0.1:{port}/json"
    try:
        with urllib.request.urlopen(url, timeout=3) as resp:
            return json.load(resp)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise SystemExit(
            f"CDP not reachable on 127.0.0.1:{port} ({e}).\n"
            "Run: chrome-cdp ensure\n"
            "Then reopen Nanobrowser side panel and retry."
        ) from e


def ext_id_from_url(url: str) -> str | None:
    m = re.match(r"chrome-extension://([a-z]{32})/", url or "")
    return m.group(1) if m else None


def discover_nanobrowser_targets(targets: list[dict]) -> tuple[str | None, list[dict]]:
    """Return (extension_id, targets to attach). Prefer service_worker + side-panel."""
    by_id: dict[str, list[dict]] = {}
    for t in targets:
        url = t.get("url") or ""
        eid = ext_id_from_url(url)
        if not eid:
            continue
        if (
            t.get("type") == "service_worker"
            and "background.iife.js" in url
        ) or (
            t.get("type") == "page"
            and "side-panel/index.html" in url
        ):
            by_id.setdefault(eid, []).append(t)

    if not by_id:
        # broader: any service_worker with background.iife (nanobrowser build name)
        for t in targets:
            url = t.get("url") or ""
            if t.get("type") == "service_worker" and "background.iife.js" in url:
                eid = ext_id_from_url(url)
                if eid:
                    by_id.setdefault(eid, []).append(t)

    if not by_id:
        return None, []

    # Prefer known IDs that have a SW
    chosen = None
    for kid in KNOWN_EXT_IDS:
        if kid in by_id and any(x.get("type") == "service_worker" for x in by_id[kid]):
            chosen = kid
            break
    if not chosen:
        # pick id with service_worker
        for eid, ts in by_id.items():
            if any(x.get("type") == "service_worker" for x in ts):
                chosen = eid
                break
    if not chosen:
        chosen = next(iter(by_id))

    return chosen, by_id[chosen]


def arg_to_text(arg: dict) -> str:
    if not isinstance(arg, dict):
        return str(arg)
    if "value" in arg:
        v = arg["value"]
        if isinstance(v, (dict, list)):
            return redact(json.dumps(v, ensure_ascii=False)[:4000])
        return redact(str(v))
    if "description" in arg:
        return redact(str(arg["description"])[:4000])
    if arg.get("type") == "object" and "preview" in arg:
        return redact(str(arg["preview"])[:4000])
    return redact(json.dumps(arg, ensure_ascii=False)[:2000])


def console_message(params: dict) -> dict:
    args = params.get("args") or []
    text = " ".join(arg_to_text(a) for a in args)
    return {
        "kind": "console",
        "level": params.get("type") or "log",
        "text": text,
        "timestamp": params.get("timestamp"),
        "stack": (params.get("stackTrace") or {}).get("callFrames", [])[:3],
    }


def log_entry_message(params: dict) -> dict:
    entry = params.get("entry") or {}
    return {
        "kind": "log",
        "level": entry.get("level") or "info",
        "text": redact(str(entry.get("text") or "")),
        "timestamp": entry.get("timestamp"),
        "url": entry.get("url"),
    }


LEVEL_RANK = {
    "debug": 10,
    "log": 20,
    "info": 20,
    "warning": 30,
    "warn": 30,
    "error": 40,
    "assert": 40,
    "trace": 10,
    "dir": 20,
    "table": 20,
}


def level_ok(level: str, min_level: str) -> bool:
    return LEVEL_RANK.get(level, 20) >= LEVEL_RANK.get(min_level, 20)


class TargetCapture:
    def __init__(self, target: dict, label: str):
        self.target = target
        self.label = label
        self.ws = None
        self._id = 0
        self.events: list[dict] = []

    def connect(self) -> None:
        url = self.target.get("webSocketDebuggerUrl")
        if not url:
            raise RuntimeError(f"no webSocketDebuggerUrl for {self.label}")
        self.ws = create_connection(url, timeout=8)
        self.ws.settimeout(0.05)
        self.send("Runtime.enable")
        self.send("Log.enable")

    def send(self, method: str, params: dict | None = None) -> int:
        assert self.ws
        self._id += 1
        msg: dict = {"id": self._id, "method": method}
        if params:
            msg["params"] = params
        self.ws.send(json.dumps(msg))
        return self._id

    def poll(self) -> list[dict]:
        if not self.ws:
            return []
        out: list[dict] = []
        while True:
            try:
                raw = self.ws.recv()
            except Exception:
                break
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            method = data.get("method")
            params = data.get("params") or {}
            if method == "Runtime.consoleAPICalled":
                rec = console_message(params)
                rec["source"] = self.label
                rec["targetUrl"] = self.target.get("url")
                rec["receivedAt"] = datetime.now(timezone.utc).isoformat()
                out.append(rec)
            elif method == "Log.entryAdded":
                rec = log_entry_message(params)
                rec["source"] = self.label
                rec["targetUrl"] = self.target.get("url")
                rec["receivedAt"] = datetime.now(timezone.utc).isoformat()
                out.append(rec)
            elif method == "Runtime.exceptionThrown":
                details = (params.get("exceptionDetails") or {})
                text = details.get("text") or ""
                exc = details.get("exception") or {}
                if exc.get("description"):
                    text = f"{text} {exc.get('description')}"
                rec = {
                    "kind": "exception",
                    "level": "error",
                    "text": redact(str(text).strip()),
                    "source": self.label,
                    "targetUrl": self.target.get("url"),
                    "receivedAt": datetime.now(timezone.utc).isoformat(),
                }
                out.append(rec)
        self.events.extend(out)
        return out

    def close(self) -> None:
        if self.ws:
            try:
                self.ws.close()
            except Exception:
                pass
            self.ws = None


def write_outputs(stamp: str, meta: dict, events: list[dict], min_level: str) -> tuple[Path, Path]:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    jsonl_path = LOGS_DIR / f"{stamp}-session.jsonl"
    md_path = LOGS_DIR / f"{stamp}-session.md"

    with jsonl_path.open("w", encoding="utf-8") as f:
        f.write(json.dumps({"meta": meta}, ensure_ascii=False) + "\n")
        for ev in events:
            f.write(json.dumps(ev, ensure_ascii=False) + "\n")

    filtered = [e for e in events if level_ok(str(e.get("level") or "log"), min_level)]
    errors = [e for e in events if str(e.get("level")) in ("error", "assert")]
    warnings = [e for e in events if str(e.get("level")) in ("warning", "warn")]

    lines = [
        f"# Nanobrowser log session {stamp}",
        "",
        f"- Captured at: {meta.get('capturedAt')}",
        f"- CDP port: {meta.get('port')}",
        f"- Extension id: `{meta.get('extensionId')}`",
        f"- Targets: {', '.join(meta.get('targets') or [])}",
        f"- Events total: {len(events)} (errors={len(errors)}, warnings={len(warnings)})",
        f"- Filter for summary body: level ≥ `{min_level}` → {len(filtered)} lines",
        f"- JSONL: `{jsonl_path.name}`",
        "",
        "## Errors (highest signal)",
        "",
    ]
    if errors:
        for e in errors[-80:]:
            lines.append(f"- **[{e.get('source')}]** {e.get('text')}")
    else:
        lines.append("_No error-level console lines in this capture._")

    lines += ["", "## Warnings", ""]
    if warnings:
        for e in warnings[-40:]:
            lines.append(f"- **[{e.get('source')}]** {e.get('text')}")
    else:
        lines.append("_None._")

    lines += ["", f"## Log body (level ≥ {min_level})", ""]
    for e in filtered[-200:]:
        lines.append(f"- `{e.get('level')}` **[{e.get('source')}]** {e.get('text')}")

    lines += [
        "",
        "## How to use with agents",
        "",
        "Tell the agent: **读 LATEST.md** 或指定本文件路径。",
        "Do not paste API keys; this capture redacts common secret shapes.",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")

    latest_md = LOGS_DIR / "LATEST.md"
    latest_jsonl = LOGS_DIR / "LATEST.jsonl"
    latest_md.write_text(md_path.read_text(encoding="utf-8"), encoding="utf-8")
    latest_jsonl.write_text(jsonl_path.read_text(encoding="utf-8"), encoding="utf-8")

    return md_path, jsonl_path


def main() -> int:
    parser = argparse.ArgumentParser(description="Capture Nanobrowser CDP console logs to scion reports")
    parser.add_argument(
        "--seconds",
        type=float,
        default=15.0,
        help="Capture duration after attach (default 15). 0 = until Ctrl+C",
    )
    parser.add_argument(
        "--level",
        default="info",
        choices=sorted(LEVEL_RANK.keys()),
        help="Minimum level included in markdown body (errors always listed)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=PORT,
        help="Chrome CDP port (default 9222)",
    )
    parser.add_argument(
        "--extension-id",
        default="",
        help="Force extension id (32 chars). Default: auto-detect",
    )
    parser.add_argument(
        "--note",
        default="",
        help="Optional one-line note stored in meta (what you were testing)",
    )
    args = parser.parse_args()

    targets = fetch_targets(args.port)
    eid, nb_targets = discover_nanobrowser_targets(targets)
    if args.extension_id:
        eid = args.extension_id
        nb_targets = [
            t
            for t in targets
            if ext_id_from_url(t.get("url") or "") == eid
            and (
                (t.get("type") == "service_worker" and "background" in (t.get("url") or ""))
                or (t.get("type") == "page" and "side-panel" in (t.get("url") or ""))
            )
        ]

    if not nb_targets:
        print("No Nanobrowser targets found.", file=sys.stderr)
        print("Open the side panel once, ensure the extension is enabled, then retry.", file=sys.stderr)
        print("Tip: chrome://extensions → Service Worker should be running.", file=sys.stderr)
        return 1

    # Prefer SW first (holds agent logs)
    nb_targets = sorted(
        nb_targets,
        key=lambda t: 0 if t.get("type") == "service_worker" else 1,
    )

    captures: list[TargetCapture] = []
    for t in nb_targets:
        label = "service_worker" if t.get("type") == "service_worker" else "side_panel"
        cap = TargetCapture(t, label)
        try:
            cap.connect()
            captures.append(cap)
            print(f"attached: {label}  {t.get('url')}")
        except Exception as e:
            print(f"skip {label}: {e}", file=sys.stderr)

    if not captures:
        print("Could not attach to any target.", file=sys.stderr)
        return 1

    stop = {"flag": False}

    def _stop(*_a):
        stop["flag"] = True

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    print(
        f"capturing extension={eid} for "
        f"{'until Ctrl+C' if args.seconds <= 0 else f'{args.seconds}s'} …"
    )
    # Initial drain (often includes buffered history on attach)
    deadline = time.time() + (3600 * 24 if args.seconds <= 0 else args.seconds)
    all_events: list[dict] = []
    while not stop["flag"] and time.time() < deadline:
        for cap in captures:
            all_events.extend(cap.poll())
        time.sleep(0.05)

    # final poll
    for cap in captures:
        all_events.extend(cap.poll())
        cap.close()

    stamp = datetime.now().strftime("%Y-%m-%d-%H%M%S")
    meta = {
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "port": args.port,
        "extensionId": eid,
        "targets": [c.label for c in captures],
        "targetUrls": [c.target.get("url") for c in captures],
        "note": args.note,
        "secondsRequested": args.seconds,
        "eventCount": len(all_events),
    }
    md_path, jsonl_path = write_outputs(stamp, meta, all_events, args.level)

    err_n = sum(1 for e in all_events if e.get("level") == "error")
    print(f"wrote {md_path}")
    print(f"wrote {jsonl_path}")
    print(f"LATEST → {LOGS_DIR / 'LATEST.md'}")
    print(f"events={len(all_events)} errors={err_n}")
    if err_n:
        print("Top errors:")
        for e in [x for x in all_events if x.get("level") == "error"][-8:]:
            print(f"  - {e.get('text')[:200]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
