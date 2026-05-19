import os
import io
import base64
import time
import threading
import sys
import collections
import traceback
import asyncio
import gc
import glob
import json
import re
import subprocess
from fastapi import FastAPI, HTTPException, Form, File, UploadFile, BackgroundTasks
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from PIL import Image, ImageOps

REPO_DIR = os.path.dirname(os.path.dirname(__file__))
if REPO_DIR not in sys.path:
    sys.path.insert(0, REPO_DIR)

from gpu_backend import configure_pipeline_device, create_generator, get_backend_config, get_model_dtype, release_memory

app = FastAPI()

# Log buffer for terminal streaming
logs_deque = collections.deque(maxlen=100)

class LogStreamer:
    def __init__(self, stream):
        self.stream = stream

    def write(self, data):
        self.stream.write(data)
        if data.strip():
            logs_deque.append(data.strip())

    def flush(self):
        self.stream.flush()

sys.stdout = LogStreamer(sys.stdout)
sys.stderr = LogStreamer(sys.stderr)

# Mount frontend
BASE_DIR = REPO_DIR
CACHE_DIR = os.path.join(BASE_DIR, "cache")
HF_HOME = os.path.join(CACHE_DIR, "huggingface")
TORCH_HOME = os.path.join(CACHE_DIR, "torch")
PIP_CACHE_DIR = os.path.join(CACHE_DIR, "pip")
TMP_DIR = os.path.join(CACHE_DIR, "tmp")
BACKEND_CONFIG = get_backend_config()

os.makedirs(HF_HOME, exist_ok=True)
os.makedirs(TORCH_HOME, exist_ok=True)
os.makedirs(PIP_CACHE_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)

os.environ.setdefault("HF_HOME", HF_HOME)
os.environ.setdefault("HUGGINGFACE_HUB_CACHE", os.path.join(HF_HOME, "hub"))
os.environ.setdefault("TORCH_HOME", TORCH_HOME)
os.environ.setdefault("PIP_CACHE_DIR", PIP_CACHE_DIR)
os.environ.setdefault("TMPDIR", TMP_DIR)
os.environ.setdefault("TMP", TMP_DIR)
os.environ.setdefault("TEMP", TMP_DIR)

