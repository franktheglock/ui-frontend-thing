#!/usr/bin/env bash
# FLUX.2-klein-4B Web UI launcher — macOS / Linux
# Environment variables you can set before running:
#   PORT          — HTTP port (default 8000)
#   MODEL_VARIANT — e.g. bf16, fp8, gguf-q8 (default: last saved in .env, or bf16)
#   FAST_MODE     — set to 1 to skip pip reinstalls (default 1)
#   ML_BACKEND    — cuda | mps | cpu  (auto-detected if unset)

set -euo pipefail

PORT="${PORT:-8000}"
MODEL_VARIANT="${MODEL_VARIANT:-}"
FAST_MODE="${FAST_MODE:-1}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "---------------------------------------------------------"
echo " Setting up FLUX.2-klein-4B Web Environment"
echo "---------------------------------------------------------"

if [ -z "$MODEL_VARIANT" ]; then
  echo "[INFO] Model variant: auto (last saved in .env, or bf16 if unset)"
else
  echo "[INFO] Model variant override: $MODEL_VARIANT"
fi
echo "[INFO] Fast mode: $FAST_MODE"

# Cache directories — kept inside the install folder so everything is self-contained
export HF_HOME="$SCRIPT_DIR/cache/huggingface"
export TORCH_HOME="$SCRIPT_DIR/cache/torch"
export PIP_CACHE_DIR="$SCRIPT_DIR/cache/pip"
export TMPDIR="$SCRIPT_DIR/cache/tmp"
export TMP="$SCRIPT_DIR/cache/tmp"
export TEMP="$SCRIPT_DIR/cache/tmp"

mkdir -p "$SCRIPT_DIR/cache/tmp"

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
  echo "        PyTorch does not yet support Python 3.13+."
  exit 1
fi
echo "[INFO] Using Python: $PYTHON_CMD"

# ---------------------------------------------------------------------------
# Create virtual environment if it doesn't exist
# ---------------------------------------------------------------------------
if [ ! -f "$SCRIPT_DIR/venv/bin/activate" ]; then
  echo "[INFO] Creating Python virtual environment..."
  "$PYTHON_CMD" -m venv "$SCRIPT_DIR/venv"
fi

# Activate venv
# shellcheck disable=SC1091
source "$SCRIPT_DIR/venv/bin/activate"
VENV_PYTHON="$SCRIPT_DIR/venv/bin/python"

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
# ---------------------------------------------------------------------------
if [ "$FAST_MODE" != "1" ]; then
  echo "[INFO] Now beginning AI dependency downloads (~10-15 GB)..."
  echo "[INFO] Do not close this window until complete!"

  echo "[INFO] Upgrading pip..."
  "$VENV_PYTHON" -m pip install --upgrade pip -q

  echo "[INFO] Installing web server..."
  "$VENV_PYTHON" -m pip install fastapi uvicorn python-multipart

  echo "[INFO] Installing ML runtime for $GPU_BACKEND_LABEL..."
  "$VENV_PYTHON" -m pip uninstall -y torch torchvision torchaudio 2>/dev/null || true

  case "$ML_BACKEND" in
    cuda)
      "$VENV_PYTHON" -m pip install torch torchvision torchaudio \
        --index-url https://download.pytorch.org/whl/cu121 \
        --cache-dir "$PIP_CACHE_DIR"
      ;;
    *)
      # mps (Apple Silicon) and cpu both use the standard PyPI wheels
      "$VENV_PYTHON" -m pip install torch torchvision torchaudio \
        --cache-dir "$PIP_CACHE_DIR"
      ;;
  esac

  echo "[INFO] Installing remaining ML libraries..."
  "$VENV_PYTHON" -m pip install -r "$SCRIPT_DIR/requirements.txt"

  echo "[SUCCESS] All dependencies installed!"
fi

# Write the flag so the backend knows it can load the model
mkdir -p "$SCRIPT_DIR/cache/tmp"
touch "$SCRIPT_DIR/cache/tmp/ml_installed.flag"

# ---------------------------------------------------------------------------
# LAN IP info
# ---------------------------------------------------------------------------
LAN_IP=""
if command -v ip &>/dev/null; then
  LAN_IP=$(ip route get 1.0.0.0 2>/dev/null \
    | awk '{for(i=1;i<=NF;i++){if($i=="src"){print $(i+1); exit}}}')
elif command -v ifconfig &>/dev/null; then
  LAN_IP=$(ifconfig 2>/dev/null \
    | awk '/inet /{if($2!~/^127\./){print $2; exit}}')
fi

echo "[INFO] ---------------------------------------------------------"
echo "[INFO] Starting FLUX Web Server on port $PORT..."
echo "[INFO]   Local:  http://localhost:$PORT"
[ -n "$LAN_IP" ] && echo "[INFO]   LAN:    http://$LAN_IP:$PORT"
echo "[INFO] ---------------------------------------------------------"

# Run uvicorn in the foreground (this terminal becomes the server)
export MODEL_VARIANT PORT ML_BACKEND
exec "$VENV_PYTHON" -m uvicorn app:app \
  --host 0.0.0.0 \
  --port "$PORT" \
  --app-dir "$SCRIPT_DIR/backend"
