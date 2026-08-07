import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
import { SidebarToggle } from "./components/SidebarToggle";
import { ChatWindow } from "./components/ChatWindow";
import { MessageInput } from "./components/MessageInput";
import { ArtifactPanel } from "./components/ArtifactPanel";
import { ActivityPanel } from "./components/ActivityPanel";
import { SettingsModal } from "./components/SettingsModal";
import { ToolsModal } from "./components/ToolsModal";
import { ModelSelector } from "./components/ModelSelector";
import { ImageStudio } from "./components/ImageStudio";
import { FilesView } from "./components/FilesView";
import { SetupWizard } from "./components/SetupWizard";
import { useChatStore } from "./stores/chatStore";
import { useSettingsStore } from "./stores/settingsStore";
import { getViewFromPathname, useUIStore } from "./stores/uiStore";
import { cn } from "./lib/utils";
import { isNewTabMode } from "./lib/utils";
import { AuthGate } from "./components/AuthGate";

function ThemeSync() {
  const { theme } = useSettingsStore();

  useEffect(() => {
    const root = document.documentElement;
    const allThemes = [
      "dark",
      "light",
      "midnight",
      "emerald",
      "rose",
      "violet",
      "sunset",
    ];
    root.classList.remove(...allThemes);

    if (theme === "system") {
      const prefersDark = window.matchMedia(
        "(prefers-color-scheme: dark)",
      ).matches;
      root.classList.add(prefersDark ? "dark" : "light");
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  return null;
}

function ModelSync() {
  const {
    selectedModel,
    selectedProvider,
    sharedSettingsLoaded,
    setProviders,
    setSelectedModelAndProvider,
  } = useSettingsStore();

  useEffect(() => {
    let cancelled = false;

    async function loadProvidersAndModels() {
      try {
        const res = await fetch("/api/providers", { credentials: "include" });
        if (!res.ok) return;
        const backendProviders = await res.json();
        if (cancelled) return;

        setProviders(backendProviders);

        // Fetch models for each provider
        const updatedProviders = [...backendProviders];
        for (let i = 0; i < updatedProviders.length; i++) {
          const p = updatedProviders[i];
          try {
            const modelRes = await fetch(
              `/api/providers/${encodeURIComponent(p.id)}/models`,
              { credentials: "include" }
            );
            if (modelRes.ok) {
              const models = await modelRes.json();
              if (Array.isArray(models) && models.length > 0) {
                updatedProviders[i] = { ...p, models };
              }
            }
          } catch {
            // ignore individual model fetch failures
          }
        }

        if (cancelled) return;
        setProviders(updatedProviders);

        // Auto-select first model if none selected
        if (sharedSettingsLoaded && (!selectedProvider || !selectedModel)) {
          const firstWithModels = updatedProviders.find(
            (p: any) => p.enabled && p.models && p.models.length > 0,
          );
          if (firstWithModels) {
            setSelectedModelAndProvider(
              firstWithModels.models[0],
              firstWithModels.id,
            );
          }
        }
      } catch (err) {
        console.error("[app] Failed to load providers:", err);
      }
    }

    loadProvidersAndModels();
    return () => {
      cancelled = true;
    };
  }, [
    selectedModel,
    selectedProvider,
    sharedSettingsLoaded,
    setProviders,
    setSelectedModelAndProvider,
  ]);

  return null;
}

function SharedSettingsSync() {
  const {
    hydrateSharedSettings,
    markSharedSettingsLoaded,
    markToolsLoaded,
    setTools,
  } = useSettingsStore();

  useEffect(() => {
    let cancelled = false;

    const loadSharedState = async () => {
      try {
        const [settingsRes, toolsRes] = await Promise.all([
          fetch("/api/settings", { credentials: "include" }),
          fetch("/api/tools", { credentials: "include" }),
        ]);

        if (cancelled) return;

        if (settingsRes.ok) {
          const payload = await settingsRes.json();
          if (!cancelled) {
            hydrateSharedSettings(payload.settings || {});
          }
        } else {
          markSharedSettingsLoaded();
        }

        if (toolsRes.ok) {
          const backendTools = await toolsRes.json();
          if (!cancelled && Array.isArray(backendTools)) {
            setTools(
              backendTools.map((tool: any) => ({
                id: tool.name,
                name: tool.name,
                enabled: tool.enabled !== false,
                config: tool.config || {},
              })),
            );
          }
        } else if (!cancelled) {
          markToolsLoaded();
        }
      } catch (err) {
        console.error("[app] Failed to sync shared settings:", err);
        if (!cancelled) {
          markSharedSettingsLoaded();
          markToolsLoaded();
        }
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        loadSharedState();
      }
    };

    loadSharedState();
    window.addEventListener("focus", loadSharedState);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", loadSharedState);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [
    hydrateSharedSettings,
    markSharedSettingsLoaded,
    markToolsLoaded,
    setTools,
  ]);

  return null;
}

function ArtifactStreamSync() {
  const { currentSessionId, streaming } = useChatStore();
  const { artifactPanelOpen, setArtifactPanelOpen } = useUIStore();
  
  const currentStreamingArtifactIdRef = useRef<string | null>(null);
  const closedArtifactIdRef = useRef<string | null>(null);
  const lastPanelOpenRef = useRef(false);

  const activeStream = currentSessionId ? streaming[currentSessionId] : null;
  const streamingContent = activeStream?.content || '';
  const isGenerating = activeStream?.isGenerating || false;

  // 1. Monitor stream and parse current/last code block
  useEffect(() => {
    if (!isGenerating) {
      closedArtifactIdRef.current = null;
      currentStreamingArtifactIdRef.current = null;
      return;
    }

    const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)(?:```|$)/g;
    let match;
    let lastBlock = null;

    while ((match = regex.exec(streamingContent)) !== null) {
      lastBlock = {
        language: match[1],
        content: match[2],
        startIndex: match.index,
        isClosed: match[0].endsWith('```') && match[0].length > match[1].length + 4,
      };
    }

    if (lastBlock) {
      const { language, content, startIndex } = lastBlock;
      const langLower = language.toLowerCase();
      
      const isPreviewable = ['html', 'svg', 'markdown'].includes(langLower) ||
        content.includes('<!DOCTYPE html>') ||
        content.includes('<html');

      if (isPreviewable) {
        const artifactId = `${currentSessionId}-artifact-${startIndex}`;
        const resolvedType = langLower === 'svg' ? 'svg' : langLower === 'markdown' ? 'markdown' : langLower === 'mermaid' ? 'code' : 'html';
        
        const artifact = {
          id: artifactId,
          type: resolvedType as any,
          title: `Artifact ${language || 'code'}`,
          language: language || undefined,
          content: content.replace(/\n$/, ''),
          timestamp: Date.now(),
        };

        const { activeArtifact, setActiveArtifact } = useUIStore.getState();

        // Update active artifact if it changed
        if (!activeArtifact || activeArtifact.id !== artifactId || activeArtifact.content !== artifact.content) {
          setActiveArtifact(artifact);
        }

        currentStreamingArtifactIdRef.current = artifactId;
      }
    }
  }, [streamingContent, isGenerating, currentSessionId]);

  // 2. Track open/close state to prevent auto-reopening if closed manually
  useEffect(() => {
    if (lastPanelOpenRef.current && !artifactPanelOpen && isGenerating) {
      closedArtifactIdRef.current = currentStreamingArtifactIdRef.current;
    }
    lastPanelOpenRef.current = artifactPanelOpen;
  }, [artifactPanelOpen, isGenerating]);

  // 3. Auto-open panel when a streaming artifact starts
  useEffect(() => {
    if (!isGenerating) return;
    // On mobile, don't auto-takeover the screen - let user open manually
    if (typeof window !== 'undefined' && window.innerWidth < 768) return;

    const currentId = currentStreamingArtifactIdRef.current;
    if (currentId && currentId !== closedArtifactIdRef.current) {
      if (!artifactPanelOpen) {
        setArtifactPanelOpen(true);
      }
    }
  }, [streamingContent, isGenerating, artifactPanelOpen, setArtifactPanelOpen]);

  return null;
}

function App() {
  const {
    sessions,
    currentSessionId,
    createSession,
    setCurrentSession,
    streaming,
    loadSessions,
  } = useChatStore();
  const { setCurrentView } = useUIStore();
  const location = useLocation();
  const currentView = getViewFromPathname(location.pathname);

  useEffect(() => {
    setCurrentView(currentView);
  }, [currentView, setCurrentView]);

  const isNewTab = isNewTabMode;

  useEffect(() => {
    loadSessions().then(() => {
      const { sessions, currentSessionId, pendingSessions } = useChatStore.getState();
      if (isNewTab) {
        // Check if there's already an empty pending session we can reuse
        const emptyPending = sessions.find(s => pendingSessions[s.id] && s.messages.length === 0);
        if (emptyPending) {
          setCurrentSession(emptyPending.id);
        } else {
          createSession(undefined, undefined, undefined, { persist: false });
        }
      } else if (sessions.length === 0 && !currentSessionId) {
        createSession().then((id) => setCurrentSession(id));
      } else if (!currentSessionId && sessions.length > 0) {
        setCurrentSession(sessions[0].id);
      }
    });
  }, [loadSessions, createSession, setCurrentSession]);

  useEffect(() => {
    if (currentSessionId) {
      const { selectedModel, selectedProvider, setSelectedModelAndProvider } = useSettingsStore.getState();
      const session = sessions.find((s) => s.id === currentSessionId);
      if (session && session.model && session.provider) {
        if (session.model !== selectedModel || session.provider !== selectedProvider) {
          setSelectedModelAndProvider(session.model, session.provider);
        }
      }
    }
  }, [currentSessionId, sessions]);

  const currentSession = sessions.find((s) => s.id === currentSessionId);
  const isCurrentGenerating = currentSessionId
    ? (streaming[currentSessionId]?.isGenerating ?? false)
    : false;
  const isEmpty =
    !currentSession ||
    (currentSession.messages.length === 0 && !isCurrentGenerating);

  return (
    <AuthGate>
      <ThemeSync />
      <SharedSettingsSync />
      <ModelSync />
      <ArtifactStreamSync />
      <div className="fixed inset-0 flex overflow-hidden bg-background text-foreground">
        <Sidebar />
        <SidebarToggle />

        <main
          className={cn(
            "flex-1 flex flex-col min-w-0 relative",
            currentView === "chat" ? "overflow-hidden" : "overflow-y-auto",
            currentView === "chat" && isEmpty ? "justify-center pb-[10vh]" : "",
          )}
        >
          {currentView === "chat" ? (
            <>
              <ChatWindow />
              <MessageInput isLanding={isEmpty} />
            </>
          ) : currentView === "files" ? (
            <FilesView />
          ) : (
            <ImageStudio />
          )}
        </main>

        {currentView === "chat" && (
          <>
            <ActivityPanel />
            <ArtifactPanel />
          </>
        )}
        <SettingsModal />
        <ToolsModal />
        <ModelSelector />
        <SetupWizard />
      </div>
    </AuthGate>
  );
}

export default App;
