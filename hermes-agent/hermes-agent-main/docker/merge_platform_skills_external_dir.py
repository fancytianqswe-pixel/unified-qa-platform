#!/usr/bin/env python3
"""
When /opt/platform-skills is mounted (Docker), idempotently append it to
skills.external_dirs in HERMES_HOME/config.yaml so Gateway scans platform skills
without manual YAML editing.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import yaml

PLATFORM_MOUNT = Path("/opt/platform-skills")
HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/opt/data"))
CONFIG_PATH = HERMES_HOME / "config.yaml"


def _normalize_external_dirs(raw: object) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        s = raw.strip()
        return [s] if s else []
    if isinstance(raw, list):
        return [str(x).strip() for x in raw if str(x).strip()]
    return []


def main() -> int:
    if not PLATFORM_MOUNT.is_dir():
        print("merge_platform_skills_external_dir: /opt/platform-skills not a directory, skip", file=sys.stderr)
        return 0
    skill_md = list(PLATFORM_MOUNT.rglob("SKILL.md"))
    if not skill_md:
        print(
            "merge_platform_skills_external_dir: WARNING: mount exists but no SKILL.md under "
            f"{PLATFORM_MOUNT} — check host bind path (set PLATFORM_SKILLS_BIND to absolute path).",
            file=sys.stderr,
        )
    if not CONFIG_PATH.is_file():
        return 0
    try:
        raw_text = CONFIG_PATH.read_text(encoding="utf-8")
        data = yaml.safe_load(raw_text)
    except Exception as exc:
        print(f"merge_platform_skills_external_dir: skip (read/parse): {exc}", file=sys.stderr)
        return 0
    if not isinstance(data, dict):
        return 0

    skills = data.get("skills")
    if skills is None:
        skills = {}
        data["skills"] = skills
    elif not isinstance(skills, dict):
        print("merge_platform_skills_external_dir: skills is not a dict, skip", file=sys.stderr)
        return 0

    mount = str(PLATFORM_MOUNT)
    cur = _normalize_external_dirs(skills.get("external_dirs"))
    if mount in cur:
        return 0

    cur.append(mount)
    skills["external_dirs"] = cur
    try:
        CONFIG_PATH.write_text(
            yaml.safe_dump(data, allow_unicode=True, sort_keys=False, default_flow_style=False),
            encoding="utf-8",
        )
    except Exception as exc:
        print(f"merge_platform_skills_external_dir: write failed: {exc}", file=sys.stderr)
        return 1
    print(f"merge_platform_skills_external_dir: appended {mount} to skills.external_dirs")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
