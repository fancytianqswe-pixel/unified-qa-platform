#!/usr/bin/env bash
# 在 WSL 内下载 MinerU 解析所需权重（ModelScope），并写入当前用户 $HOME/mineru.json。
# 解决 mineru-api /health 中 failed_tasks 飙升、日志 LocalEntryNotFoundError / Hub 拉取失败等问题。
#
# 用法（在 WSL 内，建议与运行 mineru-api 同一用户，如 root 装 venv 则用 sudo -i 后执行）:
#   bash scripts/wsl-download-mineru-models.sh
# 或从 Windows:
#   wsl -d Ubuntu-24.04 -- bash /mnt/c/.../cursor/scripts/wsl-download-mineru-models.sh
#
# 依赖: 已安装 mineru 且 PATH 或常见路径下存在 mineru-models-download
set -euo pipefail

export MINERU_MODEL_SOURCE=modelscope
if [[ -n "${UV_DEFAULT_INDEX:-}" ]]; then
  :
else
  export UV_DEFAULT_INDEX="${MINERU_PYPI_MIRROR:-https://pypi.tuna.tsinghua.edu.cn/simple}"
fi

resolve_downloader() {
  if command -v mineru-models-download >/dev/null 2>&1; then
    command -v mineru-models-download
    return 0
  fi
  for c in "$HOME/mineru-venv/bin/mineru-models-download" "/root/mineru-venv/bin/mineru-models-download"; do
    if [[ -x "$c" ]]; then
      echo "$c"
      return 0
    fi
  done
  return 1
}

DL="$(resolve_downloader)" || {
  echo "未找到 mineru-models-download。请先在 WSL 内安装 MinerU，例如:"
  echo "  uv pip install -U \"mineru[all]\"   # 或 mineru[pipeline] 再按需补 vlm"
  exit 1
}

echo "使用: $DL （ModelScope 源）"
echo ">>> 1/2 下载 pipeline 模型（layout 等）…"
"$DL" -s modelscope -m pipeline
echo ">>> 2/2 下载 vlm 模型（hybrid / 含图 PDF 需要，体积较大）…"
"$DL" -s modelscope -m vlm

echo ""
echo "下载完成。已写入或更新: $HOME/mineru.json"
echo "下一步:"
echo "  1) 停止旧进程:  kill \$(cat /tmp/mineru-api.pid 2>/dev/null) 2>/dev/null || true"
echo "  2) 启动 API 前建议: export MINERU_MODEL_SOURCE=local"
echo "  3) 重新执行: bash scripts/wsl-start-mineru-api.sh（或 Start-MineruApi-Wsl.ps1）"
echo "  4) 再访问 /health，failed_tasks 应不再随新任务持续上涨。"
