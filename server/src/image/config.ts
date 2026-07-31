import { getDb } from "../db";
import {
  ImageGenerationSettings,
  ImageProviderConfig,
  ImageProviderId,
} from "./types";

const DEFAULT_PROVIDERS: ImageProviderConfig[] = [
  {
    id: "local",
    name: "FLUX Klein 4B Local",
    enabled: true,
    baseUrl: process.env.LOCAL_IMAGE_API_URL || "http://localhost:8000",
    apiKey: "",
    model: process.env.LOCAL_IMAGE_MODEL || "bf16",
  },
  {
    id: "fal",
    name: "fal.ai",
    enabled: false,
    baseUrl: process.env.FAL_BASE_URL || "https://fal.run",
    apiKey: process.env.FAL_KEY || "",
    model: process.env.FAL_IMAGE_MODEL || "fal-ai/flux/dev",
  },
  {
    id: "openrouter",
    name: "OpenRouter Images",
    enabled: false,
    baseUrl:
      process.env.OPENROUTER_IMAGE_BASE_URL || "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "",
    model:
      process.env.OPENROUTER_IMAGE_MODEL || "google/gemini-2.5-flash-image",
  },
  {
    id: "grok",
    name: "xAI Grok Imagine",
    enabled: false,
    baseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
    apiKey: process.env.XAI_API_KEY || "",
    model: process.env.XAI_IMAGE_MODEL || "grok-imagine-image-quality",
  },
  {
    id: "openai",
    name: "OpenAI Images",
    enabled: false,
    baseUrl: process.env.OPENAI_IMAGE_BASE_URL || "https://api.openai.com/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
  },
  {
    id: "gemini",
    name: "Google Gemini Images",
    enabled: false,
    baseUrl:
      process.env.GEMINI_IMAGE_BASE_URL ||
      "https://generativelanguage.googleapis.com/v1beta",
    apiKey: process.env.GEMINI_API_KEY || "",
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image-preview",
  },
];

const DEFAULT_SETTINGS: ImageGenerationSettings = {
  selectedProvider: "local",
  providers: DEFAULT_PROVIDERS,
};

function mergeProviders(
  incoming?: ImageProviderConfig[],
): ImageProviderConfig[] {
  const incomingById = new Map(
    (incoming || []).map((provider) => [provider.id, provider]),
  );

  return DEFAULT_PROVIDERS.map((provider) => {
    const saved = incomingById.get(provider.id);
    if (!saved) return provider;

    return {
      ...provider,
      ...saved,
      id: provider.id,
      name:
        saved.name === "Local Atelier"
          ? provider.name
          : saved.name || provider.name,
      baseUrl: saved.baseUrl || provider.baseUrl,
      model: saved.model || provider.model,
      apiKey: saved.apiKey ?? provider.apiKey,
      enabled: saved.enabled ?? provider.enabled,
    };
  });
}

function normalizeProviderId(value: unknown): ImageProviderId {
  const match = DEFAULT_PROVIDERS.find((provider) => provider.id === value);
  return match?.id || DEFAULT_SETTINGS.selectedProvider;
}

export function mergeImageSettings(
  incoming?: Partial<ImageGenerationSettings>,
): ImageGenerationSettings {
  return {
    selectedProvider: normalizeProviderId(incoming?.selectedProvider),
    providers: mergeProviders(incoming?.providers),
  };
}

export async function loadImageSettings(): Promise<ImageGenerationSettings> {
  const db = await getDb();
  const row = (await db.get(
    "SELECT value FROM app_settings WHERE id = ?",
    "image_generation",
  )) as { value?: string } | undefined;

  if (!row?.value) {
    return DEFAULT_SETTINGS;
  }

  try {
    return mergeImageSettings(JSON.parse(row.value));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Redact API keys for client responses. */
export function sanitizeImageSettings(
  settings: ImageGenerationSettings,
): ImageGenerationSettings {
  return {
    ...settings,
    providers: settings.providers.map((provider) => ({
      ...provider,
      hasApiKey: !!(provider.apiKey && provider.apiKey.trim()),
      apiKey: "",
    })),
  };
}

export async function saveImageSettings(
  settings: Partial<ImageGenerationSettings>,
): Promise<ImageGenerationSettings> {
  const db = await getDb();
  const current = await loadImageSettings();

  // Preserve existing keys when client sends empty (redacted) apiKey values
  let providers = settings.providers || current.providers;
  if (settings.providers) {
    const currentById = new Map(current.providers.map((p) => [p.id, p]));
    providers = settings.providers.map((incoming) => {
      const existing = currentById.get(incoming.id);
      const keepKey =
        !incoming.apiKey || !String(incoming.apiKey).trim()
          ? existing?.apiKey || ""
          : incoming.apiKey;
      const { hasApiKey: _has, ...rest } = incoming as ImageProviderConfig & {
        hasApiKey?: boolean;
      };
      return { ...rest, apiKey: keepKey };
    });
  }

  const next = mergeImageSettings({
    ...current,
    ...settings,
    providers,
  });

  await db.run(
    `INSERT INTO app_settings (id, value, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    "image_generation",
    JSON.stringify(next),
    Date.now(),
  );

  return next;
}