PUBLIC_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public")
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "outputs")
os.makedirs(PUBLIC_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)
app.mount("/interface", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
app.mount("/outputs", StaticFiles(directory=OUTPUT_DIR), name="outputs")

@app.get("/")
def read_root():
    return RedirectResponse(url="/interface/index.html")

# Model Loading Status Tracking
model_status = {
    "loaded": False,
    "status": "loading", # start in loading state for UI
    "message": "Waiting for dependency installation to complete...",
    "progress": {"step": 0, "total": 0},
    "selected_variant": None,
    "variant_label": None,
    "variant_size": None,
    "backend": BACKEND_CONFIG.backend,
    "backend_label": BACKEND_CONFIG.label,
}

pipe = None
loaded_variant = None
model_lock = threading.Lock()
gpu_info_cache = None
flag_path = os.path.join(os.path.dirname(PUBLIC_DIR), "cache", "tmp", "ml_installed.flag")
ENV_FILE_PATH = os.path.join(BASE_DIR, ".env")


def read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    if not os.path.exists(ENV_FILE_PATH):
        return values

    with open(ENV_FILE_PATH, "r", encoding="utf-8") as env_file:
        for raw_line in env_file:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def write_env_value(key: str, value: str) -> None:
    env_values = read_env_file()
    env_values[key] = value
    with open(ENV_FILE_PATH, "w", encoding="utf-8") as env_file:
        for env_key, env_value in env_values.items():
            env_file.write(f"{env_key}={env_value}\n")


def resolve_default_model_variant() -> str:
    env_override = os.environ.get("MODEL_VARIANT")
    if env_override:
        return env_override

    persisted_variant = read_env_file().get("MODEL_VARIANT")
    if persisted_variant:
        return persisted_variant

    return "gguf-q8-0"


DEFAULT_MODEL_VARIANT = resolve_default_model_variant()


def make_gguf_variant(label: str, size: str, gguf_file: str) -> dict:
    return {
        "label": label,
        "size": size,
        "loader": "gguf_single_file",
        "base_repo_id": "black-forest-labs/FLUX.2-klein-4B",
        "repo_id": "unsloth/FLUX.2-klein-4B-GGUF",
        "gguf_file": gguf_file,
        "gguf_url": f"https://huggingface.co/unsloth/FLUX.2-klein-4B-GGUF/resolve/main/{gguf_file}",
        "torch_dtype": "bfloat16",
    }

MODEL_VARIANTS = {
    "bf16": {
        "label": "BF16",
        "size": "~13GB",
        "loader": "diffusers",
        "repo_id": "black-forest-labs/FLUX.2-klein-4B",
        "torch_dtype": "bfloat16",
    },
    "fp8": {
        "label": "FP8",
        "size": "~8GB",
        "loader": "torchao_fp8_static",
        "repo_id": "photoroom/FLUX.2-klein-4b-fp8-diffusers",
        "torch_dtype": "bfloat16",
    },
    "gguf-bf16": make_gguf_variant("BF16 GGUF", "~7.75GB", "flux-2-klein-4b-BF16.gguf"),
    "gguf-f16": make_gguf_variant("F16 GGUF", "~7.75GB", "flux-2-klein-4b-F16.gguf"),
    "gguf-q2-k": make_gguf_variant("Q2_K GGUF", "~1.83GB", "flux-2-klein-4b-Q2_K.gguf"),
    "gguf-q3-k-m": make_gguf_variant("Q3_K_M GGUF", "~2.12GB", "flux-2-klein-4b-Q3_K_M.gguf"),
    "gguf-q3-k-s": make_gguf_variant("Q3_K_S GGUF", "~2.10GB", "flux-2-klein-4b-Q3_K_S.gguf"),
    "gguf-q4-0": make_gguf_variant("Q4_0 GGUF", "~2.46GB", "flux-2-klein-4b-Q4_0.gguf"),
    "gguf-q4-1": make_gguf_variant("Q4_1 GGUF", "~2.69GB", "flux-2-klein-4b-Q4_1.gguf"),
    "gguf-q4-k-m": make_gguf_variant("Q4_K_M GGUF", "~2.60GB", "flux-2-klein-4b-Q4_K_M.gguf"),
    "gguf-q4-k-s": make_gguf_variant("Q4_K_S GGUF", "~2.58GB", "flux-2-klein-4b-Q4_K_S.gguf"),
    "gguf-q5-0": make_gguf_variant("Q5_0 GGUF", "~2.92GB", "flux-2-klein-4b-Q5_0.gguf"),
    "gguf-q5-1": make_gguf_variant("Q5_1 GGUF", "~3.15GB", "flux-2-klein-4b-Q5_1.gguf"),
    "gguf-q5-k-m": make_gguf_variant("Q5_K_M GGUF", "~3.07GB", "flux-2-klein-4b-Q5_K_M.gguf"),
    "gguf-q5-k-s": make_gguf_variant("Q5_K_S GGUF", "~3.05GB", "flux-2-klein-4b-Q5_K_S.gguf"),
    "gguf-q6-k": make_gguf_variant("Q6_K GGUF", "~3.41GB", "flux-2-klein-4b-Q6_K.gguf"),
    "gguf-q8-0": make_gguf_variant("Q8_0 GGUF", "~4.30GB", "flux-2-klein-4b-Q8_0.gguf"),
}

MODEL_VARIANT_ALIASES = {
    "bf16": "bf16",
    "full": "bf16",
    "full-bf16": "bf16",
    "fp8": "fp8",
    "gguf-bf16": "gguf-bf16",
    "bf16-gguf": "gguf-bf16",
    "gguf-f16": "gguf-f16",
    "f16-gguf": "gguf-f16",
    "gguf-q2-k": "gguf-q2-k",
    "q2k": "gguf-q2-k",
    "q2-k": "gguf-q2-k",
    "gguf-q3-k-m": "gguf-q3-k-m",
    "q3km": "gguf-q3-k-m",
    "q3-k-m": "gguf-q3-k-m",
    "gguf-q3": "gguf-q3-k-m",
    "q3": "gguf-q3-k-m",
    "gguf-q3-k-s": "gguf-q3-k-s",
    "q3ks": "gguf-q3-k-s",
    "q3-k-s": "gguf-q3-k-s",
    "gguf-q4-0": "gguf-q4-0",
    "q4-0": "gguf-q4-0",
    "q40": "gguf-q4-0",
    "gguf-q4-1": "gguf-q4-1",
    "q4-1": "gguf-q4-1",
    "q41": "gguf-q4-1",
    "gguf-q4-k-m": "gguf-q4-k-m",
    "gguf-q4km": "gguf-q4-k-m",
    "q4km": "gguf-q4-k-m",
    "q4-k-m": "gguf-q4-k-m",
    "gguf-q4": "gguf-q4-k-m",
    "q4": "gguf-q4-k-m",
    "gguf-q4-k-s": "gguf-q4-k-s",
    "gguf-q4ks": "gguf-q4-k-s",
    "q4ks": "gguf-q4-k-s",
    "q4-k-s": "gguf-q4-k-s",
    "gguf-q5-0": "gguf-q5-0",
    "q5-0": "gguf-q5-0",
    "q50": "gguf-q5-0",
    "gguf-q5-1": "gguf-q5-1",
    "q5-1": "gguf-q5-1",
    "q51": "gguf-q5-1",
    "gguf-q5-k-m": "gguf-q5-k-m",
    "gguf-q5km": "gguf-q5-k-m",
    "q5km": "gguf-q5-k-m",
    "q5-k-m": "gguf-q5-k-m",
    "gguf-q5": "gguf-q5-k-m",
    "q5": "gguf-q5-k-m",
    "gguf-q5-k-s": "gguf-q5-k-s",
    "gguf-q5ks": "gguf-q5-k-s",
    "q5ks": "gguf-q5-k-s",
    "q5-k-s": "gguf-q5-k-s",
    "gguf-q6-k": "gguf-q6-k",
    "q6k": "gguf-q6-k",
    "q6-k": "gguf-q6-k",
    "gguf-q6": "gguf-q6-k",
    "q6": "gguf-q6-k",
    "gguf-q8-0": "gguf-q8-0",
    "gguf-q8": "gguf-q8-0",
    "gguf-q8_0": "gguf-q8-0",
    "q8": "gguf-q8-0",
    "q8-0": "gguf-q8-0",
    "q8_0": "gguf-q8-0",
}


def normalize_model_variant(model_variant: str | None) -> str:
    normalized = (model_variant or DEFAULT_MODEL_VARIANT).strip().lower().replace(" ", "-").replace("_", "-")
    return MODEL_VARIANT_ALIASES.get(normalized, normalized)


def get_variant_config(model_variant: str | None) -> tuple[str, dict]:
    normalized = normalize_model_variant(model_variant)
    if normalized not in MODEL_VARIANTS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported model variant '{model_variant}'. Use bf16, fp8, or a supported gguf-* variant.",
        )
    return normalized, MODEL_VARIANTS[normalized]


