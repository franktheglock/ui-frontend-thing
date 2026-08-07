import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Settings,
  Key,
  Wrench,
  Download,
  Loader2,
  Trash2,
  Sparkles,
  Image as ImageIcon,
  RefreshCcw,
  Brain,
  Save,
  Network,
  Copy,
  Check,
  Shield,
} from "lucide-react";
import { useSettingsStore } from "../stores/settingsStore";
import { useImageStudioStore } from "../stores/imageStudioStore";
import { useUIStore } from "../stores/uiStore";
import { useAuthStore } from "../stores/authStore";
import { AdminPanel } from "./AdminPanel";
import { cn } from "../lib/utils";
import { setApiToken } from "../lib/apiAuth";

type SettingsTab = "general" | "providers" | "tools" | "skills" | "memory" | "admin";

const reasoningEffortOptions = [
  { value: "auto", label: "Provider default" },
  { value: "none", label: "None" },
  { value: "minimal", label: "Minimal" },
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "xhigh", label: "X-High" },
  { value: "max", label: "Max" },
] as const;

const heroTextOptions = [
  {
    title: "What's on your mind?",
    subtitle: "Search the web, run code, or just chat.",
  },
  {
    title: "Ready when you are.",
    subtitle: "Ask a question, start a project, or chase a weird idea.",
  },
  {
    title: "Let’s make something useful.",
    subtitle: "From quick answers to deep work, start anywhere.",
  },
  {
    title: "Start with a spark.",
    subtitle: "Explore an idea, solve a problem, or build momentum.",
  },
  {
    title: "Bring me the messy version.",
    subtitle: "I can help shape rough thoughts into something sharp.",
  },
  {
    title: "What are we figuring out today?",
    subtitle: "Research it, write it, plan it, or debug it.",
  },
  {
    title: "One prompt can change the day.",
    subtitle: "Try a question worth thinking about.",
  },
  {
    title: "Open thread, closed tabs.",
    subtitle: "Drop in the task you have been putting off.",
  },
  {
    title: "Think bigger, start smaller.",
    subtitle: "We can turn vague ambition into concrete steps.",
  },
  {
    title: "Pick a direction.",
    subtitle:
      "I can help with code, strategy, writing, and everything between.",
  },
  {
    title: "What should exist that does not?",
    subtitle: "Let’s design, prototype, or reason it out.",
  },
  {
    title: "Ask the dangerous question.",
    subtitle: "The interesting one. The useful one. The hard one.",
  },
  {
    title: "Here for the rabbit holes.",
    subtitle: "Research deeply or just follow your curiosity.",
  },
  {
    title: "Make progress, not noise.",
    subtitle: "Bring a problem and we will work the edges.",
  },
  {
    title: "This could be the clean start.",
    subtitle: "New chat, new angle, same momentum.",
  },
  {
    title: "You can start half-formed.",
    subtitle: "Rough notes and unfinished thoughts are enough.",
  },
  {
    title: "What needs clarity?",
    subtitle:
      "I can help untangle the technical, practical, or creative parts.",
  },
  {
    title: "Let’s build from first principles.",
    subtitle: "Or skip straight to the version that works.",
  },
  {
    title: "What are you trying to move?",
    subtitle: "A project, a bug, a decision, or your own thinking.",
  },
  {
    title: "Today feels like a good day to ship.",
    subtitle: "Let’s turn intention into output.",
  },
  {
    title: "Start anywhere interesting.",
    subtitle: "A question, a code snippet, a plan, a mess.",
  },
  {
    title: "Use me as your second brain.",
    subtitle: "For research, writing, systems, and tactical thinking.",
  },
  {
    title: "What deserves a better answer?",
    subtitle: "Let’s go deeper than the obvious version.",
  },
  {
    title: "Bring me the impossible-looking task.",
    subtitle: "We can usually reduce it to something tractable.",
  },
  {
    title: "A good prompt beats a blank page.",
    subtitle: "Let’s find the one that unlocks motion.",
  },
  {
    title: "Where do you want leverage?",
    subtitle: "In code, workflows, decisions, or learning.",
  },
  {
    title: "Let’s make this easier.",
    subtitle: "Automate it, rewrite it, simplify it, or rethink it.",
  },
  {
    title: "Curiosity is enough.",
    subtitle: "You do not need a perfect question to start.",
  },
  {
    title: "What do you want to understand better?",
    subtitle: "Technical systems, big ideas, or your own next move.",
  },
  {
    title: "Let’s turn friction into flow.",
    subtitle: "Name the bottleneck and we will work on it.",
  },
  {
    title: "Something worth exploring?",
    subtitle: "We can chase it until it becomes useful.",
  },
  {
    title: "Make it concrete.",
    subtitle: "I can help turn abstractions into plans and plans into action.",
  },
  {
    title: "What are we shipping?",
    subtitle: "A fix, a feature, a plan, or a better question.",
  },
  {
    title: "Bring the overcomplicated thing.",
    subtitle: "I like making systems legible.",
  },
  {
    title: "There is probably a smarter way.",
    subtitle: "Let’s find it together.",
  },
  {
    title: "Start with the version you can say out loud.",
    subtitle: "We can refine it from there.",
  },
  {
    title: "What would make today feel productive?",
    subtitle: "Let’s design that path on purpose.",
  },
  {
    title: "Ask for the ambitious version.",
    subtitle: "We can scale it down later if needed.",
  },
  {
    title: "Your next good idea can start here.",
    subtitle: "One prompt, one plan, one clear next step.",
  },
  {
    title: "What is still fuzzy?",
    subtitle: "We can sharpen it until it becomes usable.",
  },
  {
    title: "Let’s make the invisible visible.",
    subtitle: "Systems, assumptions, tradeoffs, structure.",
  },
  {
    title: "Build momentum from one question.",
    subtitle: "That is usually enough.",
  },
  {
    title: "Need a better angle?",
    subtitle: "I can challenge assumptions or help frame the problem.",
  },
  {
    title: "What is the highest-leverage move?",
    subtitle: "Let’s identify it before doing more work than necessary.",
  },
  {
    title: "This is a good place to think.",
    subtitle: "Quietly, practically, and with some ambition.",
  },
  {
    title: "What should be simpler than it is?",
    subtitle: "That is often where the best work starts.",
  },
  {
    title: "Let’s turn ideas into structure.",
    subtitle: "And structure into something you can use immediately.",
  },
  {
    title: "What are we solving for?",
    subtitle: "Speed, clarity, depth, creativity, or all four.",
  },
  {
    title: "You bring the intent.",
    subtitle: "I will help with the shape, logic, and execution.",
  },
  {
    title: "Make the next move obvious.",
    subtitle: "That is usually the difference between stalled and done.",
  },
] as const;

