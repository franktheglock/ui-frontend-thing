import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { cn } from "../lib/utils";

const providerOptions = [
  {
    id: "openrouter",
    label: "OpenRouter",
    env: "OPENROUTER_API_KEY",
    needsKey: true,
    description: "Use many hosted models through one OpenAI-compatible API.",
  },
  {
    id: "openai",
    label: "OpenAI",
    env: "OPENAI_API_KEY",
    needsKey: true,
    description:
      "Best default for GPT models, tools, and vision-capable workflows.",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    env: "ANTHROPIC_API_KEY",
    needsKey: true,
    description:
      "Claude models with strong writing, reasoning, and coding support.",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    env: "GEMINI_API_KEY",
    needsKey: true,
    description:
      "Google Gemini models with large context and multimodal support.",
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    env: "NVIDIA_API_KEY",
    needsKey: true,
    description: "NVIDIA-hosted open models through the NIM API.",
  },
  {
    id: "opencode-go",
    label: "Opencode Go",
    env: "OPENCODE_GO_API_KEY",
    needsKey: true,
    description: "Opencode's low-cost model subscription",
  },
  {
    id: "ollama",
    label: "Ollama",
    env: "OLLAMA_BASE_URL",
    needsKey: false,
    description: "Local models running on your machine or LAN via Ollama.",
  },
  {
    id: "lmstudio",
    label: "LM Studio",
    env: "LMSTUDIO_BASE_URL",
    needsKey: false,
    description: "Local OpenAI-compatible models served by LM Studio.",
  },
  {
    id: "llamacpp",
    label: "llama.cpp",
    env: "LLAMACPP_BASE_URL",
    needsKey: false,
    description: "Your local llama.cpp server — TurboQuant, MTP, hotswap models.",
  },
  {
    id: "openai-compatible",
    label: "Custom OpenAI Compatible",
    env: "CUSTOM_OAI_BASE_URL",
    needsKey: false,
    description: "Any server that speaks the OpenAI API. Set the base URL and optional API key.",
  },
] as const;

const imageProviderOptions = [
  {
    id: "local",
    label: "FLUX Klein 4B Local",
    needsKey: false,
    description: "Your local FLUX.2-klein-4B API server at localhost:8000.",
  },
  {
    id: "fal",
    label: "fal.ai",
    needsKey: true,
    keyField: "FAL_KEY",
    description: "Hosted fast image generation/editing endpoints.",
  },
  {
    id: "openai",
    label: "OpenAI Images",
    needsKey: true,
    keyField: "OPENAI_API_KEY",
    description: "OpenAI image generation and edit models.",
  },
  {
    id: "gemini",
    label: "Gemini Images",
    needsKey: true,
    keyField: "GEMINI_API_KEY",
    description: "Google Gemini image generation/editing models.",
  },
  {
    id: "grok",
    label: "xAI Grok Imagine",
    needsKey: true,
    keyField: "XAI_API_KEY",
    description: "xAI image generation provider.",
  },
  {
    id: "openrouter",
    label: "OpenRouter Images",
    needsKey: true,
    keyField: "OPENROUTER_API_KEY",
    description: "OpenRouter image models where supported.",
  },
] as const;

const localImageFallbackVariants = [
  {
    key: "bf16",
    label: "BF16",
    size: "~13GB",
    fit_label: "Needs ~13GB VRAM",
  },
  {
    key: "gguf-q8-0",
    label: "Q8_0 GGUF",
    size: "~4.30GB",
  },
  {
    key: "gguf-q6-k",
    label: "Q6_K GGUF",
    size: "~3.41GB",
  },
  {
    key: "gguf-q5-k-m",
    label: "Q5_K_M GGUF",
    size: "~3.07GB",
  },
  {
    key: "gguf-q4-k-m",
    label: "Q4_K_M GGUF",
    size: "~2.60GB",
  },
  {
    key: "gguf-q3-k-m",
    label: "Q3_K_M GGUF",
    size: "~2.12GB",
  },
  {
    key: "gguf-q2-k",
    label: "Q2_K GGUF",
    size: "~1.83GB",
  },
] as const;

function getSupportedLocalImageVariants(variants?: any[]) {
  const source = Array.isArray(variants) && variants.length
    ? variants
    : localImageFallbackVariants;
  return source.filter((variant) => variant?.key !== "fp8");
}

