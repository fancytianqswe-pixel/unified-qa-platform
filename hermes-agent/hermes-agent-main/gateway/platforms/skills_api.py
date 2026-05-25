"""
Skill catalog HTTP helpers for the API server.

Surfaces Hermes on-disk skills (~/.hermes/skills + external_dirs) as JSON
compatible with the platform dashboard BFF (/api/skills/list, detail, register).
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


def _make_skill_id(root_idx: int, skills_dir: Path, skill_dir: Path) -> str:
    rel = skill_dir.resolve().relative_to(skills_dir.resolve()).as_posix()
    return f"h{root_idx}:{rel}"


def _parse_skill_id(skill_id: str) -> Optional[Tuple[int, str]]:
    """Parse ``h{idx}:{relpath}`` returned by _make_skill_id."""
    if not skill_id or not skill_id.startswith("h"):
        return None
    rest = skill_id[1:]
    idx_str, sep, rel = rest.partition(":")
    if not sep or not rel:
        return None
    try:
        idx = int(idx_str)
    except ValueError:
        return None
    if rel.startswith("/") or ".." in rel.split("/"):
        return None
    return idx, rel


def _default_icon(name: str) -> str:
    s = (name or "?").strip()
    if not s:
        return "?"
    ch = s[0]
    return ch.upper() if ch.isascii() and ch.isalpha() else "📦"


def _mtime_iso(skill_md: Path) -> str:
    try:
        ts = skill_md.stat().st_mtime
        return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
    except OSError:
        return datetime.now(tz=timezone.utc).strftime("%Y-%m-%d")


def _slugify_skill_name(name: str) -> str:
    raw = (name or "").lower().strip().replace(" ", "-")
    raw = re.sub(r"[^a-z0-9._-]+", "-", raw)
    raw = re.sub(r"-{2,}", "-", raw).strip("-")
    if not raw:
        raw = "skill"
    if not re.match(r"^[a-z0-9]", raw):
        raw = "s-" + raw
    if len(raw) > 64:
        raw = raw[:64].rstrip("-._")
    if not raw or raw in ("skill", "s"):
        digest = hashlib.sha256((name or "").encode("utf-8")).hexdigest()[:10]
        raw = f"skill-{digest}"
    return raw[:64]


def _skill_dict_from_skill_md(
    skill_md: Path,
    root_idx: int,
    skills_dir: Path,
    *,
    include_document: bool,
    disabled: set,
) -> Optional[Dict[str, Any]]:
    from agent.skill_utils import parse_frontmatter, skill_matches_platform

    try:
        raw = skill_md.read_text(encoding="utf-8")
        frontmatter, _body = parse_frontmatter(raw)
    except Exception as e:
        logger.debug("skip skill file %s: %s", skill_md, e)
        return None

    if not skill_matches_platform(frontmatter):
        return None

    skill_name = str(frontmatter.get("name") or skill_md.parent.name).strip()
    if skill_name in disabled:
        return None

    desc = str(frontmatter.get("description") or "").strip()
    if len(desc) > 2000:
        desc = desc[:1997] + "..."

    skill_id = _make_skill_id(root_idx, skills_dir, skill_md.parent)
    author = str(frontmatter.get("author") or "Hermes").strip() or "Hermes"
    tags = frontmatter.get("tags")
    category = "通用工具"
    if isinstance(tags, list) and tags:
        category = str(tags[0]).strip() or category
    elif isinstance(tags, str) and tags.strip():
        category = tags.strip()

    sample = str(frontmatter.get("example") or frontmatter.get("sample_prompt") or desc).strip()
    if len(sample) > 500:
        sample = sample[:497] + "..."

    entry: Dict[str, Any] = {
        "id": skill_id,
        "icon": _default_icon(skill_name),
        "name": skill_name,
        "author": author,
        "version": str(frontmatter.get("version") or "1.0.0"),
        "source": "system",
        "status": "published",
        "rating": 0,
        "usageCount": 0,
        "description": desc or skill_name,
        "samplePrompt": sample or f"使用技能「{skill_name}」完成任务",
        "params": [],
        "config": {"url": "", "sql": "", "threshold": 0},
        "category": category,
        "catalogSection": "Hermes",
        "badgeLabel": "Hermes",
        "listScope": "market",
        "updatedAt": _mtime_iso(skill_md),
    }
    if include_document:
        entry["skillDocMarkdown"] = raw
    return entry


def list_skills_json(*, include_document: bool = False) -> List[Dict[str, Any]]:
    """Return dashboard-shaped skill dicts for every discoverable SKILL.md."""
    from agent.skill_utils import get_all_skills_dirs, get_disabled_skill_names, iter_skill_index_files

    disabled = get_disabled_skill_names()
    roots = get_all_skills_dirs()
    out: List[Dict[str, Any]] = []

    for root_idx, skills_dir in enumerate(roots):
        if not skills_dir.is_dir():
            continue
        try:
            skills_dir = skills_dir.resolve()
        except OSError:
            continue

        for skill_md in iter_skill_index_files(skills_dir, "SKILL.md"):
            item = _skill_dict_from_skill_md(
                skill_md, root_idx, skills_dir, include_document=include_document, disabled=disabled
            )
            if item:
                out.append(item)

    return out


def get_skill_detail(skill_id: str) -> Optional[Dict[str, Any]]:
    """Load one skill by ``h{idx}:{relpath}`` id."""
    from agent.skill_utils import get_all_skills_dirs, get_disabled_skill_names

    parsed = _parse_skill_id(skill_id)
    if not parsed:
        return None
    root_idx, rel = parsed
    roots = get_all_skills_dirs()
    if root_idx < 0 or root_idx >= len(roots):
        return None
    skills_dir = roots[root_idx]
    try:
        skills_dir = skills_dir.resolve()
    except OSError:
        return None
    skill_md = (skills_dir / rel / "SKILL.md").resolve()
    try:
        skill_md.relative_to(skills_dir)
    except ValueError:
        return None
    if not skill_md.is_file():
        return None

    disabled = get_disabled_skill_names()
    return _skill_dict_from_skill_md(
        skill_md, root_idx, skills_dir, include_document=True, disabled=disabled
    )


def register_skill_from_center(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    Create ~/.hermes/skills/<slug>/SKILL.md from dashboard registration payload.

    Expected keys: name, description, scene; optional sessionId, taskId.
    """
    from tools.skill_manager_tool import _create_skill

    name = str(body.get("name") or "").strip()
    description = str(body.get("description") or "").strip()
    scene = str(body.get("scene") or "").strip()
    session_id = str(body.get("sessionId") or "").strip()
    task_id = str(body.get("taskId") or "").strip()

    if not name or not description or not scene:
        return {"ok": False, "message": "name/description/scene 均为必填"}

    slug = _slugify_skill_name(name)
    safe_desc = json.dumps(description, ensure_ascii=False)[:1024]

    frontmatter = "\n".join(
        [
            "name: " + json.dumps(slug, ensure_ascii=False),
            "description: " + safe_desc,
            'author: "Hermes"',
        ]
    )
    extra = []
    if session_id:
        extra.append(f"- sessionId: `{session_id}`")
    if task_id:
        extra.append(f"- taskId: `{task_id}`")
    extra_block = "\n".join(extra) if extra else "_（无会话关联）_"

    content = f"""---
{frontmatter}
---

# {name}

**场景**（scene）: {scene}

{extra_block}

## 使用说明

本技能由技能中心注册；请在 Hermes 中打开 `~/.hermes/skills/{slug}/` 完善 SKILL.md 与脚本。

注册时间（UTC）: {time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
"""
    result = _create_skill(slug, content, category=None)
    if not result.get("success"):
        return {
            "ok": False,
            "message": str(result.get("error") or "Hermes 创建技能失败"),
        }
    return {
        "ok": True,
        "skillId": slug,
        "version": "1.0.0",
        "message": str(result.get("message") or "已在 Hermes 技能目录创建 SKILL.md"),
    }
