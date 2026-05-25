# 轻量 MinerU FastAPI 镜像（供与 Hermes 同 compose 使用）。
# 与上游 docker/global/Dockerfile 不同：不在构建阶段执行 mineru-models-download -m all，避免数小时构建与巨量磁盘占用。
# 首次解析时按 MINERU_MODEL_SOURCE 拉取权重（建议挂卷持久化 /root/.cache）；需 hybrid/VLM 请改用 mineru[all] 或自行扩展。
FROM python:3.12-bookworm

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=300 \
    PIP_INDEX_URL=${PIP_INDEX_URL} \
    UV_DEFAULT_INDEX=${PIP_INDEX_URL} \
    MINERU_MODEL_SOURCE=modelscope

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    fonts-noto-cjk \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

# PyTorch：mineru[pipeline] 默认拉 cu130，与 Docker Desktop 常见 12.7 驱动不兼容；固定 cu124 + 完整 nvidia-* 运行时 wheel
ARG TORCH_CUDA_INDEX=https://download.pytorch.org/whl/cu124

RUN python -m pip install -i "${PIP_INDEX_URL}" --retries 10 --timeout 300 -U "pip>=24" "uv>=0.5,<0.12" \
    && uv pip install --system --break-system-packages \
         --index-url "${TORCH_CUDA_INDEX}" "torch==2.5.1" "torchvision==0.20.1" \
    && uv pip install --system --break-system-packages --index-url "${PIP_INDEX_URL}" "mineru[pipeline]>=3.0.0" \
    && uv pip install --system --break-system-packages --force-reinstall \
         --index-url "${TORCH_CUDA_INDEX}" "torch==2.5.1" "torchvision==0.20.1"

EXPOSE 8000

ENTRYPOINT ["mineru-api"]
CMD ["--host", "0.0.0.0", "--port", "8000"]
