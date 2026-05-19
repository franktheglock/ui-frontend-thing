import { Router } from "express";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { getDb } from "../db";

const router = Router();
let runningProcess: ReturnType<typeof spawn> | null = null;

function getDefaultInstallDir() {
  return path.resolve(process.cwd(), "..", "flux 4b frontend");
}

function getInstallDir(value?: unknown) {
  return path.resolve(
    String(value || process.env.FLUX_4B_FRONTEND_DIR || getDefaultInstallDir()),
  );
}

function exists(dir: string) {
  return (
    fs.existsSync(path.join(dir, "start.bat")) ||
    fs.existsSync(path.join(dir, "api_only", "start.bat"))
  );
}

function normalizePort(value?: unknown) {
  const parsed = Number.parseInt(String(value || "8000"), 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) return 8000;
  return parsed;
}

function patchLocalImageStartupScripts(installDir: string) {
  const scriptPaths = [
    path.join(installDir, "start.bat"),
    path.join(installDir, "api_only", "start.bat"),
  ];

  scriptPaths.forEach((scriptPath) => {
    if (!fs.existsSync(scriptPath)) return;

    const original = fs.readFileSync(scriptPath, "utf-8");
    let updated = original
      .replace(
        /if not defined PORT(?:\s+if not defined PORT)+ set PORT=8000/g,
        "if not defined PORT set PORT=8000",
      )
      .replace(/^set PORT=8000$/gm, "if not defined PORT set PORT=8000")
      .replace(/--port 8000/g, "--port !PORT!")
      .replace(/localhost:8000/g, "localhost:!PORT!")
      .replace(/port 8000/g, "port !PORT!");

    if (updated !== original) {
      fs.writeFileSync(scriptPath, updated.replace(/\n/g, "\r\n"));
    }
  });
}

function ensureLocalImageCacheDirs(installDir: string) {
  const cacheDir = path.join(installDir, "cache");
  const huggingFaceDir = path.join(cacheDir, "huggingface");
  const torchDir = path.join(cacheDir, "torch");
  const pipDir = path.join(cacheDir, "pip");
  const tmpDir = path.join(cacheDir, "tmp");
  const outputDir = path.join(installDir, "outputs");

  [cacheDir, huggingFaceDir, torchDir, pipDir, tmpDir, outputDir].forEach(
    (dir) => fs.mkdirSync(dir, { recursive: true }),
  );

  return { cacheDir, huggingFaceDir, torchDir, pipDir, tmpDir, outputDir };
}

function buildLocalImageEnv(
  installDir: string,
  options?: { fastMode?: boolean; modelVariant?: string; port?: number },
) {
  const { cacheDir, huggingFaceDir, torchDir, pipDir, tmpDir, outputDir } =
    ensureLocalImageCacheDirs(installDir);
  const port = normalizePort(options?.port);

  return {
    ...process.env,
    CACHE_DIR: cacheDir,
    HF_HOME: huggingFaceDir,
    HUGGINGFACE_HUB_CACHE: path.join(huggingFaceDir, "hub"),
    HF_DATASETS_CACHE: path.join(huggingFaceDir, "datasets"),
    TRANSFORMERS_CACHE: path.join(huggingFaceDir, "hub"),
    TORCH_HOME: torchDir,
    PIP_CACHE_DIR: pipDir,
    TMPDIR: tmpDir,
    TMP: tmpDir,
    TEMP: tmpDir,
    OUTPUT_DIR: outputDir,
    PORT: String(port),
    FAST_MODE: options?.fastMode === false ? "0" : "1",
    ...(options?.modelVariant ? { MODEL_VARIANT: options.modelVariant } : {}),
  };
}