function getReasoningEffortHint(providerId: string) {
  switch (providerId) {
    case "openai":
    case "openrouter":
    case "openai-compatible":
    case "hermes-agent":
    case "nvidia":
    case "lmstudio":
      return "OpenAI-style providers use the nearest supported reasoning effort level.";
    case "anthropic":
      return "Anthropic maps this to Claude effort. Unsupported lower levels are rounded up.";
    case "gemini":
      return "Gemini maps this to thinking level on Gemini 3 and thinking budget on Gemini 2.5.";
    default:
      return "Applied only when the selected provider supports reasoning controls.";
  }
}

function LocalInput({ value, onChange, ...props }: any) {
  const [localValue, setLocalValue] = useState(value);
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);
  return (
    <input
      {...props}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => onChange(localValue)}
    />
  );
}

function LocalTextarea({ value, onChange, ...props }: any) {
  const [localValue, setLocalValue] = useState(value);
  React.useEffect(() => {
    setLocalValue(value);
  }, [value]);
  return (
    <textarea
      {...props}
      value={localValue}
      onChange={(e) => setLocalValue(e.target.value)}
      onBlur={() => onChange(localValue)}
    />
  );
}

function ModelSearchSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string;
  options: string[];
  onChange: (val: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((m) => m.toLowerCase().includes(q));
  }, [options, query]);

  React.useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const handleSelect = (model: string) => {
    onChange(model);
    setOpen(false);
    setQuery("");
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={open ? query : value}
        placeholder={placeholder || "Search models..."}
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setOpen(false);
            inputRef.current?.blur();
          }
          if (e.key === "Enter" && filtered.length > 0) {
            handleSelect(filtered[0]);
            e.preventDefault();
          }
        }}
        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {open && (
        <div className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto border border-border bg-card shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              No models match "{query}"
            </div>
          ) : (
            filtered.map((model) => (
              <button
                key={model}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  handleSelect(model);
                }}
                className={cn(
                  "w-full px-3 py-2 text-left text-sm transition-colors",
                  model === value
                    ? "bg-accent text-accent-foreground"
                    : "text-foreground hover:bg-secondary",
                )}
              >
                {model}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUIStore();
  const {
    heroTitle,
    heroSubtitle,
    systemPrompt,
    temperature,
    maxTokens,
    topP,
    selectedProvider,
    reasoningEffort,
    streamResponses,
    showThinking,
    showGenerationInfo,
    defaultSearchProvider,
    searchConfig,
    artifactsEnabled,
    toolDisplayMode,
    maxToolTurns,
    memoryEnabled,
    setHeroTitle,
    setHeroSubtitle,
    setSystemPrompt,
    setTemperature,
    setMaxTokens,
    setTopP,
    setReasoningEffort,
    setStreamResponses,
    setShowThinking,
    setShowGenerationInfo,
    setDefaultSearchProvider,
    setSearchConfig,
    setArtifactsEnabled,
    setToolDisplayMode,
    setMaxToolTurns,
    setMemoryEnabled,
    providers,
    updateProvider,
    removeProvider,
  } = useSettingsStore();

  const [activeTab, setActiveTab] = useState<SettingsTab>("general");
  const { user: authUser } = useAuthStore();
  const isAdmin = authUser?.role === "admin";
  const [skillSearch, setSkillSearch] = useState("");
  const [skillView, setSkillView] = useState<
    "trending" | "all-time" | "curated"
  >("trending");
  const [browseSkills, setBrowseSkills] = useState<any[]>([]);
  const [installedSkills, setInstalledSkills] = useState<any[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillUrl, setSkillUrl] = useState("");
  const [installingUrl, setInstallingUrl] = useState(false);
  const [memoryContent, setMemoryContent] = useState("");
  const [memoryFilePath, setMemoryFilePath] = useState("");
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memorySaving, setMemorySaving] = useState(false);
  const [memoryStatus, setMemoryStatus] = useState<string | null>(null);
  const [imageProviderModels, setImageProviderModels] = useState<
    Record<string, string[]>
  >({});
  const [imageProviderModelsLoading, setImageProviderModelsLoading] = useState<
    Record<string, boolean>
  >({});
  const [imageProviderModelsError, setImageProviderModelsError] = useState<
    Record<string, string | null>
  >({});
  const [localImageAutoRun, setLocalImageAutoRun] = useState(false);
  const [localImagePort, setLocalImagePort] = useState("8000");
  const [localImageSaving, setLocalImageSaving] = useState(false);
  const [localImageStarting, setLocalImageStarting] = useState(false);
  const [localImageModelLoading, setLocalImageModelLoading] = useState(false);
  const [localImageModelLoaded, setLocalImageModelLoaded] = useState(false);
  const [localImageServerRunning, setLocalImageServerRunning] = useState(false);
  const [localImageErrorLog, setLocalImageErrorLog] = useState<string | null>(null);
  const [localImageStartError, setLocalImageStartError] = useState<string | null>(null);
  const [llamaStatus, setLlamaStatus] = useState<any>(null);
  const [llamaUnloading, setLlamaUnloading] = useState<string | null>(null);
  const [networkLoading, setNetworkLoading] = useState(false);
  const [networkSaving, setNetworkSaving] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  const [networkCopied, setNetworkCopied] = useState(false);
  const [network, setNetwork] = useState<{
    lanAccessEnabled: boolean;
    requireToken: boolean;
    hasToken: boolean;
    apiAuthToken: string;
    envTokenLocked: boolean;
    listenHost: string;
    listenPort: number;
    hostLocked: boolean;
    lanBindActive: boolean;
    lanUrls: string[];
    notes: string[];
  } | null>(null);
  const {
    selectedProvider: selectedImageProvider,
    providers: imageProviders,
    settingsLoaded: imageSettingsLoaded,
    loadSettings: loadImageSettings,
    setSelectedProvider: setSelectedImageProvider,
    updateProvider: updateImageProvider,
  } = useImageStudioStore();

  const loadInstalledSkills = async () => {
    try {
      const res = await fetch("/api/skills/local");
      if (res.ok) {
        const data = await res.json();
        setInstalledSkills(data);
      }
    } catch {}
  };

  const loadBrowseSkills = async () => {
    setLoadingSkills(true);
    setSkillError(null);
    try {
      let url: string;
      if (skillView === "curated") {
        url = "/api/skills/curated";
      } else if (skillSearch.trim()) {
        url = `/api/skills/browse?q=${encodeURIComponent(skillSearch.trim())}`;
      } else {
        url = `/api/skills/browse?view=${skillView}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSkillError(data.error || "Failed to load skills");
        setBrowseSkills([]);
        return;
      }
      const data = await res.json();
      if (skillView === "curated") {
        const all: any[] = [];
        for (const owner of data.data || []) {
          for (const skill of owner.skills || []) {
            all.push({ ...skill, owner: owner.owner });
          }
        }
        setBrowseSkills(all);
      } else {
        setBrowseSkills(data.data || []);
      }
    } catch (e: any) {
      setSkillError(e.message || "Failed to load skills");
      setBrowseSkills([]);
    }
    setLoadingSkills(false);
  };

  const handleInstallSkill = async (skillId: string) => {
    setInstallingSkill(skillId);
    try {
      const response = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillId }),
      });
      if (response.ok) {
        await loadInstalledSkills();
      } else {
        const data = await response.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setInstallingSkill(null);
    }
  };

  const handleInstallUrl = async () => {
    if (!skillUrl.trim()) return;
    setInstallingUrl(true);
    try {
      const response = await fetch("/api/skills/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: skillUrl.trim() }),
      });
      if (response.ok) {
        setSkillUrl("");
        await loadInstalledSkills();
      } else {
        const data = await response.json();
        alert(`Error: ${data.error}`);
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`);
    } finally {
      setInstallingUrl(false);
    }
  };

  const handleUninstallSkill = async (id: string) => {
    try {
      await fetch(`/api/skills/${id}`, { method: "DELETE" });
      await loadInstalledSkills();
    } catch {}
  };

  const loadMemory = async () => {
    setMemoryLoading(true);
    setMemoryStatus(null);
    try {
      const response = await fetch("/api/memory");
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || "Failed to load memory");
      setMemoryContent(String(payload.content || ""));
      setMemoryFilePath(String(payload.filePath || ""));
    } catch (error: any) {
      setMemoryStatus(error.message || "Failed to load memory");
    } finally {
      setMemoryLoading(false);
    }
  };

  const saveMemory = async () => {
    setMemorySaving(true);
    setMemoryStatus(null);
    try {
      const response = await fetch("/api/memory", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: memoryContent }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || "Failed to save memory");
      setMemoryContent(String(payload.content || ""));
      setMemoryFilePath(String(payload.filePath || ""));
      setMemoryStatus("Memory saved.");
    } catch (error: any) {
      setMemoryStatus(error.message || "Failed to save memory");
    } finally {
      setMemorySaving(false);
    }
  };

  React.useEffect(() => {
    if (activeTab === "skills") {
      loadInstalledSkills();
      loadBrowseSkills();
    }
  }, [activeTab]);

  React.useEffect(() => {
    if (activeTab === "skills") {
      loadBrowseSkills();
    }
  }, [skillView]);

  React.useEffect(() => {
    if (activeTab === "memory") {
      loadMemory();
    }
  }, [activeTab]);

  React.useEffect(() => {
    if (settingsOpen && !imageSettingsLoaded) {
      loadImageSettings().catch(console.error);
    }
  }, [imageSettingsLoaded, loadImageSettings, settingsOpen]);

  const fetchLlamaStatus = React.useCallback(async () => {
    try {
      const res = await fetch("/api/local-image-server/llama-status");
      if (res.ok) {
        const data = await res.json();
        if (!data.error) {
          setLlamaStatus(data);
          return;
        }
      }
    } catch {}
    setLlamaStatus(null);
  }, []);

  const unloadLlamaModel = async (modelId: string) => {
    setLlamaUnloading(modelId);
    try {
      await fetch("/api/local-image-server/llama-unload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ modelId }),
      });
      await fetchLlamaStatus();
    } catch (err) {
      console.error("Failed to unload llama model:", err);
    }
    setLlamaUnloading(null);
  };

  React.useEffect(() => {
    if (!settingsOpen) return;

    const checkStatus = () => {
      fetch(`/api/local-image-server/status?port=${encodeURIComponent(localImagePort)}`)
        .then(r => r.json())
        .then(data => {
          setLocalImageAutoRun(!!data.autoRun);
          setLocalImagePort(String(data.port || 8000));
          setLocalImageServerRunning(!!data.serverReachable);
          setLocalImageErrorLog(data.errorLogTail || null);
        })
        .catch(() => {});

      fetch(`http://localhost:${localImagePort}/api/model-status`)
        .then(r => r.json())
        .then(data => {
          setLocalImageModelLoaded(!!data.loaded);
        })
        .catch(() => {});
    };

    checkStatus();
    fetchLlamaStatus();

    const interval = setInterval(() => {
      checkStatus();
      fetchLlamaStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, [settingsOpen, localImagePort, fetchLlamaStatus]);

  const saveLocalImageSettings = async () => {
    setLocalImageSaving(true);
    try {
      await fetch("/api/local-image-server/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          autoRun: localImageAutoRun,
          port: parseInt(localImagePort) || 8000,
        }),
      });
    } catch {}
    setLocalImageSaving(false);
  };

  const refreshLocalImageServerStatus = React.useCallback(async () => {
    const response = await fetch(
      `/api/local-image-server/status?port=${encodeURIComponent(localImagePort)}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to read local image server status");
    }
    setLocalImageAutoRun(!!data.autoRun);
    setLocalImagePort(String(data.port || localImagePort || 8000));
    setLocalImageServerRunning(!!data.serverReachable);
    setLocalImageErrorLog(data.errorLogTail || null);
    return data;
  }, [localImagePort]);

  const waitForLocalImageServer = React.useCallback(async () => {
    let latest: any = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      latest = await refreshLocalImageServerStatus();
      if (latest.serverReachable) return latest;
      if (attempt > 0 && !latest.running && latest.errorLogTail) {
        throw new Error("Local image server exited during startup.");
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return latest;
  }, [refreshLocalImageServerStatus]);

  const loadModelsForImageProvider = React.useCallback(
    async (providerId: string, force = false) => {
      if (!force && imageProviderModels[providerId]?.length) {
        return;
      }

      setImageProviderModelsLoading((current) => ({
        ...current,
        [providerId]: true,
      }));
      setImageProviderModelsError((current) => ({
        ...current,
        [providerId]: null,
      }));

      try {
        const response = await fetch(
          `/api/images/providers/${encodeURIComponent(providerId)}/models`,
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Failed to load models");
        }

        setImageProviderModels((current) => ({
          ...current,
          [providerId]: Array.isArray(payload.models) ? payload.models : [],
        }));
      } catch (error: any) {
        setImageProviderModelsError((current) => ({
          ...current,
          [providerId]: error.message || "Failed to load models",
        }));
      } finally {
        setImageProviderModelsLoading((current) => ({
          ...current,
          [providerId]: false,
        }));
      }
    },
    [imageProviderModels],
  );

  React.useEffect(() => {
    if (activeTab !== "providers" || !imageSettingsLoaded) return;

    imageProviders
      .filter((provider) => provider.enabled)
      .forEach((provider) => {
        if (
          !imageProviderModels[provider.id]?.length &&
          !imageProviderModelsLoading[provider.id]
        ) {
          void loadModelsForImageProvider(provider.id);
        }
      });
  }, [
    activeTab,
    imageProviderModels,
    imageProviderModelsLoading,
    imageProviders,
    imageSettingsLoaded,
    loadModelsForImageProvider,
  ]);

  const handleSurpriseHeroText = () => {
    const randomOption =
      heroTextOptions[Math.floor(Math.random() * heroTextOptions.length)];
    setHeroTitle(randomOption.title);
    setHeroSubtitle(randomOption.subtitle);
  };

  const loadNetworkSettings = React.useCallback(async () => {
    setNetworkLoading(true);
    setNetworkError(null);
    try {
      const res = await fetch("/api/network");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to load network settings");
      }
      const data = await res.json();
      setNetwork(data);
      if (data.apiAuthToken) {
        setApiToken(data.apiAuthToken);
      }
    } catch (err: any) {
      setNetworkError(err.message || "Failed to load network settings");
    } finally {
      setNetworkLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (settingsOpen && activeTab === "general") {
      void loadNetworkSettings();
    }
  }, [settingsOpen, activeTab, loadNetworkSettings]);

  const patchNetwork = async (updates: Record<string, unknown>) => {
    setNetworkSaving(true);
    setNetworkError(null);
    try {
      const res = await fetch("/api/network", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update network settings");
      }
      setNetwork(data);
      if (data.apiAuthToken) {
        setApiToken(data.apiAuthToken);
      }
    } catch (err: any) {
      setNetworkError(err.message || "Failed to update network settings");
      await loadNetworkSettings();
    } finally {
      setNetworkSaving(false);
    }
  };

  const copyNetworkToken = async () => {
    if (!network?.apiAuthToken) return;
    try {
      await navigator.clipboard.writeText(network.apiAuthToken);
      setNetworkCopied(true);
      setTimeout(() => setNetworkCopied(false), 1500);
    } catch {
      setNetworkError("Could not copy token to clipboard");
    }
  };

  const tabs = [
    { id: "general" as SettingsTab, label: "General", icon: Settings },
    { id: "providers" as SettingsTab, label: "Providers", icon: Key },
    { id: "tools" as SettingsTab, label: "Tools", icon: Wrench },
    { id: "memory" as SettingsTab, label: "Memory", icon: Brain },
    { id: "skills" as SettingsTab, label: "Skills", icon: Download },
    ...(isAdmin ? [{ id: "admin" as SettingsTab, label: "Admin", icon: Shield }] : []),
  ];

  return (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-sm w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 hover:bg-secondary rounded-sm transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex border-b border-border">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  data-admin-tab={tab.id==="admin"? "true": undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors",
                    activeTab === tab.id
                      ? "border-accent text-accent"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {activeTab === "general" && (
                <div className="space-y-6">
                  {/* Network / LAN access — top of General so it's easy to find */}
                  <div className="border border-border rounded-sm p-4 space-y-3 bg-secondary/20">
                    <div className="flex items-center gap-2">
                      <Network className="w-4 h-4 text-accent" />
                      <h3 className="text-sm font-medium">Network</h3>
                      {(networkLoading || networkSaving) && (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground ml-auto" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use this app from phones and other computers on your network.
                      Off by default so only this machine can reach the API.
                    </p>

                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!network?.lanAccessEnabled}
                        disabled={!network || networkSaving || networkLoading}
                        onChange={(e) =>
                          void patchNetwork({ lanAccessEnabled: e.target.checked })
                        }
                        className="rounded border-border mt-0.5"
                      />
                      <span className="text-sm">
                        Allow access from other devices on the LAN
                      </span>
                    </label>

                    {network?.lanAccessEnabled && (
                      <>
                        <label className="flex items-start gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!network?.requireToken}
                            disabled={
                              !network ||
                              networkSaving ||
                              network.envTokenLocked
                            }
                            onChange={(e) =>
                              void patchNetwork({ requireToken: e.target.checked })
                            }
                            className="rounded border-border mt-0.5"
                          />
                          <div>
                            <span className="text-sm">Require access token</span>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              Recommended. Other devices enter the token once.
                              Uncheck only on a network you fully trust — anyone on
                              the LAN can then use the API with no secret.
                            </p>
                          </div>
                        </label>

                        {network.requireToken && !network.envTokenLocked && (
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              Access token
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                readOnly
                                value={network.apiAuthToken || (network.hasToken ? "••••••••" : "")}
                                className="flex-1 px-3 py-2 bg-secondary border border-border rounded-sm text-xs font-mono focus:outline-none"
                              />
                              <button
                                type="button"
                                onClick={() => void copyNetworkToken()}
                                disabled={!network.apiAuthToken}
                                className="px-2.5 py-2 border border-border rounded-sm hover:bg-secondary transition-colors disabled:opacity-40"
                                title="Copy token"
                              >
                                {networkCopied ? (
                                  <Check className="w-3.5 h-3.5 text-accent" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={networkSaving}
                                onClick={() =>
                                  void patchNetwork({ regenerateToken: true })
                                }
                                className="px-2.5 py-2 border border-border rounded-sm text-xs hover:bg-secondary transition-colors disabled:opacity-40"
                                title="Generate a new token"
                              >
                                <RefreshCcw className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              On another device, open a LAN URL below and paste this
                              token if prompted.
                            </p>
                          </div>
                        )}

                        {network.envTokenLocked && (
                          <p className="text-[11px] text-amber-500/90">
                            API_AUTH_TOKEN is set in the environment and always
                            required. The Settings token controls below are locked.
                          </p>
                        )}

                        {network.lanUrls?.length > 0 && (
                          <div className="space-y-1.5">
                            <label className="text-xs font-medium text-muted-foreground">
                              Open on other devices
                            </label>
                            <ul className="space-y-1">
                              {network.lanUrls.map((url) => (
                                <li key={url}>
                                  <code className="text-xs font-mono text-foreground bg-secondary px-2 py-1 rounded-sm break-all">
                                    {url}
                                  </code>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}

                    {network && (
                      <p className="text-[11px] text-muted-foreground">
                        Listening on{" "}
                        <code className="font-mono">
                          {network.listenHost}:{network.listenPort}
                        </code>
                        {network.hostLocked ? " (HOST locked by env)" : ""}.
                      </p>
                    )}

                    {network?.notes?.slice(0, 2).map((note) => (
                      <p key={note} className="text-[11px] text-muted-foreground">
                        {note}
                      </p>
                    ))}

                    {networkError && (
                      <p className="text-xs text-destructive">{networkError}</p>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <label className="text-sm font-medium">
                          Hero Title
                        </label>
                        <button
                          type="button"
                          onClick={handleSurpriseHeroText}
                          className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-secondary px-3 py-1 text-xs text-foreground transition-colors hover:border-accent/40 hover:bg-secondary/80"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-accent" />
                          <span>Surprise Me</span>
                        </button>
                      </div>
                      <LocalInput
                        type="text"
                        value={heroTitle}
                        onChange={setHeroTitle}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-sm font-medium">
                        Hero Subtitle
                      </label>
                      <LocalInput
                        type="text"
                        value={heroSubtitle}
                        onChange={setHeroSubtitle}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">System Prompt</label>
                    <LocalTextarea
                      value={systemPrompt}
                      onChange={setSystemPrompt}
                      rows={4}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Temperature</label>
                      <LocalInput
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={temperature}
                        onChange={(val: string) =>
                          setTemperature(parseFloat(val))
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max Tokens</label>
                      <LocalInput
                        type="number"
                        min={0}
                        max={1000000}
                        value={maxTokens}
                        onChange={(val: string) =>
                          setMaxTokens(parseInt(val) || 0)
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Set to 0 for Auto/Model Maximum.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Top P</label>
                    <LocalInput
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={topP}
                      onChange={(val: string) => setTopP(parseFloat(val))}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Reasoning Effort
                    </label>
                    <select
                      value={reasoningEffort}
                      onChange={(e) =>
                        setReasoningEffort(e.target.value as any)
                      }
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {reasoningEffortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {getReasoningEffortHint(selectedProvider)}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={streamResponses}
                        onChange={(e) => setStreamResponses(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Stream responses</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showThinking}
                        onChange={(e) => setShowThinking(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Show thinking/reasoning</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showGenerationInfo}
                        onChange={(e) =>
                          setShowGenerationInfo(e.target.checked)
                        }
                        className="rounded border-border"
                      />
                      <span className="text-sm">Show generation info</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={artifactsEnabled}
                        onChange={(e) => setArtifactsEnabled(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Enable code artifacts</span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Tool Display Mode
                    </label>
                    <select
                      value={toolDisplayMode}
                      onChange={(e) =>
                        setToolDisplayMode(e.target.value as any)
                      }
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="individual">Individual (Default)</option>
                      <option value="grouped">Grouped by Type</option>
                      <option value="timeline">Timeline</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      How tool calls are visualized in the chat history.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "tools" && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Default Search Provider
                    </label>
                    <select
                      value={defaultSearchProvider}
                      onChange={(e) =>
                        setDefaultSearchProvider(e.target.value as any)
                      }
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="searxng">SearxNG</option>
                      <option value="duckduckgo">DuckDuckGo</option>
                      <option value="brave">Brave Search</option>
                      <option value="google">Google PSE</option>
                      <option value="parallel">Parallel Search</option>
                      <option value="exa">Exa</option>
                      <option value="tavily">Tavily</option>
                      <option value="tinyfish">TinyFish</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Search Configuration
                    </label>
                    <div className="space-y-2">
                      <LocalInput
                        type="text"
                        placeholder="http://192.168.1.70:8888"
                        value={searchConfig.searxngUrl || ""}
                        onChange={(val: string) =>
                          setSearchConfig({ ...searchConfig, searxngUrl: val })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Brave API Key"
                        value={searchConfig.braveApiKey || ""}
                        onChange={(val: string) =>
                          setSearchConfig({ ...searchConfig, braveApiKey: val })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Google PSE API Key"
                        value={searchConfig.googleApiKey || ""}
                        onChange={(val: string) =>
                          setSearchConfig({
                            ...searchConfig,
                            googleApiKey: val,
                          })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="text"
                        placeholder="Google PSE CX"
                        value={searchConfig.googleCx || ""}
                        onChange={(val: string) =>
                          setSearchConfig({ ...searchConfig, googleCx: val })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Parallel API Key"
                        value={searchConfig.parallelApiKey || ""}
                        onChange={(val: string) =>
                          setSearchConfig({
                            ...searchConfig,
                            parallelApiKey: val,
                          })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Exa API Key"
                        value={searchConfig.exaApiKey || ""}
                        onChange={(val: string) =>
                          setSearchConfig({ ...searchConfig, exaApiKey: val })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Tavily API Key"
                        value={searchConfig.tavilyApiKey || ""}
                        onChange={(val: string) =>
                          setSearchConfig({
                            ...searchConfig,
                            tavilyApiKey: val,
                          })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="TinyFish API Key"
                        value={searchConfig.tinyfishApiKey || ""}
                        onChange={(val: string) =>
                          setSearchConfig({
                            ...searchConfig,
                            tinyfishApiKey: val,
                          })
                        }
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Tool Turn Limit
                    </label>
                    <LocalInput
                      type="number"
                      min="0"
                      step="1"
                      value={String(maxToolTurns ?? 0)}
                      onChange={(val: string) => {
                        const parsed = Number.parseInt(val, 10);
                        setMaxToolTurns(
                          Number.isFinite(parsed) && parsed > 0 ? parsed : 0,
                        );
                      }}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum consecutive tool-call rounds before stopping. Set
                      to 0 for unlimited.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "memory" && (
                <div className="space-y-5">
                  <div className="rounded-sm border border-border bg-secondary/20 p-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Brain className="h-4 w-4 text-accent" />
                          <h3 className="text-sm font-medium">User Memory</h3>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Memory is stored as markdown and injected into new
                          chat requests when enabled.
                        </p>
                        {memoryFilePath && (
                          <p className="break-all text-[10px] text-muted-foreground">
                            {memoryFilePath}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={memoryEnabled}
                        onClick={() => setMemoryEnabled(!memoryEnabled)}
                        className="flex shrink-0 items-center gap-2 text-sm text-foreground"
                      >
                        <span className="inline-block w-16 shrink-0 text-right">
                          {memoryEnabled ? "Enabled" : "Disabled"}
                        </span>
                        <span
                          className={cn(
                            "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
                            memoryEnabled
                              ? "border-accent bg-accent/80"
                              : "border-border bg-secondary",
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                              memoryEnabled ? "translate-x-5" : "translate-x-1",
                            )}
                          />
                        </span>
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      When disabled, the memory markdown is not added to prompts
                      and the memory tool is hidden from the model. Existing
                      memories are kept on disk.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <label className="text-sm font-medium">
                        Memory markdown
                      </label>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={loadMemory}
                          disabled={memoryLoading || memorySaving}
                          className="inline-flex items-center gap-1.5 border border-border bg-secondary px-3 py-1.5 text-xs text-foreground transition-colors hover:border-accent/40 disabled:opacity-50"
                        >
                          {memoryLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <RefreshCcw className="h-3.5 w-3.5" />
                          )}
                          Reload
                        </button>
                        <button
                          type="button"
                          onClick={saveMemory}
                          disabled={memoryLoading || memorySaving}
                          className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-xs text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          {memorySaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>
                    <textarea
                      value={memoryContent}
                      onChange={(e) => setMemoryContent(e.target.value)}
                      rows={16}
                      spellCheck={false}
                      className="w-full resize-y rounded-sm border border-border bg-background/70 px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none transition-colors focus:border-accent"
                    />
                    {memoryStatus && (
                      <p
                        className={cn(
                          "text-xs",
                          memoryStatus.includes("Failed")
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {memoryStatus}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Keep this file small and durable. Good memories are stable
                      facts like your name, preferences, hobbies, long-term
                      projects, and current life context.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === "skills" && (
                <div className="space-y-6">
                  {/* Browse skills.sh */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">
                        Browse skills.sh
                      </label>
                      <div className="flex gap-1 bg-secondary rounded-sm p-0.5">
                        {(["trending", "all-time", "curated"] as const).map(
                          (v) => (
                            <button
                              key={v}
                              onClick={() => setSkillView(v)}
                              className={cn(
                                "px-2.5 py-1 text-xs rounded-sm transition-colors capitalize",
                                skillView === v
                                  ? "bg-card text-foreground"
                                  : "text-muted-foreground hover:text-foreground",
                              )}
                            >
                              {v}
                            </button>
                          ),
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Search skills..."
                        value={skillSearch}
                        onChange={(e) => setSkillSearch(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && loadBrowseSkills()
                        }
                        className="flex-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        onClick={loadBrowseSkills}
                        disabled={loadingSkills}
                        className="px-4 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {loadingSkills ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Search"
                        )}
                      </button>
                    </div>

                    {skillError && (
                      <div className="bg-destructive/10 text-destructive text-xs p-3 rounded-sm border border-destructive/20">
                        {skillError}
                      </div>
                    )}
                    <div className="max-h-[300px] overflow-y-auto space-y-1 border border-border rounded-sm">
                      {browseSkills.length === 0 &&
                        !loadingSkills &&
                        !skillError && (
                          <p className="text-xs text-muted-foreground p-4 text-center">
                            No skills found
                          </p>
                        )}
                      {browseSkills
                        .filter((s: any) => !s.isDuplicate)
                        .map((skill: any) => {
                          const isInstalled = installedSkills.some(
                            (is: any) => is.source === skill.id,
                          );
                          return (
                            <div
                              key={skill.id}
                              className="flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-medium truncate">
                                    {skill.name}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-sm">
                                    {skill.installs?.toLocaleString()} installs
                                  </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground truncate block">
                                  {skill.id}
                                </span>
                              </div>
                              <button
                                onClick={() => handleInstallSkill(skill.id)}
                                disabled={
                                  installingSkill === skill.id || isInstalled
                                }
                                className={cn(
                                  "flex-shrink-0 px-3 py-1.5 rounded-sm text-xs transition-colors",
                                  isInstalled
                                    ? "bg-secondary/50 text-muted-foreground cursor-default"
                                    : installingSkill === skill.id
                                      ? "bg-accent/50 text-accent-foreground/50"
                                      : "bg-accent text-accent-foreground hover:bg-accent/90",
                                )}
                              >
                                {installingSkill === skill.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : isInstalled ? (
                                  "Installed"
                                ) : (
                                  "Install"
                                )}
                              </button>
                            </div>
                          );
                        })}
                    </div>
                  </div>

                  {/* Install from URL */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Install from URL
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="https://github.com/owner/repo or tarball URL"
                        value={skillUrl}
                        onChange={(e) => setSkillUrl(e.target.value)}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleInstallUrl()
                        }
                        className="flex-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        onClick={handleInstallUrl}
                        disabled={installingUrl || !skillUrl.trim()}
                        className="px-4 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {installingUrl ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          "Install"
                        )}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter a GitHub repo URL or direct tarball link. Works like{" "}
                      <code className="bg-secondary px-1 rounded-sm">
                        npx skills add {"<url>"}
                      </code>
                      .
                    </p>
                  </div>

                  {/* Installed skills */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">
                      Installed Skills
                    </label>
                    {installedSkills.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No skills installed
                      </p>
                    ) : (
                      <div className="space-y-1 border border-border rounded-sm divide-y divide-border">
                        {installedSkills.map((skill: any) => (
                          <div
                            key={skill.id}
                            className="flex items-center justify-between px-3 py-2"
                          >
                            <div className="min-w-0">
                              <span className="text-sm font-medium">
                                {skill.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground ml-2">
                                {skill.source}
                              </span>
                            </div>
                            <button
                              onClick={() => handleUninstallSkill(skill.id)}
                              className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === "admin" && (
                <div className="space-y-4">
                  <AdminPanel />
                </div>
              )}
              {activeTab === "providers" && (
                <div className="space-y-4">
                  {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No providers configured. Add them from the Model Selector.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {providers.map((provider) => (
                        <div
                          key={provider.id}
                          className="border border-border rounded-sm p-4 space-y-3 relative bg-secondary/20"
                        >
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium">
                              {provider.name} ({provider.type})
                            </h3>
                            <button
                              onClick={() => removeProvider(provider.id)}
                              className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              Base URL
                            </label>
                            <LocalInput
                              type="text"
                              value={provider.baseUrl || ""}
                              onChange={(val: string) =>
                                updateProvider(provider.id, { baseUrl: val })
                              }
                              placeholder="Default"
                              className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              API Key
                            </label>
                            <LocalInput
                              type="password"
                              value={provider.apiKey || ""}
                              onChange={(val: string) =>
                                updateProvider(provider.id, { apiKey: val })
                              }
                              placeholder={
                                provider.hasApiKey
                                  ? "Configured (enter new key to replace)"
                                  : "Optional"
                              }
                              className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>

                          {provider.type === "openai-compatible" && (
                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                Custom Headers (JSON)
                              </label>
                              <LocalTextarea
                                value={(() => {
                                  try {
                                    return JSON.stringify(provider.config?.headers || {}, null, 2)
                                  } catch {
                                    return "{}"
                                  }
                                })()}
                                onChange={(val: string) => {
                                  try {
                                    const headers = JSON.parse(val)
                                    updateProvider(provider.id, {
                                      config: { ...(provider.config || {}), headers },
                                    })
                                  } catch {
                                    // Allow editing even with invalid JSON
                                  }
                                }}
                                placeholder='{"X-Api-Key": "your-key", "X-Custom-Header": "value"}'
                                rows={4}
                                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono break-all"
                              />
                            </div>
                          )}

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">
                              Models (comma-separated)
                            </label>
                            <LocalTextarea
                              value={provider.models.join(", ")}
                              onChange={(val: string) =>
                                updateProvider(provider.id, {
                                  models: val
                                    .split(",")
                                    .map((m) => m.trim())
                                    .filter(Boolean),
                                })
                              }
                              placeholder="Model names"
                              rows={3}
                              className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono break-all"
                            />
                            <button
                              onClick={async () => {
                                try {
                                  const res = await fetch(`/api/providers/${encodeURIComponent(provider.id)}/models`)
                                  const models = await res.json()
                                  if (Array.isArray(models) && models.length) {
                                    updateProvider(provider.id, { models })
                                    // Also save to backend
                                    await fetch(`/api/providers/${encodeURIComponent(provider.id)}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ ...provider, models }),
                                    })
                                  }
                                } catch (e) {
                                  console.error("Failed to fetch models", e)
                                }
                              }}
                              className="text-xs text-accent hover:text-accent-hover transition-colors"
                            >
                              ↻ Fetch models from API
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="border-t border-border pt-4">
                    <div className="mb-4 flex items-center gap-2">
                      <ImageIcon className="h-4 w-4 text-accent" />
                      <div>
                        <h3 className="text-sm font-medium text-foreground">
                          Image Providers
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          The user chooses the active image backend here and in
                          the studio. The model tool follows this selection.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4">
                      {imageProviders.map((provider) => (
                        <div
                          key={provider.id}
                          className="border border-border rounded-sm p-4 space-y-3 bg-secondary/10"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-medium text-foreground">
                                  {provider.name}
                                </h4>
                                {selectedImageProvider === provider.id && (
                                  <span className="rounded-sm bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-foreground">
                                    Active
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {provider.id}
                              </p>
                            </div>

                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                <input
                                  type="checkbox"
                                  checked={provider.enabled}
                                  onChange={(event) =>
                                    updateImageProvider(provider.id, {
                                      enabled: event.target.checked,
                                    }).catch(console.error)
                                  }
                                  className="rounded border-border"
                                />
                                Enabled
                              </label>
                              <button
                                onClick={() =>
                                  setSelectedImageProvider(provider.id).catch(
                                    console.error,
                                  )
                                }
                                disabled={!provider.enabled}
                                className={cn(
                                  "px-3 py-1.5 text-xs transition-colors",
                                  selectedImageProvider === provider.id
                                    ? "bg-accent text-accent-foreground"
                                    : "border border-border bg-secondary text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                                )}
                              >
                                Use This Provider
                              </button>
                            </div>
                          </div>

                          <div className="grid gap-3 md:grid-cols-2">
                            <div className="space-y-2 md:col-span-2">
                              <div className="flex items-center justify-between gap-3">
                                <label className="text-xs font-medium text-muted-foreground">
                                  Model
                                </label>
                                <button
                                  onClick={() =>
                                    loadModelsForImageProvider(
                                      provider.id,
                                      true,
                                    ).catch(console.error)
                                  }
                                  className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                                >
                                  {imageProviderModelsLoading[provider.id] ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <RefreshCcw className="h-3 w-3" />
                                  )}
                                  Refresh models
                                </button>
                              </div>

                              {imageProviderModels[provider.id]?.length ? (
                                <ModelSearchSelect
                                  value={provider.model}
                                  options={imageProviderModels[provider.id]}
                                  onChange={(val) =>
                                    updateImageProvider(provider.id, {
                                      model: val,
                                    }).catch(console.error)
                                  }
                                  placeholder="Type to search models..."
                                />
                              ) : (
                                <LocalInput
                                  type="text"
                                  value={provider.model}
                                  onChange={(val: string) =>
                                    updateImageProvider(provider.id, {
                                      model: val,
                                    }).catch(console.error)
                                  }
                                  placeholder="Model id"
                                  className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                                />
                              )}

                              {imageProviderModelsError[provider.id] && (
                                <p className="text-xs text-destructive">
                                  {imageProviderModelsError[provider.id]}
                                </p>
                              )}
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                Base URL
                              </label>
                              <LocalInput
                                type="text"
                                value={provider.baseUrl}
                                onChange={(val: string) =>
                                  updateImageProvider(provider.id, {
                                    baseUrl: val,
                                  }).catch(console.error)
                                }
                                placeholder="Provider endpoint"
                                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>

                            <div className="space-y-2">
                              <label className="text-xs font-medium text-muted-foreground">
                                API Key
                              </label>
                              <LocalInput
                                type="password"
                                value={provider.apiKey}
                                onChange={(val: string) =>
                                  updateImageProvider(provider.id, {
                                    apiKey: val,
                                  }).catch(console.error)
                                }
                                placeholder={
                                  provider.hasApiKey
                                    ? "Configured (enter new key to replace)"
                                    : "API Key"
                                }
                                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="border-t border-border pt-4">
                    <div className="mb-4 flex items-center gap-2">
                      <Settings className="h-4 w-4 text-accent" />
                      <div>
                        <h3 className="text-sm font-medium text-foreground">
                          Local Image Server
                        </h3>
                        <p className="text-xs text-muted-foreground">
                          FLUX.2-klein-4B — bundled server settings.
                        </p>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-medium">Auto-start on boot</p>
                          <p className="text-xs text-muted-foreground">
                            Launch the local image server automatically when this app starts.
                          </p>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={localImageAutoRun}
                          onClick={() => setLocalImageAutoRun(!localImageAutoRun)}
                          className="flex shrink-0 items-center gap-2 text-sm text-foreground"
                        >
                          <span
                            className={cn(
                              "relative inline-flex h-6 w-11 items-center rounded-full border transition-colors",
                              localImageAutoRun
                                ? "border-accent bg-accent/80"
                                : "border-border bg-secondary",
                            )}
                          >
                            <span
                              className={cn(
                                "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
                                localImageAutoRun ? "translate-x-5" : "translate-x-1",
                              )}
                            />
                          </span>
                        </button>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium">Port</label>
                        <input
                          type="number"
                          min={1}
                          max={65535}
                          value={localImagePort}
                          onChange={(e) => setLocalImagePort(e.target.value)}
                          className="w-full border border-border bg-secondary px-3 py-2 text-sm outline-none focus:border-accent"
                        />
                        <p className="text-xs text-muted-foreground">
                          Pick an unused port if something is already on 8000.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={saveLocalImageSettings}
                        disabled={localImageSaving}
                        className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50"
                      >
                        {localImageSaving && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        Save
                      </button>
                      <div className="flex gap-2 mt-3">
                        <button
                          type="button"
                          onClick={async () => {
                            setLocalImageStarting(true);
                            setLocalImageStartError(null);
                            setLocalImageErrorLog(null);
                            try {
                              const response = await fetch("/api/local-image-server/start", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ port: parseInt(localImagePort) || 8000, fastMode: true }),
                              });
                              const payload = await response.json().catch(() => ({}));
                              if (!response.ok) {
                                setLocalImageErrorLog(payload?.errorLogTail || null);
                                throw new Error(
                                  payload?.error ||
                                    payload?.message ||
                                    "Failed to start local image server",
                                );
                              }
                              const status = await waitForLocalImageServer();
                              if (!status?.serverReachable) {
                                setLocalImageStartError(
                                  status?.running
                                    ? "Local image server is still starting. Refresh status in a moment."
                                    : "Local image server did not become reachable.",
                                );
                              }
                            } catch (err: any) {
                              setLocalImageServerRunning(false);
                              setLocalImageStartError(
                                err?.message || "Failed to start local image server",
                              );
                            }
                            setLocalImageStarting(false);
                          }}
                          disabled={localImageStarting || localImageServerRunning}
                          className="inline-flex items-center gap-1.5 bg-accent px-3 py-1.5 text-xs text-accent-foreground disabled:opacity-50"
                        >
                          {localImageStarting ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                          )}
                          {localImageServerRunning ? "Running" : "Start Server"}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await fetch("/api/local-image-server/stop", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ port: parseInt(localImagePort) || 8000 }),
                              });
                              setLocalImageServerRunning(false);
                              setLocalImageModelLoaded(false);
                              setLocalImageStartError(null);
                            } catch {}
                          }}
                          disabled={!localImageServerRunning}
                          className="inline-flex items-center gap-1.5 bg-destructive/10 border border-destructive/30 text-destructive hover:bg-destructive/20 px-3 py-1.5 text-xs disabled:opacity-50"
                        >
                          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                          Stop Server
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            setLocalImageModelLoading(true);
                            try {
                              if (localImageModelLoaded) {
                                const formData = new FormData();
                                formData.append("model_variant", "");
                                await fetch(`http://localhost:${localImagePort}/api/load-model`, {
                                  method: "POST",
                                  body: formData,
                                });
                                setLocalImageModelLoaded(false);
                              } else {
                                const formData = new FormData();
                                formData.append("model_variant", "gguf-q4-k-m");
                                await fetch(`http://localhost:${localImagePort}/api/load-model`, {
                                  method: "POST",
                                  body: formData,
                                });
                                for (let i = 0; i < 30; i++) {
                                  await new Promise(r => setTimeout(r, 2000));
                                  try {
                                    const status = await fetch(`http://localhost:${localImagePort}/api/model-status`).then(r => r.json());
                                    if (status.loaded) { setLocalImageModelLoaded(true); break; }
                                  } catch {}
                                }
                              }
                            } catch {}
                            setLocalImageModelLoading(false);
                          }}
                          disabled={localImageModelLoading || !localImageServerRunning}
                          className="inline-flex items-center gap-1.5 bg-secondary px-3 py-1.5 text-xs text-foreground hover:bg-secondary/80 disabled:opacity-50"
                        >
                          {localImageModelLoading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : localImageModelLoaded ? (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          ) : (
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                          )}
                          {localImageModelLoaded ? "Unload Model" : "Load Model"}
                        </button>
                      </div>

                      {localImageStartError && !localImageServerRunning && (
                        <p className="mt-2 text-xs text-destructive">
                          {localImageStartError}
                        </p>
                      )}

                      {/* VRAM Monitoring & Unloading UI */}
                      {llamaStatus && llamaStatus.gpus && llamaStatus.gpus.length > 0 && (
                        <div className="mt-4 p-3 bg-secondary/30 border border-border rounded-sm space-y-3">
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                            <svg className="h-3.5 w-3.5 text-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                            </svg>
                            <span>Local GPU & VRAM Status</span>
                          </div>
                          
                          {llamaStatus.gpus.map((gpu: any, idx: number) => {
                            const usedGb = Math.round((gpu.used_mib / 1024) * 100) / 100;
                            const totalGb = Math.round((gpu.total_mib / 1024) * 100) / 100;
                            const pct = Math.round((gpu.used_mib / gpu.total_mib) * 100);
                            return (
                              <div key={idx} className="space-y-1.5 text-xs">
                                <div className="flex justify-between text-muted-foreground">
                                  <span>{gpu.name || `GPU ${gpu.index}`}</span>
                                  <span className="font-mono">{usedGb}GB / {totalGb}GB ({pct}%)</span>
                                </div>
                                <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
                                  <div 
                                    className={cn(
                                      "h-full rounded-full transition-all duration-500",
                                      pct > 85 ? "bg-destructive" : pct > 60 ? "bg-yellow-500" : "bg-accent"
                                    )} 
                                    style={{ width: `${pct}%` }} 
                                  />
                                </div>
                              </div>
                            );
                          })}

                          {/* Loaded models */}
                          {llamaStatus.loaded_models && llamaStatus.loaded_models.length > 0 ? (
                            <div className="space-y-2 pt-2 border-t border-border/50">
                              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Active LLM Models (in VRAM)</p>
                              {llamaStatus.loaded_models.map((model: any) => (
                                <div key={model.id} className="flex items-center justify-between gap-3 bg-secondary/50 p-2 rounded-sm text-xs">
                                  <span className="font-mono truncate text-foreground/90">{model.id}</span>
                                  <button
                                    type="button"
                                    onClick={() => unloadLlamaModel(model.id)}
                                    disabled={llamaUnloading === model.id}
                                    className="shrink-0 bg-destructive/15 border border-destructive/30 hover:bg-destructive/25 text-destructive px-2 py-0.5 text-[10px] rounded-sm disabled:opacity-50"
                                  >
                                    {llamaUnloading === model.id ? "Unloading..." : "Unload"}
                                  </button>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-[11px] text-muted-foreground pt-1.5 border-t border-border/50">No active LLM model loaded in GPU memory.</p>
                          )}
                        </div>
                      )}

                      {/* Log output / Error details */}
                      {localImageErrorLog && !localImageServerRunning && (
                        <div className="mt-4 p-3 bg-destructive/5 border border-destructive/20 rounded-sm space-y-2">
                          <p className="text-xs font-semibold text-destructive flex items-center gap-1">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            Startup Failed Details:
                          </p>
                          <pre className="text-[10px] font-mono whitespace-pre-wrap break-all bg-black/10 p-2 rounded-sm max-h-36 overflow-y-auto text-muted-foreground/90 leading-relaxed border border-border/40">
                            {localImageErrorLog}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
