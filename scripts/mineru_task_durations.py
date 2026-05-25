#!/usr/bin/env python3
"""从 mineru-api 容器内拉取若干 task_id 的耗时（排队/执行/总）。用法见脚本末尾。"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime


def parse_iso(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fetch_task(base: str, task_id: str) -> dict:
    url = f"{base.rstrip('/')}/tasks/{task_id}"
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main() -> int:
    base = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000"
    ids = sys.argv[2:]
    if not ids:
        print(
            "用法: python mineru_task_durations.py <MINERU_API_BASE_URL> <task_id> [task_id ...]\n"
            "示例（在 mineru-api 容器内）: python3 /path/mineru_task_durations.py http://127.0.0.1:8000 <uuid>",
            file=sys.stderr,
        )
        return 2
    print(f"base={base}")
    for tid in ids:
        try:
            j = fetch_task(base, tid)
        except urllib.error.HTTPError as e:
            print(f"{tid}\tHTTP {e.code}\t{e.reason}")
            continue
        c, s, e = map(parse_iso, (j.get("created_at"), j.get("started_at"), j.get("completed_at")))
        q = (s - c).total_seconds() if c and s else None
        run = (e - s).total_seconds() if s and e else None
        tot = (e - c).total_seconds() if c and e else None
        names = j.get("file_names") or []
        fn = names[0] if names else ""
        print(
            f"{tid}\tstatus={j.get('status')}\tqueue_s={q if q is not None else '?'}\t"
            f"run_s={run if run is not None else '?'}\ttotal_s={tot if tot is not None else '?'}\tfile={fn[:60]!r}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