def set_default_model_variant(model_variant: str) -> None:
    global DEFAULT_MODEL_VARIANT

    normalized_variant = normalize_model_variant(model_variant)
    DEFAULT_MODEL_VARIANT = normalized_variant
    write_env_value("MODEL_VARIANT", normalized_variant)


def get_hf_repo_cache_dir(repo_id: str) -> str:
    return os.path.join(HF_HOME, "hub", f"models--{repo_id.replace('/', '--')}")


def repo_has_snapshot(repo_id: str) -> bool:
    snapshots_dir = os.path.join(get_hf_repo_cache_dir(repo_id), "snapshots")
    return any(os.path.isdir(path) for path in glob.glob(os.path.join(snapshots_dir, "*")))


def cached_file_exists(repo_id: str, filename: str) -> bool:
    repo_dir = get_hf_repo_cache_dir(repo_id)
    return any(os.path.isfile(path) for path in glob.glob(os.path.join(repo_dir, "snapshots", "*", "**", filename), recursive=True))


def is_variant_downloaded(variant_key: str) -> bool:
    _, variant_config = get_variant_config(variant_key)
    if variant_config["loader"] == "gguf_single_file":
        return repo_has_snapshot(variant_config["base_repo_id"]) and cached_file_exists(
            variant_config["repo_id"],
            variant_config["gguf_file"],
        )
    return repo_has_snapshot(variant_config["repo_id"])


def get_downloaded_variants() -> list[str]:
    return [variant_key for variant_key in MODEL_VARIANTS if is_variant_downloaded(variant_key)]


def parse_size_gb(size_label: str | None) -> float | None:
    if not size_label:
        return None
    match = re.search(r"([\d.]+)\s*GB", size_label, re.IGNORECASE)
    if not match:
        return None
    try:
        return float(match.group(1))
    except ValueError:
        return None