function getLocalImageVariantSize(variant: any) {
  if (typeof variant?.estimated_size_gb === "number") {
    return variant.estimated_size_gb;
  }

  const sizeText = typeof variant?.size === "string" ? variant.size : "";
  const parsedSize = Number.parseFloat(sizeText.replace(/[^\d.]/g, ""));
  return Number.isFinite(parsedSize) ? parsedSize : 0;
}

function pickBestSupportedLocalImageVariant(
  variants: any[],
  recommendedVariant?: any,
) {
  const supportedVariants = getSupportedLocalImageVariants(variants).sort(
    (left, right) =>
      getLocalImageVariantSize(right) - getLocalImageVariantSize(left),
  );

  if (!supportedVariants.length) return null;

  const visibleRecommended =
    recommendedVariant?.key && recommendedVariant.key !== "fp8"
      ? supportedVariants.find((variant) => variant.key === recommendedVariant.key)
      : null;

  if (visibleRecommended && visibleRecommended.fit_status !== "wont_fit") {
    return visibleRecommended;
  }

  return (
    supportedVariants.find((variant) => variant.fit_status === "fits") ||
    supportedVariants.find((variant) => variant.fit_status === "tight") ||
    supportedVariants.find(
      (variant) => !variant.fit_status || variant.fit_status === "unknown",
    ) ||
    supportedVariants[0]
  );
}

const searchOptions = [
  {
    id: "searxng",
    label: "SearxNG",
    needsConfig: true,
    placeholder: "http://localhost:8888",
    description:
      "Self-hosted metasearch; best if you already run a SearxNG instance.",
  },
  {
    id: "duckduckgo",
    label: "DuckDuckGo",
    needsConfig: false,
    placeholder: "",
    description: "No-key basic web search that works out of the box.",
  },
  {
    id: "brave",
    label: "Brave Search",
    needsConfig: true,
    placeholder: "Brave API key",
    description: "Fast commercial search API with independent web index.",
  },
  {
    id: "google",
    label: "Google PSE",
    needsConfig: true,
    placeholder: "Google API key and CX can be added later",
    description: "Google Programmable Search Engine using your API key and CX.",
  },
  {
    id: "parallel",
    label: "Parallel",
    needsConfig: true,
    placeholder: "Parallel API key",
    description: "Search API designed for AI agents and research workflows.",
  },
  {
    id: "exa",
    label: "Exa",
    needsConfig: true,
    placeholder: "Exa API key",
    description: "Neural search for finding semantically relevant pages.",
  },
  {
    id: "tavily",
    label: "Tavily",
    needsConfig: true,
    placeholder: "Tavily API key",
    description:
      "Research-focused search API with concise answer-oriented results.",
  },
  {
    id: "tinyfish",
    label: "TinyFish",
    needsConfig: true,
    placeholder: "TinyFish API key",
    description: "Fast web search tuned for agents — https://docs.tinyfish.ai/",
  },
] as const;

type Step =
  | "admin"
  | "welcome"
  | "providers"
  | "search"
  | "tools"
  | "images"
  | "mcp"
  | "memory"
  | "preferences"
  | "finish";

