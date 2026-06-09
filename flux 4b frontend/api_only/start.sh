#!/usr/bin/env bash
# FLUX.2-klein-4B API-only launcher — macOS / Linux
# Environment variables you can set before running:
#   PORT          — HTTP port (default 8000)
#   MODEL_VARIANT — e.g. gguf-q4-1, bf16, fp8 (default gguf-q4-1)
#   FAST_MODE     — set to 1 to skip pip reinstalls (default 1)
#   ML_BACKEND    — cuda | mps | cpu  (auto-detected if unset)

set -euo pipefail

PORT="${PORT:-8000}"
MODEL_VARIANT="${MODEL_VARIANT:-gguf-q4-1}"
FAST_MODE="${FAST_MODE:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "---------------------------------------------------------"
echo " FLUX.2-klein-4B Image API"
echo "---------------------------------------------------------"
echo "[INFO] Model variant: $MODEL_VARIANT"
echo "[INFO] Fast mode: $FAST_MODE"

# Cache directories — kept inside this folder (no drive-letter dependency)
CACHE_DIR="$PARENT_DIR/cache"
export HF_HOME="$CACHE_DIR/huggingface"
export TORCH_HOME="$CACHE_DIR/torch"
export PIP_CACHE_DIR="$CACHE_DIR/pip"
export TMPDIR="$CACHE_DIR/tmp"
export TMP="$CACHE_DIR/tmp"
export TEMP="$CACHE_DIR/tmp"
export OUTPUT_DIR="$PARENT_DIR/outputs"

mkdir -p "$CACHE_DIR/huggingface" "$CACHE_DIR/torch" "$CACHE_DIR/pip" \
         "$CACHE_DIR/tmp" "$OUTPUT_DIR"

# ---------------------------------------------------------------------------
# Find a compatible Python (3.10, 3.11, or 3.12)
# ---------------------------------------------------------------------------
PYTHON_CMD=""
for ver in 3.12 3.11 3.10; do
  if command -v "python$ver" &>/dev/null; then
    PYTHON_CMD="python$ver"
    break
  fi
done

if [ -z "$PYTHON_CMD" ] && command -v python3 &>/dev/null; then
  VER=$(python3 --version 2>&1 | awk '{print $2}')
  case "$VER" in
    3.10.*|3.11.*|3.12.*) PYTHON_CMD="python3" ;;
  esac
fi

if [ -z "$PYTHON_CMD" ]; then
  echo "[ERROR] Could not find Python 3.10, 3.11, or 3.12."
  exit 1
fi
echo "[INFO] Using Python: $PYTHON_CMD"

# ---------------------------------------------------------------------------
# Use parent venv if it exists, otherwise create one in the parent dir
# ---------------------------------------------------------------------------
VENV_DIR="$PARENT_DIR/venv"
if [ ! -f "$VENV_DIR/bin/activate" ]; then
  echo "[INFO] Creating Python virtual environment in parent directory..."
  "$PYTHON_CMD" -m venv "$VENV_DIR"
fi

# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
VENV_PYTHON="$VENV_DIR/bin/python"

echo "[INFO] Python version: $("$VENV_PYTHON" --version)"

# ---------------------------------------------------------------------------
# GPU / ML backend detection
# ---------------------------------------------------------------------------
if [ -z "${ML_BACKEND:-}" ]; then
  if command -v nvidia-smi &>/dev/null; then
    ML_BACKEND="cuda"
    GPU_BACKEND_LABEL="NVIDIA CUDA"
  elif [[ "$(uname)" == "Darwin" ]]; then
    ML_BACKEND="mps"
    GPU_BACKEND_LABEL="Apple Metal (MPS)"
  else
    ML_BACKEND="cpu"
    GPU_BACKEND_LABEL="CPU"
  fi
else
  GPU_BACKEND_LABEL="$ML_BACKEND"
fi
# MPS: allow ops not yet on Metal to fall back to CPU instead of crashing
[ "$ML_BACKEND" = "mps" ] && export PYTORCH_ENABLE_MPS_FALLBACK=1
echo "[INFO] ML backend: $ML_BACKEND ($GPU_BACKEND_LABEL)"

# ---------------------------------------------------------------------------
# Install dependencies (skipped in fast mode)
# ---------------------------------------------------------------------------
if [ "$FAST_MODE" != "1" ]; then
  echo "[INFO] Installing dependencies (~10-15 GB)..."

  "$VENV_PYTHON" -m pip install --upgrade pip -q
  "$VENV_PYTHON" -m pip install fastapi uvicorn python-multipart

  "$VENV_PYTHON" -m pip uninstall -y torch torchvision torchaudio 2>/dev/null || true

  case "$ML_BACKEND" in
    cuda)
      "$VENV_PYTHON" -m pip install torch torchvision torchaudio \
        --index-url https://download.pytorch.org/whl/cu121 \
        --cache-dir "$PIP_CACHE_DIR"
      ;;
    *)
      "$VENV_PYTHON" -m pip install torch torchvision torchaudio \
        --cache-dir "$PIP_CACHE_DIR"
      ;;
  esac

  "$VENV_PYTHON" -m pip install -r "$SCRIPT_DIR/requirements.txt"

  rm -f "$CACHE_DIR/tmp/ml_installed.flag"
  touch "$CACHE_DIR/tmp/ml_installed.flag"
  echo "[SUCCESS] Dependencies installed."
else
  [ ! -f "$CACHE_DIR/tmp/ml_installed.flag" ] && touch "$CACHE_DIR/tmp/ml_installed.flag" || true
fi

echo "[INFO] Starting API server on port $PORT..."
export MODEL_VARIANT PORT ML_BACKEND
exec "$VENV_PYTHON" "$SCRIPT_DIR/app.py"