def get_gpu_info() -> dict:
    global gpu_info_cache

    if gpu_info_cache is not None:
        return gpu_info_cache

    gpu_info = {
        "backend": BACKEND_CONFIG.backend,
        "backend_label": BACKEND_CONFIG.label,
        "gpu_name": None,
        "total_vram_gb": None,
    }

    try:
        import torch

        if BACKEND_CONFIG.backend == "cuda" and torch.cuda.is_available():
            properties = torch.cuda.get_device_properties(0)
            gpu_info["gpu_name"] = torch.cuda.get_device_name(0)
            gpu_info["total_vram_gb"] = round(properties.total_memory / (1024 ** 3), 2)
            gpu_info_cache = gpu_info
            return gpu_info
    except Exception:
        pass

    if os.name == "nt":
        try:
            result = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            payload = result.stdout.strip()
            adapters = json.loads(payload) if payload else []
            if isinstance(adapters, dict):
                adapters = [adapters]

            if adapters:
                preferred_patterns = {
                    "cuda": re.compile(r"nvidia", re.IGNORECASE),
                    "directml": re.compile(r"amd|radeon|intel|arc|iris|uhd", re.IGNORECASE),
                }
                preferred = preferred_patterns.get(BACKEND_CONFIG.backend)
                candidates = [adapter for adapter in adapters if preferred and preferred.search(str(adapter.get("Name", "")))]
                if not candidates:
                    candidates = adapters

                def adapter_ram(adapter: dict) -> int:
                    raw = adapter.get("AdapterRAM") or 0
                    try:
                        return int(raw)
                    except (TypeError, ValueError):
                        return 0

                best = max(candidates, key=adapter_ram)
                total_vram = adapter_ram(best)
                gpu_info["gpu_name"] = best.get("Name")
                if total_vram > 0:
                    gpu_info["total_vram_gb"] = round(total_vram / (1024 ** 3), 2)
        except Exception:
            pass

    gpu_info_cache = gpu_info
    return gpu_info


def get_variant_fit_estimate(variant_config: dict, total_vram_gb: float | None) -> dict:
    size_gb = parse_size_gb(variant_config.get("size"))
    if total_vram_gb is None or size_gb is None:
        return {
            "estimated_size_gb": size_gb,
            "fit_status": "unknown",
            "fit_label": "VRAM unknown",
        }

    if size_gb <= total_vram_gb * 0.85:
        fit_status = "fits"
        fit_label = "Likely fits"
    elif size_gb <= total_vram_gb:
        fit_status = "tight"
        fit_label = "Tight fit"
    else:
        fit_status = "wont_fit"
        fit_label = "Won't fit"

    return {
        "estimated_size_gb": size_gb,
        "fit_status": fit_status,
        "fit_label": fit_label,
    }


def build_variant_statuses() -> list[dict]:
    gpu_info = get_gpu_info()
    total_vram_gb = gpu_info.get("total_vram_gb")
    variants = []
    for key, value in MODEL_VARIANTS.items():
        fit_estimate = get_variant_fit_estimate(value, total_vram_gb)
        variants.append({
            "key": key,
            "label": value["label"],
            "size": value["size"],
            "downloaded": is_variant_downloaded(key),
            **fit_estimate,
        })
    return variants


def find_startup_variant() -> str | None:
    downloaded_variants = get_downloaded_variants()
    if not downloaded_variants:
        return None

    normalized_default = normalize_model_variant(DEFAULT_MODEL_VARIANT)
    if normalized_default in downloaded_variants:
        return normalized_default
    return downloaded_variants[0]


def download_model_variant(model_variant: str | None = None, load_after_download: bool = True):
    normalized_variant, variant_config = get_variant_config(model_variant)
    model_status["loaded"] = False
    model_status["status"] = "downloading"
    model_status["selected_variant"] = normalized_variant
    model_status["variant_label"] = variant_config["label"]
    model_status["variant_size"] = variant_config["size"]
    model_status["message"] = f"Downloading {variant_config['label']} assets..."
    model_status["progress"] = {"step": 0, "total": 0}

    try:
        from huggingface_hub import hf_hub_download, snapshot_download

        print(f"Downloading assets for {variant_config['label']}...")
        if variant_config["loader"] == "gguf_single_file":
            snapshot_download(repo_id=variant_config["base_repo_id"], cache_dir=HF_HOME)
            hf_hub_download(
                repo_id=variant_config["repo_id"],
                filename=variant_config["gguf_file"],
                cache_dir=HF_HOME,
            )
        else:
            snapshot_download(repo_id=variant_config["repo_id"], cache_dir=HF_HOME)

        print(f"Download complete for {variant_config['label']}")
        if load_after_download:
            load_model_variant(normalized_variant)
        else:
            model_status["status"] = "idle"
            model_status["message"] = f"Downloaded {variant_config['label']}. Ready to load."
    except Exception as exc:
        model_status["status"] = "error"
        model_status["message"] = f"Failed to download {variant_config['label']}: {exc}"
        print(f"Error downloading model assets: {exc}")
        raise


