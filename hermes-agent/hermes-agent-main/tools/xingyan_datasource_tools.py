#!/usr/bin/env python3
"""
统一质检平台数据源工具（Hermes API Server 内置）

与 `mcp-servers/datasource-mcp` 语义一致：通过 HTTP 调用 Next
`POST /api/datasource/test|columns|preview`，供 Hermes 网关内模型直接 tool-call。
无需再单独挂同名 stdio MCP（MCP 侧工具名通常为 mcp_<服务>_<工具>，与本模块无冲突）。

环境变量：
- DATASOURCE_MCP_BASE_URL / XINGYAN_BFF_URL：Next 根地址，默认 http://127.0.0.1:3000
- HERMES_XINGYAN_DATASOURCE_TOOLS：设为 0/false/off 可关闭本组工具注册
"""
from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from typing import Any, Dict

logger = logging.getLogger(__name__)

_CONN_PROPS = {
    "name": {"type": "string", "description": "数据源显示名称"},
    "dbKind": {
        "type": "string",
        "enum": ["mysql", "postgresql", "sqlserver", "oracle", "sqlite"],
        "description": "数据库种类",
    },
    "host": {"type": "string"},
    "port": {"type": "string", "description": "端口数字字符串，如 3306"},
    "database": {"type": "string"},
    "table": {"type": "string"},
    "username": {"type": "string"},
    "password": {"type": "string"},
}
_CONN_REQUIRED = ["name", "dbKind", "host", "port", "database", "table", "username", "password"]


def _base_url() -> str:
    raw = (
        os.environ.get("DATASOURCE_MCP_BASE_URL")
        or os.environ.get("XINGYAN_BFF_URL")
        or "http://127.0.0.1:3000"
    )
    return str(raw).strip().rstrip("/")


def check_xingyan_datasource_tools() -> bool:
    v = os.environ.get("HERMES_XINGYAN_DATASOURCE_TOOLS", "1").strip().lower()
    if v in ("0", "false", "no", "off"):
        return False
    return True


def _as_db_payload(args: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "name": str(args.get("name", "")).strip(),
        "type": "db",
        "dbKind": str(args.get("dbKind", "mysql")).lower(),
        "host": str(args.get("host", "")).strip(),
        "port": str(args.get("port", "")).strip(),
        "database": str(args.get("database", "")).strip(),
        "table": str(args.get("table", "")).strip(),
        "username": str(args.get("username", "")).strip(),
        "password": str(args.get("password", "")),
    }


def _post_json(path: str, body: Dict[str, Any]) -> str:
    base = _base_url()
    p = path if path.startswith("/") else f"/{path}"
    url = f"{base}{p}"
    data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            status = getattr(resp, "status", 200) or 200
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace") if e.fp else ""
        status = int(e.code)
    except Exception as e:
        logger.warning("xingyan datasource HTTP %s failed: %s", url, e)
        return json.dumps({"ok": False, "error": str(e)}, ensure_ascii=False)
    try:
        parsed = json.loads(raw) if raw.strip() else None
    except json.JSONDecodeError:
        parsed = {"_raw": raw}
    out: Dict[str, Any] = {"httpStatus": status}
    if isinstance(parsed, dict):
        out.update(parsed)
    else:
        out["body"] = parsed
    return json.dumps(out, ensure_ascii=False)


def _handle_test(args: Dict[str, Any], **_: Any) -> str:
    return _post_json("/api/datasource/test", _as_db_payload(args))


def _handle_columns(args: Dict[str, Any], **_: Any) -> str:
    return _post_json("/api/datasource/columns", _as_db_payload(args))


def _handle_preview(args: Dict[str, Any], **_: Any) -> str:
    body = _as_db_payload(args)
    sf = args.get("selectedFields")
    if isinstance(sf, list) and sf:
        body["selectedFields"] = [str(x).strip() for x in sf if str(x).strip()]
    return _post_json("/api/datasource/preview", body)


def _handle_guidance(args: Dict[str, Any], **_: Any) -> str:
    msg = (
        "保存边界：工具与 BFF 均无法直接写入用户浏览器 localStorage。\n"
        "请在八项确认且 test 通过后，在回复末尾输出 ```hermes-datasource` + JSON（八键小写）"
        "或兼容 ```yaml`，以便前端注入「数据源草稿卡」；用户再在卡片上完成保存。\n"
        "存储键：datacenter.datasources.v1（仅浏览器端）。"
    )
    return json.dumps({"ok": True, "message": msg}, ensure_ascii=False)


_TEST_SCHEMA = {
    "name": "datasource_test_connection",
    "description": (
        "数据库连通性探测；等价 Next POST /api/datasource/test（与草稿卡/数据中心同源）。"
        "八项齐备后优先调用以确认可连，再在回复末尾输出 hermes-datasource 或兼容 yaml 生成草稿卡。"
    ),
    "parameters": {"type": "object", "required": _CONN_REQUIRED, "properties": _CONN_PROPS},
}

_COLUMNS_SCHEMA = {
    "name": "datasource_list_columns",
    "description": (
        "读取表字段（当前实现为 MySQL SHOW COLUMNS）；等价 POST /api/datasource/columns。"
        "仅在 test 已通过且 dbKind=mysql 时使用。"
    ),
    "parameters": {"type": "object", "required": _CONN_REQUIRED, "properties": _CONN_PROPS},
}

_PREVIEW_SCHEMA = {
    "name": "datasource_preview_sample",
    "description": (
        "最多 5 行样例；等价 POST /api/datasource/preview。可选 selectedFields 指定列子集。"
        "仅在 MySQL 且连接可用时使用。"
    ),
    "parameters": {
        "type": "object",
        "required": _CONN_REQUIRED,
        "properties": {
            **_CONN_PROPS,
            "selectedFields": {
                "type": "array",
                "items": {"type": "string"},
                "description": "可选；要查询的列名列表",
            },
        },
    },
}

_GUIDANCE_SCHEMA = {
    "name": "datasource_save_guidance",
    "description": (
        "无副作用：复述如何将连接写入「数据中心」的边界说明。"
        "持久化只能由用户在浏览器点击草稿卡「保存到数据中心」完成。"
    ),
    "parameters": {"type": "object", "properties": {}, "required": []},
}


from tools.registry import registry

_TS = "xingyan_datasource"

registry.register(
    name="datasource_test_connection",
    toolset=_TS,
    schema=_TEST_SCHEMA,
    handler=_handle_test,
    check_fn=check_xingyan_datasource_tools,
    emoji="🔗",
)
registry.register(
    name="datasource_list_columns",
    toolset=_TS,
    schema=_COLUMNS_SCHEMA,
    handler=_handle_columns,
    check_fn=check_xingyan_datasource_tools,
    emoji="📋",
)
registry.register(
    name="datasource_preview_sample",
    toolset=_TS,
    schema=_PREVIEW_SCHEMA,
    handler=_handle_preview,
    check_fn=check_xingyan_datasource_tools,
    emoji="🔎",
)
registry.register(
    name="datasource_save_guidance",
    toolset=_TS,
    schema=_GUIDANCE_SCHEMA,
    handler=_handle_guidance,
    check_fn=check_xingyan_datasource_tools,
    emoji="💾",
)
