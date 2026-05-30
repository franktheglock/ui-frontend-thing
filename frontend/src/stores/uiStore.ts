import { create } from 'zustand'

export type UIView = 'chat' | 'image-studio' | 'files'

export function getViewFromPathname(pathname: string): UIView {
  if (pathname === '/image-studio' || pathname.startsWith('/image-studio/')) return 'image-studio'
  if (pathname === '/files' || pathname.startsWith('/files/')) return 'files'
  return 'chat'
}

export function getPathnameForView(view: UIView): string {
  if (view === 'image-studio') return '/image-studio'
  if (view === 'files') return '/files'
  return '/'
}

export interface Artifact {
  id: string
  type: 'code' | 'html' | 'svg' | 'markdown' | 'text'
  title: string
  language?: string
  content: string
  timestamp: number
}

interface UIState {
  currentView: UIView
  activeArtifact: Artifact | null
  artifactPanelOpen: boolean
  activeActivityMessageId: string | null
  activityPanelOpen: boolean
  settingsOpen: boolean
  modelSelectorOpen: boolean
  toolSelectorOpen: boolean
  searchQuery: string
  searchHighlight: string | null
  highlightMessageId: string | null

  setActiveArtifact: (artifact: Artifact | null) => void
  setArtifactPanelOpen: (open: boolean) => void
  toggleArtifactPanel: () => void
  setActiveActivityMessageId: (id: string | null) => void
  setActivityPanelOpen: (open: boolean) => void
  toggleActivityPanel: () => void
  setCurrentView: (view: UIView) => void
  setSettingsOpen: (open: boolean) => void
  setModelSelectorOpen: (open: boolean) => void
  setToolSelectorOpen: (open: boolean) => void
  setSearchQuery: (query: string) => void
  setSearchHighlight: (query: string | null, messageId?: string | null) => void
}

export const useUIStore = create<UIState>()((set) => ({
  currentView: 'chat',
  activeArtifact: null,
  artifactPanelOpen: false,
  activeActivityMessageId: null,
  activityPanelOpen: false,
  settingsOpen: false,
  modelSelectorOpen: false,
  toolSelectorOpen: false,
  searchQuery: '',
  searchHighlight: null,
  highlightMessageId: null,

  setActiveArtifact: (artifact) => set({ activeArtifact: artifact }),
  setArtifactPanelOpen: (open) => set({ artifactPanelOpen: open }),
  toggleArtifactPanel: () => set(state => ({ artifactPanelOpen: !state.artifactPanelOpen })),
  setActiveActivityMessageId: (id) => set({ activeActivityMessageId: id }),
  setActivityPanelOpen: (open) => set({ activityPanelOpen: open }),
  toggleActivityPanel: () => set(state => ({ activityPanelOpen: !state.activityPanelOpen })),
  setCurrentView: (view) => set({ currentView: view }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setModelSelectorOpen: (open) => set({ modelSelectorOpen: open }),
  setToolSelectorOpen: (open) => set({ toolSelectorOpen: open }),
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSearchHighlight: (query, messageId) => set({ searchHighlight: query, highlightMessageId: messageId ?? null }),
}))
