#!/usr/bin/env python3
"""Analyze Hermes session JSON for audit conversation postmortem."""
import json
import sys
from collections import Counter
from pathlib import Path

SESSION = Path.home() / ".hermes/sessions/session_018d4ca7-31ce-4dc6-bbc6-b1d27a6891ca.json"


def summarize_tool(tc: dict) -> tuple[str, str]:
    fn = tc.get("function", {})
    name = fn.get("name", "?")
    args = fn.get("arguments", "")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except json.JSONDecodeError:
            pass
    brief = ""
    if isinstance(args, dict):
        if "filePath" in args:
            brief = str(args["filePath"])[-70:]
        elif "command" in args:
            brief = str(args["command"])[:90]
        elif "name" in args:
            brief = str(args.get("name", ""))[:50]
        elif "code" in args:
            brief = f"execute_code chars={len(str(args['code']))}"
        elif "path" in args:
            brief = str(args.get("path", ""))[:60]
    return name, brief


def main() -> None:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else SESSION
    data = json.loads(path.read_text(encoding="utf-8"))
    conv = None
    for k, v in data.items():
        if k in ("tools", "system_prompt"):
            continue
        if isinstance(v, list) and v and isinstance(v[0], dict) and "role" in v[0]:
            conv = v
            conv_key = k
            break
    else:
        print("No conversation array found")
        return

    print(f"File: {path}")
    print(f"session_id: {data.get('session_id')}")
    print(f"start: {data.get('session_start')} last: {data.get('last_updated')}")
    print(f"conversation key: {conv_key} messages: {len(conv)}\n")

    events: list[tuple[int, str, str]] = []
    for i, m in enumerate(conv):
        role = m.get("role")
        if role == "user":
            c = m.get("content", "")
            if isinstance(c, list):
                c = " ".join(str(x) for x in c)
            events.append((i, "USER", str(c)[:140].replace("\n", " ")))
        elif role == "assistant":
            content = m.get("content", "")
            if content and isinstance(content, str) and len(content) > 15:
                events.append((i, "ASST", content[:110].replace("\n", " ")))
            for tc in m.get("tool_calls") or []:
                n, b = summarize_tool(tc)
                events.append((i, "TOOL_CALL", f"{n} | {b}"))
        elif role == "tool":
            c = m.get("content", "")
            s = str(c)[:180].replace("\n", " ")
            low = s.lower()
            err = any(
                x in low
                for x in (
                    "error",
                    "failed",
                    "502",
                    "409",
                    "422",
                    "econnrefused",
                    "timeout",
                    "not found",
                    "enoent",
                )
            )
            events.append((i, "TOOL_RES" + (" ERR" if err else ""), s))

    out_path = path.with_suffix(".analysis.txt")
    lines = []
    lines.append("=== Timeline (condensed) ===")
    for idx, typ, txt in events:
        lines.append(f"{idx:4d} [{typ}] {txt}")
    out_path.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {out_path}")

    tc_names = [e[2].split("|")[0].strip() for e in events if e[1] == "TOOL_CALL"]
    print("\n=== Tool call counts ===")
    for n, c in Counter(tc_names).most_common(30):
        print(f"  {c:3d}  {n}")

    errs = [e for e in events if "ERR" in e[1]]
    print(f"\n=== Tool result errors: {len(errs)} ===")
    for e in errs:
        print(f"  msg#{e[0]} {e[2][:220]}")


if __name__ == "__main__":
    main()
