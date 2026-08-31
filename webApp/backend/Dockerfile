# syntax=docker/dockerfile:1

FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    cmake \
    ninja-build \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /build

# Torch CPU-only: el índice oficial de PyPI trae CUDA por defecto y añade
# varios GB innecesarios en un VPS sin GPU (core/model_service.py fija
# cfg.MODEL.DEVICE = "cpu" explícitamente, así que nunca se usa CUDA).
RUN pip install torch==2.9.0 torchvision==0.24.0 \
    --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
# --no-build-isolation: detectron2 importa torch dentro de su propio setup.py
# para decidir qué extensiones compilar; con aislamiento de build (default de
# pip) no ve el torch ya instalado en este venv y falla con "No module named
# torch". Sin aislamiento, el build usa este entorno tal cual.
RUN pip install --no-build-isolation -r requirements.txt --extra-index-url https://download.pytorch.org/whl/cpu


FROM python:3.11-slim AS runtime

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin appuser

COPY --from=builder /opt/venv /opt/venv

WORKDIR /app
COPY . .

# Los pesos del modelo (model/*.pth, ~315MB) no viven en la imagen: se
# montan como volumen de solo lectura desde docker-compose.yml, igual que
# uploads/ (volumen con datos persistentes) y tmp/ (scratch).
RUN mkdir -p uploads tmp model && chown -R appuser:appuser /app

USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