export function SetupWizard() {
  const {
    sharedSettingsLoaded,
    providersLoaded,
    toolsLoaded,
    setupComplete,
    providers,
    tools,
    hydrateSharedSettings,
    setProviders,
    setTools,
  } = useSettingsStore();
  const [stepIndex, setStepIndex] = useState(0);
  const [selectedProviderId, setSelectedProviderId] = useState("lmstudio");
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [searchProvider, setSearchProvider] = useState("searxng");
  const [searchValue, setSearchValue] = useState("http://192.168.1.70:8888");
  const [toolEnabled, setToolEnabled] = useState<Record<string, boolean>>({});
  const [imageGenerationEnabled, setImageGenerationEnabled] = useState(true);
  const [selectedImageProvider, setSelectedImageProvider] = useState("local");
  const [imageProviderKeys, setImageProviderKeys] = useState<
    Record<string, string>
  >({});
  const [autoRunLocalImageServer, setAutoRunLocalImageServer] = useState(false);
  const [localImageModel, setLocalImageModel] = useState("bf16");
  const [localImagePort, setLocalImagePort] = useState("8000");
  const [localImageStatus, setLocalImageStatus] = useState<any>(null);
  const [localImageAction, setLocalImageAction] = useState<string | null>(null);
  const [mcpConfig, setMcpConfig] = useState('{\n  "mcpServers": {}\n}');
  const [configureMcp, setConfigureMcp] = useState(false);
  const [memoryEnabled, setMemoryEnabled] = useState(true);
  const [initialMemory, setInitialMemory] = useState(
    "# User Memory\n\n## Profile\n\n- _No memories saved yet._\n\n## Preferences\n\n- _No memories saved yet._\n\n## Interests and hobbies\n\n- _No memories saved yet._\n\n## Current life context\n\n- _No memories saved yet._\n",
  );
  const [showThinking, setShowThinking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminDisplayName, setAdminDisplayName] = useState("Admin");
  const [adminCreated, setAdminCreated] = useState(false);
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/auth/setup-status", { credentials: "include" }).then(r=>r.json()).then(d=>setHasAdmin(!!d.hasAdmin)).catch(()=>setHasAdmin(true))
  }, [])

  const baseSteps: Step[] = hasAdmin === false ? ["admin", "welcome"] : ["welcome"]
  const steps: Step[] = [
    ...baseSteps,
    "providers",
    "search",
    "tools",
    "images",
    "mcp",
    "memory",
    "preferences",
    "finish",
  ];
  const step = steps[stepIndex];
  const selectedProvider = useMemo(
    () =>
      providerOptions.find((p) => p.id === selectedProviderId) ||
      providerOptions[0],
    [selectedProviderId],
  );
  const selectedSearch = useMemo(
    () =>
      searchOptions.find((p) => p.id === searchProvider) || searchOptions[0],
    [searchProvider],
  );
  const selectedImage = useMemo(
    () =>
      imageProviderOptions.find((p) => p.id === selectedImageProvider) ||
      imageProviderOptions[0],
    [selectedImageProvider],
  );
  const localImageVariants = useMemo(
    () => getSupportedLocalImageVariants(localImageStatus?.variants),
    [localImageStatus?.variants],
  );
  const recommendedLocalImageVariant = useMemo(() => {
    return pickBestSupportedLocalImageVariant(
      localImageVariants,
      localImageStatus?.recommendedVariant,
    );
  }, [localImageStatus?.recommendedVariant, localImageVariants]);
  const effectiveToolEnabled = (id: string, fallback: boolean) =>
    toolEnabled[id] ?? fallback;

  useEffect(() => {
    if (step !== "images") return;
    refreshLocalImageStatus().catch(console.error);
  }, [step, localImagePort]);

  if (hasAdmin === null) return null
  if (
    !sharedSettingsLoaded ||
    !providersLoaded ||
    !toolsLoaded ||
    setupComplete
  )
    return null;

  const refreshLocalImageStatus = async () => {
    const response = await fetch(
      `/api/local-image-server/status?port=${encodeURIComponent(localImagePort)}`,
    );
    if (!response.ok) return;
    const status = await response.json();
    setLocalImageStatus(status);
    const recommendedVariant = pickBestSupportedLocalImageVariant(
      status.variants,
      status.recommendedVariant,
    );
    if (recommendedVariant?.key) setLocalImageModel(recommendedVariant.key);
  };

  const createAdminAccount = async () => {
    setError(null); setSaving(true);
    try {
      const res = await fetch("/api/auth/setup-admin", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", body: JSON.stringify({ email: adminEmail, password: adminPassword, displayName: adminDisplayName }) });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) { setError(data.error || "Failed to create admin"); return false }
      setAdminCreated(true); return true;
    } catch (e:any) { setError(e.message); return false } finally { setSaving(false) }
  }

  const setupLocalServer = async () => {
    setLocalImageAction("setup");
    setError(null);
    try {
      const response = await fetch("/api/local-image-server/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ port: Number.parseInt(localImagePort, 10) || 8000 }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error || payload?.message || "Failed to set up local server",
        );
      }
      await refreshLocalImageStatus();
    } catch (err: any) {
      setError(err?.message || "Failed to set up local server");
    } finally {
      setLocalImageAction(null);
    }
  };

  const startLocalServer = async () => {
    setLocalImageAction("start");
    setError(null);
    try {
      const response = await fetch("/api/local-image-server/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelVariant: localImageModel,
          port: Number.parseInt(localImagePort, 10) || 8000,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          payload?.error || payload?.message || "Failed to start local server",
        );
      }

      let latest: any = null;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await refreshLocalImageStatus();
        const statusResponse = await fetch(
          `/api/local-image-server/status?port=${encodeURIComponent(localImagePort)}`,
        );
        latest = await statusResponse.json().catch(() => ({}));
        setLocalImageStatus(latest);
        if (latest.serverReachable) break;
        if (attempt > 0 && !latest.running && latest.errorLogTail) {
          throw new Error("Local image server exited during startup.");
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      if (latest && !latest.serverReachable && latest.running) {
        setError("Local image server is still starting. Refresh status in a moment.");
      } else if (latest && !latest.serverReachable) {
        setError("Local image server did not become reachable.");
      }
    } catch (err: any) {
      setError(err?.message || "Failed to start local server");
    } finally {
      setLocalImageAction(null);
    }
  };

  const patchProvider = async (
    providerId: string,
    updates: Record<string, unknown>,
  ) => {
    const provider = providers.find((p) => p.id === providerId);
    if (!provider) return;
    await fetch(`/api/providers/${encodeURIComponent(providerId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...provider, ...updates }),
    });
  };

  const buildSearchConfig = () => {
    if (searchProvider === "searxng")
      return { searxngUrl: searchValue.trim() || "http://192.168.1.70:8888" };
    if (searchProvider === "brave") return { braveApiKey: searchValue.trim() };
    if (searchProvider === "parallel")
      return { parallelApiKey: searchValue.trim() };
    if (searchProvider === "exa") return { exaApiKey: searchValue.trim() };
    if (searchProvider === "tavily")
      return { tavilyApiKey: searchValue.trim() };
    if (searchProvider === "tinyfish")
      return { tinyfishApiKey: searchValue.trim() };
    return {};
  };

  const skipSetup = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setupComplete: true }),
      });
      const payload = await response.json().catch(() => ({}));
      hydrateSharedSettings(payload.settings || { setupComplete: true });
    } finally {
      setSaving(false);
    }
  };

  const finishSetup = async () => {
    setSaving(true);
    setError(null);
    try {
      const selected = providers.find((p) => p.id === selectedProviderId);
      const key = apiKeys[selectedProviderId]?.trim();
      if (selected) {
        await patchProvider(selectedProviderId, {
          enabled: true,
          apiKey: selectedProvider.needsKey
            ? key || selected.apiKey || ""
            : selected.apiKey || "",
        });
      }

      await Promise.all(
        tools.map((tool) =>
          fetch(`/api/tools/${encodeURIComponent(tool.id)}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              enabled: effectiveToolEnabled(tool.id, tool.enabled),
              config: tool.config || {},
            }),
          }),
        ),
      );

      if (configureMcp) {
        const parsed = JSON.parse(mcpConfig);
        await fetch("/api/mcp/config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
      }

      if (imageGenerationEnabled) {
        if (selectedImageProvider === "local") {
          await fetch("/api/local-image-server/settings", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              autoRun: autoRunLocalImageServer,
              port: Number.parseInt(localImagePort, 10) || 8000,
            }),
          });
        }

        await fetch("/api/images/settings", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            selectedProvider: selectedImageProvider,
            providers: [
              selectedImageProvider === "local"
                ? {
                    id: "local",
                    name: "FLUX Klein 4B Local",
                    enabled: true,
                    baseUrl: "http://localhost:8000",
                    apiKey: "",
                    model: localImageModel,
                  }
                : {
                    id: selectedImageProvider,
                    name: selectedImage.label,
                    enabled: true,
                    apiKey: imageProviderKeys[selectedImageProvider] || "",
                  },
            ],
          }),
        });
      }

      if (memoryEnabled && initialMemory.trim()) {
        await fetch("/api/memory", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: initialMemory }),
        });
      }

      const modelsRes = selected
        ? await fetch(
            `/api/providers/${encodeURIComponent(selectedProviderId)}/models`,
          ).catch(() => null)
        : null;
      const models = modelsRes?.ok
        ? await modelsRes.json().catch(() => [])
        : [];
      const selectedModel =
        Array.isArray(models) && models.length > 0
          ? models[0]
          : selected?.models?.[0] || "";
      const settingsPayload = {
        selectedProvider: selectedProviderId,
        selectedModel,
        defaultSearchProvider: searchProvider,
        searchConfig: buildSearchConfig(),
        memoryEnabled,
        showThinking,
        setupComplete: true,
      };
      const settingsRes = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsPayload),
      });
      if (!settingsRes.ok) throw new Error("Failed to save setup settings");
      const settingsData = await settingsRes.json();
      hydrateSharedSettings(settingsData.settings || settingsPayload);

      const [providersRes, toolsRes] = await Promise.all([
        fetch("/api/providers"),
        fetch("/api/tools"),
      ]);
      if (providersRes.ok) setProviders(await providersRes.json());
      if (toolsRes.ok) {
        const backendTools = await toolsRes.json();
        if (Array.isArray(backendTools))
          setTools(
            backendTools.map((tool: any) => ({
              id: tool.name,
              name: tool.name,
              enabled: tool.enabled !== false,
              config: tool.config || {},
            })),
          );
      }
    } catch (err: any) {
      setError(err.message || "Setup failed");
    } finally {
      setSaving(false);
    }
  };

  const canContinue =
    (step === "admin" ? (hasAdmin === true || adminCreated) : true) &&
    (step !== "providers" || !selectedProvider.needsKey || !!apiKeys[selectedProviderId]?.trim());

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-accent/40 bg-accent/10">
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground">
                Welcome to AI Chat UI
              </h1>
              <p className="text-sm text-muted-foreground">
                Let’s get the essentials configured.
              </p>
            </div>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-6 flex gap-2">
            {steps.map((item, index) => (
              <div
                key={item}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  index <= stepIndex ? "bg-accent" : "bg-secondary",
                )}
              />
            ))}
          </div>

          {step === "admin" && (
            <div className="space-y-4">
              <WizardSection
                title="Create admin account"
                description="First, create the administrator account. This admin will approve new users, set spend limits, allowed providers, and manage the simplified model picker."
              />
              {adminCreated ? (
                <div className="rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-700">Admin account created. You can continue.</div>
              ) : hasAdmin === false ? (
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-medium">Admin display name</label>
                    <input value={adminDisplayName} onChange={e=>setAdminDisplayName(e.target.value)} placeholder="Admin" className="mt-1 w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Admin email</label>
                    <input type="email" value={adminEmail} onChange={e=>setAdminEmail(e.target.value)} placeholder="admin@example.com" className="mt-1 w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm" />
                  </div>
                  <div>
                    <label className="text-xs font-medium">Password (≥8 chars)</label>
                    <input type="password" value={adminPassword} onChange={e=>setAdminPassword(e.target.value)} placeholder="••••••••" className="mt-1 w-full px-3 py-2 bg-secondary border border-border rounded-md text-sm" />
                  </div>
                  {error && <div className="text-sm text-red-500 bg-red-500/10 border border-red-500/20 rounded px-3 py-2">{error}</div>}
                  <button onClick={async ()=>{ const ok = await createAdminAccount(); if (ok) setHasAdmin(true) }} disabled={saving} className="w-full py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50">{saving ? "Creating…" : "Create admin account"}</button>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground">Admin already exists. Continue.</div>
              )}
            </div>
          )}

          {step === "welcome" && (
            <WizardSection
              title="First-launch setup wizard"
              description="This wizard will pick defaults for providers, web search, tools, MCP, and memory. You can change everything later in Settings."
            />
          )}

          {step === "providers" && (
            <div className="space-y-4">
              <WizardSection
                title="Choose your default chat provider"
                description="Pick the backend you want new chats to use first."
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {providerOptions.map((provider) => (
                  <button
                    key={provider.id}
                    type="button"
                    onClick={() => setSelectedProviderId(provider.id)}
                    className={cn(
                      "border px-3 py-3 text-left text-sm transition-colors",
                      selectedProviderId === provider.id
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{provider.label}</span>
                      {selectedProviderId === provider.id && (
                        <Check className="h-4 w-4 text-accent" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {provider.description}
                    </p>
                  </button>
                ))}
              </div>
              {selectedProvider.needsKey ? (
                <TextInput
                  label={`${selectedProvider.label} API key`}
                  type="password"
                  value={apiKeys[selectedProviderId] || ""}
                  placeholder={selectedProvider.env}
                  onChange={(value) =>
                    setApiKeys((current) => ({
                      ...current,
                      [selectedProviderId]: value,
                    }))
                  }
                  hint="You can choose a local provider to skip API keys, or edit keys later in Settings."
                />
              ) : (
                <p className="rounded-sm border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                  {selectedProvider.label} does not need an API key here. Make
                  sure the local server is running when you chat.
                </p>
              )}
            </div>
          )}

          {step === "search" && (
            <div className="space-y-4">
              <WizardSection
                title="Set up web search"
                description="Choose the search provider the web_search tool should use by default."
              />
              <div className="grid gap-2 sm:grid-cols-2">
                {searchOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => setSearchProvider(option.id)}
                    className={cn(
                      "border px-3 py-3 text-left text-sm transition-colors",
                      searchProvider === option.id
                        ? "border-accent bg-accent/10 text-foreground"
                        : "border-border bg-secondary/20 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{option.label}</span>
                      {searchProvider === option.id && (
                        <Check className="h-4 w-4 text-accent" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {option.description}
                    </p>
                  </button>
                ))}
              </div>
              {selectedSearch.needsConfig && (
                <TextInput
                  label={`${selectedSearch.label} configuration`}
                  value={searchValue}
                  placeholder={selectedSearch.placeholder}
                  onChange={setSearchValue}
                  hint="You can leave API-key providers blank and configure them later in Settings → Tools."
                />
              )}
            </div>
          )}

          {step === "tools" && (
            <div className="space-y-4">
              <WizardSection
                title="Enable tools"
                description="Turn off anything you do not want models to use by default."
              />
              <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {tools.map((tool) => (
                  <ToggleRow
                    key={tool.id}
                    title={tool.name}
                    description={
                      tool.id === "memory"
                        ? "Read and update user memory."
                        : undefined
                    }
                    enabled={effectiveToolEnabled(tool.id, tool.enabled)}
                    onToggle={() =>
                      setToolEnabled((current) => ({
                        ...current,
                        [tool.id]: !effectiveToolEnabled(tool.id, tool.enabled),
                      }))
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {step === "images" && (
            <div className="space-y-4">
              <WizardSection
                title="Image generation and editing"
                description="Choose the image provider used by the image studio and generate_image tool."
              />
              <ToggleRow
                title="Enable image generation"
                description="If disabled, image provider setup is skipped."
                enabled={imageGenerationEnabled}
                onToggle={() =>
                  setImageGenerationEnabled(!imageGenerationEnabled)
                }
              />
              {imageGenerationEnabled && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {imageProviderOptions.map((provider) => (
                      <button
                        key={provider.id}
                        type="button"
                        onClick={() => setSelectedImageProvider(provider.id)}
                        className={cn(
                          "border px-3 py-3 text-left text-sm transition-colors",
                          selectedImageProvider === provider.id
                            ? "border-accent bg-accent/10 text-foreground"
                            : "border-border bg-secondary/20 text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium">{provider.label}</span>
                          {selectedImageProvider === provider.id && (
                            <Check className="h-4 w-4 text-accent" />
                          )}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {provider.description}
                        </p>
                      </button>
                    ))}
                  </div>
                  {selectedImage.needsKey && (
                    <TextInput
                      label={`${selectedImage.label} API key`}
                      type="password"
                      value={imageProviderKeys[selectedImageProvider] || ""}
                      placeholder={selectedImage.keyField}
                      onChange={(value) =>
                        setImageProviderKeys((current) => ({
                          ...current,
                          [selectedImageProvider]: value,
                        }))
                      }
                      hint="You can add or change this later in Settings → Providers."
                    />
                  )}
                  {selectedImageProvider === "local" && (
                    <>
                      <div className="rounded-sm border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p>
                              <span className="text-foreground">
                                Install path:
                              </span>{" "}
                              {localImageStatus?.installDir || "Detecting..."}
                            </p>
                            <p>
                              <span className="text-foreground">
                                Installed:
                              </span>{" "}
                              {localImageStatus?.installed ? "Yes" : "No"}
                            </p>
                            <p>
                              <span className="text-foreground">Server:</span>{" "}
                              {localImageStatus?.serverReachable
                                ? "Reachable"
                                : "Not reachable"}
                            </p>
                            {(localImageStatus?.hardware ||
                              localImageStatus?.modelStatus?.hardware) && (
                              <p>
                                <span className="text-foreground">
                                  Hardware:
                                </span>{" "}
                                {(
                                  localImageStatus.hardware ||
                                  localImageStatus.modelStatus.hardware
                                ).gpu_name ||
                                  (
                                    localImageStatus.hardware ||
                                    localImageStatus.modelStatus.hardware
                                  ).backend_label ||
                                  "Unknown"}
                                {(
                                  localImageStatus.hardware ||
                                  localImageStatus.modelStatus.hardware
                                ).total_vram_gb
                                  ? ` — ${(localImageStatus.hardware || localImageStatus.modelStatus.hardware).total_vram_gb}GB VRAM`
                                  : ""}
                              </p>
                            )}
                            <p>
                              <span className="text-foreground">Own venv:</span>{" "}
                              {localImageStatus?.isolatedVenv
                                ? "Yes"
                                : "Will be created by start.bat"}
                            </p>
                            {recommendedLocalImageVariant && (
                              <p>
                                <span className="text-foreground">
                                  Recommended:
                                </span>{" "}
                                {recommendedLocalImageVariant.label ||
                                  recommendedLocalImageVariant.key}{" "}
                                (
                                {recommendedLocalImageVariant.fit_label ||
                                  recommendedLocalImageVariant.size}
                                )
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={refreshLocalImageStatus}
                            className="border border-border bg-secondary px-3 py-1.5 text-xs text-foreground"
                          >
                            Refresh
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={setupLocalServer}
                          disabled={localImageAction === "setup"}
                          className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50"
                        >
                          {localImageAction === "setup" && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          Prepare local server
                        </button>
                        <button
                          type="button"
                          onClick={startLocalServer}
                          disabled={
                            localImageAction === "start" ||
                            !localImageStatus?.installed
                          }
                          className="inline-flex items-center gap-1.5 border border-border bg-secondary px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
                        >
                          {localImageAction === "start" && (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          )}
                          {localImageStatus?.isolatedVenv
                            ? "Start local server"
                            : "Install & start"}
                        </button>
                      </div>
                      {localImageStatus?.errorLogTail &&
                        !localImageStatus?.serverReachable && (
                          <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all border border-destructive/20 bg-destructive/5 p-2 text-[10px] text-muted-foreground">
                            {localImageStatus.errorLogTail}
                          </pre>
                        )}
                      <ToggleRow
                        title="Run local image server with the app"
                        description="Starts start.bat automatically when this app server starts."
                        enabled={autoRunLocalImageServer}
                        onToggle={() =>
                          setAutoRunLocalImageServer(!autoRunLocalImageServer)
                        }
                      />
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Server port
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={localImagePort}
                          onChange={(event) =>
                            setLocalImagePort(event.target.value)
                          }
                          className="w-full border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                        <p className="text-xs text-muted-foreground">
                          Pick an unused port if something is already listening
                          on 8000.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">
                          Model variant
                        </label>
                        <select
                          value={localImageModel}
                          onChange={(event) =>
                            setLocalImageModel(event.target.value)
                          }
                          className="w-full border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
                        >
                          {localImageVariants.map((variant: any) => (
                            <option key={variant.key} value={variant.key}>
                              {variant.label || variant.key} — {variant.size}
                              {variant.fit_label
                                ? ` — ${variant.fit_label}`
                                : ""}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          The custom server auto-detects CUDA, DirectML, or CPU
                          on first run and stores the best backend in its own
                          .env. Pick the largest variant that fits
                          on your GPU.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Expect roughly 3GB of app/runtime files plus the
                          chosen model size on that drive.
                        </p>
                      </div>
                      <div className="rounded-sm border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
                        <p className="mb-2 font-medium text-foreground">
                          How it works:
                        </p>
                        <p>
                          The FLUX image server is bundled with this app. Pressing{" "}
                          <span className="font-medium text-foreground">Prepare</span>{" "}
                          creates the cache folders and patches the startup scripts.
                        </p>
                        <p className="mt-2">
                          Pressing{" "}
                          <span className="font-medium text-foreground">Install &amp; start</span>{" "}
                          runs start.bat, which creates a Python venv and downloads ~10–15 GB of
                          AI model weights on the first run. Subsequent starts skip the install.
                        </p>
                        <p className="mt-2">
                          The server exposes http://localhost:{"<port>"}/api/health when ready.
                        </p>
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {step === "mcp" && (
            <div className="space-y-4">
              <WizardSection
                title="MCP servers"
                description="Optionally paste an MCP config now. You can skip this and configure MCP later."
              />
              <ToggleRow
                title="Configure MCP now"
                description="Paste a JSON object like { mcpServers: { ... } }."
                enabled={configureMcp}
                onToggle={() => setConfigureMcp(!configureMcp)}
              />
              {configureMcp && (
                <textarea
                  value={mcpConfig}
                  onChange={(event) => setMcpConfig(event.target.value)}
                  rows={10}
                  spellCheck={false}
                  className="w-full border border-border bg-background/70 px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                />
              )}
            </div>
          )}

          {step === "memory" && (
            <div className="space-y-4">
              <WizardSection
                title="Initial memory"
                description="If memory is enabled, seed a few durable facts the assistant should remember. Keep it short and non-sensitive."
              />
              <ToggleRow
                title="Enable memory"
                description="Memory is stored locally in data/memory.md."
                enabled={memoryEnabled}
                onToggle={() => setMemoryEnabled(!memoryEnabled)}
              />
              {memoryEnabled && (
                <textarea
                  value={initialMemory}
                  onChange={(event) => setInitialMemory(event.target.value)}
                  rows={12}
                  spellCheck={false}
                  className="w-full border border-border bg-background/70 px-3 py-2 font-mono text-xs outline-none focus:border-accent"
                />
              )}
            </div>
          )}

          {step === "preferences" && (
            <div className="space-y-5">
              <WizardSection
                title="Interface preferences"
                description="Set a couple of display defaults before you start."
              />
              <ToggleRow
                title="Show thinking"
                description="Display model reasoning/thinking blocks when providers send them."
                enabled={showThinking}
                onToggle={() => setShowThinking(!showThinking)}
              />
            </div>
          )}

          {step === "finish" && (
            <div className="space-y-4">
              <WizardSection
                title="Ready to go"
                description="Review and finish setup."
              />
              <div className="space-y-2 rounded-sm border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
                <p>
                  <span className="text-foreground">Provider:</span>{" "}
                  {selectedProvider.label}
                </p>
                <p>
                  <span className="text-foreground">Search:</span>{" "}
                  {selectedSearch.label}
                </p>
                <p>
                  <span className="text-foreground">Images:</span>{" "}
                  {imageGenerationEnabled
                    ? selectedImageProvider === "local"
                      ? `FLUX Klein 4B Local (${localImageModel})`
                      : selectedImage.label
                    : "Disabled"}
                </p>
                <p>
                  <span className="text-foreground">Memory:</span>{" "}
                  {memoryEnabled ? "Enabled" : "Disabled"}
                </p>
                <p>
                  <span className="text-foreground">MCP:</span>{" "}
                  {configureMcp ? "Configured from pasted JSON" : "Skipped"}
                </p>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={skipSetup}
            disabled={saving}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          >
            Skip setup
          </button>
          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStepIndex((current) => Math.max(0, current - 1))}
            disabled={stepIndex === 0 || saving}
            className="inline-flex items-center gap-2 border border-border bg-secondary px-4 py-2 text-sm text-foreground transition-opacity disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
          {stepIndex < steps.length - 1 ? (
            <button
              type="button"
              onClick={() =>
                setStepIndex((current) =>
                  Math.min(steps.length - 1, current + 1),
                )
              }
              disabled={!canContinue}
              className="inline-flex items-center gap-2 bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-40"
            >
              Continue
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finishSetup}
              disabled={saving}
              className="inline-flex items-center gap-2 bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity disabled:opacity-40"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              Finish setup
            </button>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}

function WizardSection({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div>
      <h2 className="text-base font-medium text-foreground">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-muted-foreground">
        {description}
      </p>
    </div>
  );
}

function TextInput({
  label,
  value,
  onChange,
  placeholder,
  hint,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
  type?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">{label}</label>
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
      />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
}: {
  title: string;
  description?: string;
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-sm border border-border bg-secondary/20 p-4">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={onToggle}
        className="shrink-0"
      >
        <span
          className={cn(
            "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
            enabled
              ? "border-accent bg-accent/80"
              : "border-border bg-secondary",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
              enabled ? "translate-x-5" : "translate-x-1",
            )}
          />
        </span>
      </button>
    </div>
  );
}
