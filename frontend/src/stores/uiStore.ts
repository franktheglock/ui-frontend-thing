import { create } from 'zustand'

export interface Artifact {
  id: string
  type: 'code' | 'html' | 'svg' | 'markdown' | 'text'
  title: string
  language?: string
  content: string
  timestamp: number
}

interface UIState {
  activeArtifact: Artifact | null
  artifactPanelOpen: boolean
  settingsOpen: boolean
  modelSelectorOpen: boolean
  toolSelectorOpen: boolean
  searchQuery: string
  searchHighlight: string | null
  highlightMessageId: string | null

  setActiveArtifact: (artifact: Artifact | null) => void
  setArtifactPanelOpen: (open: boolean) => void
  toggleArtifactPanel: () => void
  setSettingsOpen: (open: boolean) => void
  setModelSelectorOpen: (open: boolean) => void
  setToolSelectorOpen: (open: boolean) => void
  setSearchQuery: (query: string) => void
  setSearchHighlight: (query: string | null, messageId?: string | null) => void
}

export const useUIStore = create<UIState>()((set) => ({
  activeArtifact: null,
  artifactPanelOpen: false,
  settingsOpen: false,
  modelSelectorOpen: false,
  toolSelectorOpen: false,
  searchQuery: '',
  searchHighlight: null,
  highlightMessageId: null,

  setActiveArtifact: (artifact) => set({ activeArtifact: artifact }),
  setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),
  toggleArtifactPanel: () => set(state => ({ artifactPanelOpen: !state.artifactPanelOpen })),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setModelSelectorOpen: (open) => set({ modelSelectorOpen: open }),
  setToolSelectorOpen: (open) => set({ toolSelectorOpen: open }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchHighlight: (query, messageId) => set({ searchHighlight: query, highlightMessageId: messageId ?? null }),
}))