def load_model_variant(model_variant: str | None = None):
    global pipe, loaded_variant, model_status

    normalized_variant, variant_config = get_variant_config(model_variant)

    with model_lock:
        if model_status["loaded"] and loaded_variant == normalized_variant and pipe is not None:
            return pipe

        model_status["loaded"] = False
        model_status["status"] = "loading"
        model_status["selected_variant"] = normalized_variant
        model_status["variant_label"] = variant_config["label"]
        model_status["variant_size"] = variant_config["size"]
        model_status["message"] = f"Loading {variant_config['label']} model assets..."
        model_status["progress"] = {"step": 0, "total": 0}

        import torch
        from huggingface_hub import hf_hub_download
        from diffusers import Flux2KleinPipeline, GGUFQuantizationConfig, Flux2Transformer2DModel

        torch_dtype = get_model_dtype(torch)
        print(f"Loading {variant_config['repo_id']} ({variant_config['label']}) on {BACKEND_CONFIG.label}...")

        if variant_config["loader"] == "diffusers":
            pipe = Flux2KleinPipeline.from_pretrained(
                variant_config["repo_id"],
                torch_dtype=torch_dtype,
                cache_dir=HF_HOME,
            )
        elif variant_config["loader"] == "torchao_fp8_static":
            raise HTTPException(
                status_code=501,
                detail=(
                    "FP8 static is not available in this Windows setup because the required TorchAO/Triton "
                    "kernel path is unavailable here. Use BF16 or GGUF for this machine."
                ),
            )
        elif variant_config["loader"] == "gguf_single_file":
            try:
                gguf_path = hf_hub_download(
                    repo_id=variant_config["repo_id"],
                    filename=variant_config["gguf_file"],
                    cache_dir=HF_HOME,
                )
                transformer = Flux2Transformer2DModel.from_single_file(
                    gguf_path,
                    quantization_config=GGUFQuantizationConfig(compute_dtype=torch_dtype),
                    config=variant_config["base_repo_id"],
                    subfolder="transformer",
                    torch_dtype=torch_dtype,
                    cache_dir=HF_HOME,
                )
                pipe = Flux2KleinPipeline.from_pretrained(
                    variant_config["base_repo_id"],
                    transformer=None,
                    torch_dtype=torch_dtype,
                    cache_dir=HF_HOME,
                )
                pipe.transformer = transformer
            except Exception as exc:
                model_status["status"] = "error"
                model_status["message"] = (
                    f"Failed to load {variant_config['label']}: {exc}. "
                    "The GGUF checkpoint or loader is not compatible with this environment."
                )
                print(f"Error loading {variant_config['label']}: {exc}")
                raise
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported loader for variant '{normalized_variant}'.")

        model_status["message"] = f"Configuring {BACKEND_CONFIG.label} runtime..."
        configure_pipeline_device(pipe, torch)

        try:
            pipe.vae.enable_slicing()
            pipe.vae.enable_tiling()
        except Exception:
            pass

        loaded_variant = normalized_variant
        set_default_model_variant(normalized_variant)
        model_status["loaded"] = True
        model_status["status"] = "ready"
        model_status["message"] = f"Model ready: {variant_config['label']}"
        print(f"Models loaded successfully: {variant_config['label']}")

        return pipe


