#!/usr/bin/env bash
# 在 WSL Ubuntu 中启动 MinerU FastAPI（供 Windows 上 Hermes / mineru-api-mcp 访问）。
# 用法（在 Windows PowerShell）:
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/Users/.../cursor/scripts/wsl-start-mineru-api.sh
# 或先进入发行版再: bash scripts/wsl-start-mineru-api.sh
set -euo pipefail

HOST="${MINERU_API_LISTEN_HOST:-0.0.0.0}"
PORT="${MINERU_API_LISTEN_PORT:-8000}"
LOG="${MINERU_API_LOG:-/tmp/mineru-api.log}"
PIDFILE="${MINERU_API_PIDFILE:-/tmp/mineru-api.pid}"

resolve_mineru_api() {
  if command -v mineru-api >/dev/null 2>&1; then
    command -v mineru-api
    return 0
  fi
  for candidate in \
    "$HOME/mineru-venv/bin/mineru-api" \
    "/tmp/mu-api-venv/bin/mineru-api" \
    "/root/mineru-venv/bin/mineru-api"; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

BIN="$(resolve_mineru_api)" || {
  echo "未找到 mineru-api。请先在 WSL 内完成安装，例如:"
  echo "  pip install uv && uv pip install -U \"mineru[pipeline]\""
  echo "或官方文档: https://github.com/opendatalab/MinerU"
  exit 1
}

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "mineru-api 已在运行 (PID $(cat "$PIDFILE"))。日志: $LOG"
  exit 0
fi

# 有 mineru.json 时默认走本地权重；否则默认 modelscope，避免 MINERU_MODEL_SOURCE=local 却无缓存时
# VLM 仍去 HuggingFace 拉 opendatalab/MinerU2.5-* 导致 LocalEntryNotFoundError、/health failed_tasks 暴涨。
# 首次部署请先在 WSL 执行: bash scripts/wsl-download-mineru-models.sh
if [[ -f "$HOME/mineru.json" ]]; then
  export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-local}"
else
  export MINERU_MODEL_SOURCE="${MINERU_MODEL_SOURCE:-modelscope}"
  echo "提示: 未发现 $HOME/mineru.json，已使用 MINERU_MODEL_SOURCE=modelscope（解析时会从 ModelScope 拉模型）。"
  echo "      建议下载完成后执行本仓库 scripts/wsl-download-mineru-models.sh，再设 MINERU_MODEL_SOURCE=local 重启。"
fi

nohup "$BIN" --host "$HOST" --port "$PORT" >>"$LOG" 2>&1 &
echo $! >"$PIDFILE"
echo "已启动 mineru-api: $BIN --host $HOST --port $PORT"
echo "PID $(cat "$PIDFILE")，日志 $LOG"
echo "在 Windows 浏览器或 MCP 中可试: http://127.0.0.1:${PORT}/health （依赖 WSL localhost 转发）"