async function detectWindowsGpu() {
  if (process.platform !== "win32") return null;
  try {
    const ps =
      "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress";
    const child = spawn("powershell", ["-NoProfile", "-Command", ps], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const chunks: Buffer[] = [];
    child.stdout?.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    await new Promise((resolve) => child.on("close", resolve));
    const text = Buffer.concat(chunks).toString("utf-8").trim();
    if (!text) return null;
    const parsed = JSON.parse(text);
    const adapters = Array.isArray(parsed) ? parsed : [parsed];
    const best = adapters.sort(
      (a, b) => Number(b.AdapterRAM || 0) - Number(a.AdapterRAM || 0),
    )[0];
    const name = String(best?.Name || "");
    const totalVramGb =
      Number(best?.AdapterRAM || 0) > 0
        ? Math.round((Number(best.AdapterRAM) / 1024 ** 3) * 100) / 100
        : null;
    const backend = /nvidia/i.test(name)
      ? "cuda"
      : /amd|radeon|intel|arc|iris|uhd/i.test(name)
        ? "directml"
        : "cpu";
    return {
      gpu_name: name || null,
      total_vram_gb: totalVramGb,
      backend,
      backend_label:
        backend === "cuda"
          ? "NVIDIA CUDA"
          : backend === "directml"
            ? "DirectML"
            : "CPU",
    };
  } catch {
    return null;
  }
}

async function fetchJson(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!response.ok)
    throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

const FALLBACK_VARIANTS = [
  { key: "bf16", label: "BF16", size: "~13GB", estimated_size_gb: 13 },
  { key: "fp8", label: "FP8", size: "~8GB", estimated_size_gb: 8 },
  {
    key: "gguf-bf16",
    label: "BF16 GGUF",
    size: "~7.75GB",
    estimated_size_gb: 7.75,
  },
  {
    key: "gguf-f16",
    label: "F16 GGUF",
    size: "~7.75GB",
    estimated_size_gb: 7.75,
  },
  {
    key: "gguf-q8-0",
    label: "Q8_0 GGUF",
    size: "~4.30GB",
    estimated_size_gb: 4.3,
  },
  {
    key: "gguf-q6-k",
    label: "Q6_K GGUF",
    size: "~3.41GB",
    estimated_size_gb: 3.41,
  },
  {
    key: "gguf-q5-k-m",
    label: "Q5_K_M GGUF",
    size: "~3.07GB",
    estimated_size_gb: 3.07,
  },
  {
    key: "gguf-q5-k-s",
    label: "Q5_K_S GGUF",
    size: "~3.05GB",
    estimated_size_gb: 3.05,
  },
  {
    key: "gguf-q5-1",
    label: "Q5_1 GGUF",
    size: "~3.15GB",
    estimated_size_gb: 3.15,
  },
  {
    key: "gguf-q5-0",
    label: "Q5_0 GGUF",
    size: "~2.92GB",
    estimated_size_gb: 2.92,
  },
  {
    key: "gguf-q4-k-m",
    label: "Q4_K_M GGUF",
    size: "~2.60GB",
    estimated_size_gb: 2.6,
  },
  {
    key: "gguf-q4-k-s",
    label: "Q4_K_S GGUF",
    size: "~2.58GB",
    estimated_size_gb: 2.58,
  },
  {
    key: "gguf-q4-1",
    label: "Q4_1 GGUF",
    size: "~2.69GB",
    estimated_size_gb: 2.69,
  },
  {
    key: "gguf-q4-0",
    label: "Q4_0 GGUF",
    size: "~2.46GB",
    estimated_size_gb: 2.46,
  },
  {
    key: "gguf-q3-k-m",
    label: "Q3_K_M GGUF",
    size: "~2.12GB",
    estimated_size_gb: 2.12,
  },
  {
    key: "gguf-q3-k-s",
    label: "Q3_K_S GGUF",
    size: "~2.10GB",
    estimated_size_gb: 2.1,
  },
  {
    key: "gguf-q2-k",
    label: "Q2_K GGUF",
    size: "~1.83GB",
    estimated_size_gb: 1.83,
  },
];

const FALLBACK_VARIANTS_BY_KEY = new Map(
  FALLBACK_VARIANTS.map((variant) => [variant.key, variant]),
);

function normalizeVariant(variant: any) {
  const key =
    typeof variant === "string"
      ? variant
      : typeof variant?.key === "string"
        ? variant.key
        : typeof variant?.id === "string"
          ? variant.id
          : typeof variant?.name === "string"
            ? variant.name
            : "";

  if (!key) return variant;

  const fallback = FALLBACK_VARIANTS_BY_KEY.get(key);
  if (typeof variant === "string") return fallback || { key, label: key };
  if (!fallback) return { ...variant, key };
  return { ...fallback, ...variant, key };
}

function withFit(variant: any, totalVramGb?: number | null) {
  if (!totalVramGb || !variant.estimated_size_gb)
    return { ...variant, fit_status: "unknown", fit_label: "VRAM unknown" };
  const size = Number(variant.estimated_size_gb);
  const fit_status =
    size <= totalVramGb * 0.85
      ? "fits"
      : size <= totalVramGb
        ? "tight"
        : "wont_fit";
  return {
    ...variant,
    fit_status,
    fit_label:
      fit_status === "fits"
        ? "Likely fits"
        : fit_status === "tight"
          ? "Tight fit"
          : "Won't fit",
  };
}

function recommendVariant(modelsPayload: any, hardware?: any) {
  const totalVramGb = hardware?.total_vram_gb;
  const rawVariants =
    Array.isArray(modelsPayload?.variants) && modelsPayload.variants.length
      ? modelsPayload.variants
      : FALLBACK_VARIANTS;
  const variants = rawVariants.map((variant: any) =>
    variant.fit_status
      ? normalizeVariant(variant)
      : withFit(normalizeVariant(variant), totalVramGb),
  );
  const preferredOrder = [
    "bf16",
    "fp8",
    "gguf-q8-0",
    "gguf-q6-k",
    "gguf-q5-k-m",
    "gguf-q4-k-m",
    "gguf-q3-k-m",
    "gguf-q2-k",
  ];
  const byKey = new Map(variants.map((variant: any) => [variant.key, variant]));
  return (
    preferredOrder
      .map((key) => byKey.get(key))
      .find((variant: any) => variant?.fit_status === "fits") ||
    preferredOrder
      .map((key) => byKey.get(key))
      .find((variant: any) => variant?.fit_status === "tight") ||
    variants[0] ||
    null
  );
}

async function getStatus(installDir: string, port: number) {
  let health: any = null;
  let models: any = null;
  let modelStatus: any = null;
  let serverReachable = false;

  try {
    health = await fetchJson(`http://localhost:${port}/api/health`);
    serverReachable = true;
  } catch {}

  try {
    models = await fetchJson(`http://localhost:${port}/api/models`);
  } catch {}

  try {
    modelStatus = await fetchJson(`http://localhost:${port}/api/model-status`);
  } catch {}

  const detectedHardware =
    modelStatus?.hardware || models?.hardware || (await detectWindowsGpu());
  const variantSource = models ||
    modelStatus || { variants: FALLBACK_VARIANTS };

  return {
    installDir,
    installed: exists(installDir),
    isolatedVenv:
      fs.existsSync(path.join(installDir, "venv", "Scripts", "python.exe")) ||
      fs.existsSync(path.join(installDir, ".venv", "Scripts", "python.exe")),
    running: !!runningProcess,
    serverReachable,
    health,
    models,
    modelStatus,
    hardware: detectedHardware,
    port,
    variants: (Array.isArray(variantSource?.variants)
      ? variantSource.variants
      : FALLBACK_VARIANTS
    ).map((variant: any) => {
      const normalizedVariant = normalizeVariant(variant);
      return normalizedVariant.fit_status
        ? normalizedVariant
        : withFit(normalizedVariant, detectedHardware?.total_vram_gb);
    }),
    recommendedVariant: recommendVariant(variantSource, detectedHardware),
  };
}

router.get("/status", async (req, res) => {
  const installDir = getInstallDir(req.query.installDir);
  res.json(await getStatus(installDir, normalizePort(req.query.port)));
});

router.post("/setup", async (req, res) => {
  const installDir = getInstallDir(req.body?.installDir);

  if (!exists(installDir)) {
    res.status(404).json({
      error:
        `Local image server files not found at ${installDir}. ` +
        "The server should be bundled with this app — check that the 'flux 4b frontend' folder is present.",
      installDir,
    });
    return;
  }

  ensureLocalImageCacheDirs(installDir);
  patchLocalImageStartupScripts(installDir);

  res.json({
    ok: true,
    installed: true,
    installDir,
    message: "Local image server is ready. Press Start to install dependencies and launch it.",
  });
});

router.post("/start", async (req, res) => {
  const installDir = getInstallDir(req.body?.installDir);
  const modelVariant = String(req.body?.modelVariant || "").trim();
  const port = normalizePort(req.body?.port);
  // Auto-detect first run: if no venv exists, do a full install; otherwise skip pip reinstalls.
  const venvReady = fs.existsSync(path.join(installDir, "venv", "Scripts", "activate.bat"));
  const fastMode = req.body?.fastMode !== undefined ? req.body.fastMode !== false : venvReady;

  if (!exists(installDir)) {
    res
      .status(404)
      .json({ error: `Local image server is not installed at ${installDir}` });
    return;
  }

  if (runningProcess) {
    res.json({ ok: true, installDir, message: "Already started by this app" });
    return;
  }

  const env = {
    ...buildLocalImageEnv(installDir, { fastMode, modelVariant, port }),
  };

  patchLocalImageStartupScripts(installDir);

  runningProcess = spawn("cmd.exe", ["/c", "start.bat"], {
    cwd: installDir,
    env,
    detached: true,
    stdio: "ignore",
  });
  runningProcess.on("exit", () => {
    runningProcess = null;
  });
  runningProcess.on("error", (error) => {
    console.error("[local-image-server] start failed:", error);
    runningProcess = null;
  });
  runningProcess.unref();

  res.json({ ok: true, installDir, message: "Start requested" });
});

router.patch("/settings", async (req, res) => {
  const db = await getDb();
  const row = (await db.get(
    "SELECT value FROM app_settings WHERE id = ?",
    "global",
  )) as any;
  const current = row?.value ? JSON.parse(row.value || "{}") : {};
  const next = {
    ...current,
    localImageServerAutoRun: req.body?.autoRun === true,
    localImageServerInstallDir: getInstallDir(req.body?.installDir),
    localImageServerPort: normalizePort(req.body?.port),
  };
  await db.run(
    `INSERT INTO app_settings (id, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    "global",
    JSON.stringify(next),
    Date.now(),
  );
  res.json({ settings: next });
});

export async function maybeAutoStartLocalImageServer() {
  try {
    const db = await getDb();
    const row = (await db.get(
      "SELECT value FROM app_settings WHERE id = ?",
      "global",
    )) as any;
    const settings = row?.value ? JSON.parse(row.value || "{}") : {};
    if (!settings.localImageServerAutoRun) return;
    const installDir = getInstallDir(settings.localImageServerInstallDir);
    if (!exists(installDir) || runningProcess) return;
    const port = normalizePort(settings.localImageServerPort);
    patchLocalImageStartupScripts(installDir);
    runningProcess = spawn("cmd.exe", ["/c", "start.bat"], {
      cwd: installDir,
      env: buildLocalImageEnv(installDir, { fastMode: true, port }),
      detached: true,
      stdio: "ignore",
    });
    runningProcess.on("exit", () => {
      runningProcess = null;
    });
    runningProcess.unref();
  } catch (error) {
    console.error("[local-image-server] autorun failed:", error);
  }
}

export default router;