def normalize_condition_image(image: Image.Image, target_size: tuple[int, int] | None = None) -> tuple[Image.Image, int, int]:
    image = ImageOps.exif_transpose(image).convert("RGB")

    width, height = image.size
    if width <= 0 or height <= 0:
        raise ValueError("Uploaded image has invalid dimensions.")

    if target_size is None:
        max_area = 1024 * 1024
        area = width * height
        if area > max_area:
            scale = (max_area / area) ** 0.5
            width = max(32, int(width * scale))
            height = max(32, int(height * scale))

        width = max(32, (width // 32) * 32)
        height = max(32, (height // 32) * 32)
    else:
        width, height = target_size

    if image.size != (width, height):
        image = image.resize((width, height), Image.Resampling.LANCZOS)

    return image, width, height

def load_models_sync():
    global pipe, model_status
    
    # 1. Wait for batch script to finish pip installs
    while not os.path.exists(flag_path):
        model_status["message"] = "Downloading PyTorch and ML libraries (~10GB). Check the command prompt window."
        time.sleep(3)
        
    # Clean up the flag
    try:
        os.remove(flag_path)
    except:
        pass
        
    model_status["message"] = "Libraries installed! Initializing machine learning environment..."
    time.sleep(1) # Give system a second to unlock files

    startup_variant = find_startup_variant()
    if startup_variant is None:
        gpu_info = get_gpu_info()
        model_status["status"] = "download_required"
        model_status["message"] = "No cached model was found. Choose a model to download before generating images."
        model_status["selected_variant"] = None
        model_status["variant_label"] = None
        model_status["variant_size"] = None
        model_status["progress"] = {"step": 0, "total": 0}
        print(
            "No model assets found in cache. Waiting for a user-selected download "
            f"for backend {gpu_info.get('backend_label', BACKEND_CONFIG.label)}."
        )
        return

    try:
        load_model_variant(startup_variant)
    except Exception as e:
        status_msg = str(e)
        model_status["status"] = "error"
        model_status["message"] = f"Failed to load {startup_variant}: {status_msg}"
        print(f"Error loading model: {e}")

@app.on_event("startup")
async def startup_event():
    # Start loading in background thread on startup
    thread = threading.Thread(target=load_models_sync)
    thread.start()


generation_cancelled = threading.Event()


def validate_dimensions(w: int, h: int):
    errors = []
    min_dim, max_dim = 256, 4096
    if w < min_dim or w > max_dim:
        errors.append(f"width must be {min_dim}--{max_dim}, got {w}")
    if h < min_dim or h > max_dim:
        errors.append(f"height must be {min_dim}--{max_dim}, got {h}")
    if w % 32 != 0:
        errors.append(f"width must be a multiple of 32, got {w}")
    if h % 32 != 0:
        errors.append(f"height must be a multiple of 32, got {h}")
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

@app.get("/api/model-status")
def get_model_status():
    # Include generating status for the frontend polling
    status = model_status.copy()
    variant_statuses = build_variant_statuses()
    status["is_generating"] = model_status.get("progress", {}).get("total", 0) > 0 and \
                              model_status["progress"].get("step", 0) < model_status["progress"].get("total", 0)
    status["available_variants"] = variant_statuses
    status["downloaded_variants"] = [variant["key"] for variant in variant_statuses if variant["downloaded"]]
    status["download_required"] = not status["downloaded_variants"]
    status["hardware"] = get_gpu_info()
    return JSONResponse(status)

@app.get("/api/logs")
async def stream_logs():
    async def event_generator():
        sent_index = 0
        while True:
            # Check if there's new logs in the deque
            current_logs = list(logs_deque)
            if len(current_logs) > sent_index:
                for i in range(sent_index, len(current_logs)):
                    yield f"data: {current_logs[i]}\n\n"
                sent_index = len(current_logs)
            
            # If we're at the end of the deque, we can't just rely on index
            # Simple approach: clear deque after send if we want pure stream, 
            # but deque is useful for initial catchup.
            await asyncio.sleep(0.5)

    import asyncio
    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "model_loaded": model_status["loaded"],
        "model_status": model_status["status"],
        "model_variant": model_status.get("selected_variant"),
        "backend": BACKEND_CONFIG.backend,
    }


@app.get("/api/models")
def list_models():
    return {
        "default": DEFAULT_MODEL_VARIANT,
        "currently_loaded": loaded_variant,
        "hardware": get_gpu_info(),
        "variants": [
            {
                "key": key,
                "label": value["label"],
                "size": value["size"],
                "loader": value["loader"],
                "repo_id": value["repo_id"],
                "downloaded": is_variant_downloaded(key),
                **get_variant_fit_estimate(value, get_gpu_info().get("total_vram_gb")),
            }
            for key, value in MODEL_VARIANTS.items()
        ],
    }


@app.post("/api/load-model")
def load_model_endpoint(model_variant: str | None = Form(None)):
    global model_status
    resolved_variant = normalize_model_variant(model_variant)
    if not model_status["loaded"] or loaded_variant != resolved_variant:
        target = download_model_variant if not is_variant_downloaded(resolved_variant) else load_model_variant
        thread = threading.Thread(target=target, args=(resolved_variant,), daemon=True)
        thread.start()
        return {"status": "loading", "message": f"Loading variant: {resolved_variant}"}
    return {"status": "already_loaded", "variant": loaded_variant}


@app.post("/api/download-model")
def download_model_endpoint(model_variant: str = Form(...)):
    thread = threading.Thread(target=download_model_variant, args=(model_variant,), daemon=True)
    thread.start()
    return {"status": "downloading", "message": f"Downloading variant: {model_variant}"}


@app.post("/api/cancel")
def cancel_generation():
    generation_cancelled.set()
    return {"status": "cancelled", "message": "Generation cancellation requested."}


@app.get("/api/outputs")
def list_outputs():
    files = []
    for f in sorted(os.listdir(OUTPUT_DIR), reverse=True):
        if f.endswith(".png"):
            fpath = os.path.join(OUTPUT_DIR, f)
            stat = os.stat(fpath)
            files.append({
                "filename": f,
                "url": f"/outputs/{f}",
                "size_bytes": stat.st_size,
                "created": stat.st_ctime,
            })
    return {"count": len(files), "files": files}


@app.delete("/api/outputs/{filename}")
def delete_output(filename: str):
    fpath = os.path.join(OUTPUT_DIR, filename)
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail=f"File not found: {filename}")
    os.remove(fpath)
    return {"status": "deleted", "filename": filename}


def check_model_ready():
    if not model_status["loaded"]:
        if model_status["status"] == "error":
            raise HTTPException(status_code=500, detail=model_status["message"])
        raise HTTPException(status_code=503, detail="Model is still loading. Please wait.")


def ensure_variant_loaded(model_variant: str | None):
    if model_status["loaded"] and loaded_variant == normalize_model_variant(model_variant):
        return
    load_model_variant(model_variant)

@app.post("/api/generate")
def generate_image(
    prompt: str = Form(...),
    num_inference_steps: int = Form(8),
    guidance_scale: float = Form(3.5),
    width: int = Form(1024),
    height: int = Form(1024),
    seed: int = Form(-1),
    num_images_per_prompt: int = Form(1),
    model_variant: str | None = Form(None)
):
    try:
        validate_dimensions(width, height)
        generation_cancelled.clear()
        ensure_variant_loaded(model_variant)
        check_model_ready()
        import torch
        generation_started_at = time.perf_counter()
        
        model_status["progress"] = {"step": 0, "total": num_inference_steps}

        def step_callback(step, timestep, latents):
            if generation_cancelled.is_set():
                raise InterruptedError("Generation cancelled by user")
            model_status["progress"]["step"] = step + 1
            print(f"Sampling Step: {step+1}/{num_inference_steps}")

        generator = create_generator(torch, seed)

        print(f"Generating {num_images_per_prompt} variation(s) for prompt: '{prompt}'")
        # Ensure callback is passed as the correct key for this diffusers version
        # Some versions use 'callback_on_step_end' while others use 'callback'
        kwargs = {
            "prompt": prompt,
            "num_inference_steps": num_inference_steps,
            "guidance_scale": guidance_scale,
            "width": width,
            "height": height,
            "generator": generator,
            "num_images_per_prompt": num_images_per_prompt
        }
        
        # Try different callback formats based on common diffusers pipeline signatures
        if hasattr(pipe, "_callback_tensor_inputs"):
            # Newer callback system (callback_on_step_end) expects (pipe, step, timestep, callback_kwargs)
            def wrap_callback(pipeline, step, timestep, callback_kwargs):
                step_callback(step, timestep, None)
                return callback_kwargs
            kwargs["callback_on_step_end"] = wrap_callback
        else:
            kwargs["callback"] = step_callback
            kwargs["callback_steps"] = 1

        output = pipe(**kwargs)
        generation_time_ms = int((time.perf_counter() - generation_started_at) * 1000)
        
        images_base64 = []
        image_urls = []
        
        for i, image in enumerate(output.images):
            # 1. Prepare Base64 for UI reactivity
            buffered = io.BytesIO()
            image.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            images_base64.append(f"data:image/png;base64,{img_str}")
            
            # 2. Save directly to local /outputs folder with prompt in filename
            timestamp = int(time.time() * 1000)
            # Create a filesystem-friendly version of the prompt (first 50 chars, no special chars)
            safe_prompt = "".join([c if c.isalnum() or c in " _-" else "_" for c in prompt[:50]])
            filename = f"{safe_prompt}_{timestamp}_{i}.png"
            file_path = os.path.join(OUTPUT_DIR, filename)
            image.save(file_path, "PNG")
            image_urls.append(f"/outputs/{filename}")
        
        # Free up RAM/VRAM
        import gc
        gc.collect()
        release_memory(torch)
        
        return JSONResponse({
            "status": "success", 
            "images": images_base64,
            "image": images_base64[0],
            "urls": image_urls, # Provide disk paths
            "generation_time_ms": generation_time_ms,
        })

    except Exception as e:
        error_message = traceback.format_exc()
        print(error_message)
        status_code = 500
        if isinstance(e, HTTPException):
            status_code = e.status_code
        return JSONResponse({"status": "error", "message": str(e), "traceback": error_message}, status_code=status_code)

@app.post("/api/edit")
def edit_image(
    prompt: str = Form(...),
    image: UploadFile = File(...),
    reference_image: UploadFile = File(None),
    num_inference_steps: int = Form(8),
    strength: float = Form(0.8),
    guidance_scale: float = Form(3.5),
    seed: int = Form(-1),
    num_images_per_prompt: int = Form(1),
    model_variant: str | None = Form(None)
):
    try:
        generation_cancelled.clear()
        ensure_variant_loaded(model_variant)
        check_model_ready()
        generation_started_at = time.perf_counter()
        
        # Read the primary uploaded image
        contents = image.file.read()
        init_image, width, height = normalize_condition_image(Image.open(io.BytesIO(contents)))
        validate_dimensions(width, height)
        
        # Read the reference image if provided
        images_list = [init_image]
        if reference_image is not None and reference_image.filename:
            ref_contents = reference_image.file.read()
            ref_img, _, _ = normalize_condition_image(
                Image.open(io.BytesIO(ref_contents)),
                target_size=(width, height)
            )
            images_list.append(ref_img)
        
        import torch
        generator = create_generator(torch, seed)
            
        print(f"Editing image for prompt: '{prompt}' (Variations: {num_images_per_prompt})")
        
        model_status["progress"] = {"step": 0, "total": num_inference_steps}
        def step_callback(step, timestep, latents):
            if generation_cancelled.is_set():
                raise InterruptedError("Generation cancelled by user")
            model_status["progress"]["step"] = step + 1
            print(f"Sampling Step: {step+1}/{num_inference_steps}")

        kwargs = {
            "prompt": prompt,
            "image": init_image if len(images_list) == 1 else images_list,
            "width": width,
            "height": height,
            "num_inference_steps": num_inference_steps,
            "guidance_scale": guidance_scale,
            "generator": generator,
            "num_images_per_prompt": num_images_per_prompt
        }
        
        if hasattr(pipe, "_callback_tensor_inputs"):
            def wrap_callback_edit(pipeline, step, timestep, callback_kwargs):
                step_callback(step, timestep, None)
                return callback_kwargs
            kwargs["callback_on_step_end"] = wrap_callback_edit
        else:
            kwargs["callback"] = step_callback
            kwargs["callback_steps"] = 1

        output = pipe(**kwargs)
        generation_time_ms = int((time.perf_counter() - generation_started_at) * 1000)
        
        images_base64 = []
        image_urls = []
        
        for i, res_image in enumerate(output.images):
            # 1. Prepare Base64 for UI reactivity
            buffered = io.BytesIO()
            res_image.save(buffered, format="PNG")
            img_str = base64.b64encode(buffered.getvalue()).decode("utf-8")
            images_base64.append(f"data:image/png;base64,{img_str}")
            
            # 2. Save directly to local /outputs folder with prompt in filename
            timestamp = int(time.time() * 1000)
            # Create a filesystem-friendly version of the prompt (first 50 chars, no special chars)
            safe_prompt = "".join([c if c.isalnum() or c in " _-" else "_" for c in prompt[:50]])
            filename = f"edit_{safe_prompt}_{timestamp}_{i}.png"
            file_path = os.path.join(OUTPUT_DIR, filename)
            res_image.save(file_path, "PNG")
            image_urls.append(f"/outputs/{filename}")
        
        # Free up RAM/VRAM
        import gc
        gc.collect()
        release_memory(torch)
        
        return JSONResponse({
            "status": "success", 
            "images": images_base64,
            "image": images_base64[0],
            "urls": image_urls, # Provide disk paths
            "generation_time_ms": generation_time_ms,
        })

    except Exception as e:
        error_message = traceback.format_exc()
        print(error_message)
        status_code = 500
        if isinstance(e, HTTPException):
            status_code = e.status_code
        return JSONResponse({"status": "error", "message": str(e), "traceback": error_message}, status_code=status_code)
