import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ProviderConfig {
  id: string
  name: string
  type: 'openai' | 'anthropic' | 'ollama' | 'gemini' | 'openrouter' | 'lmstudio' | 'nvidia' | 'openai-compatible' | 'custom'
  baseUrl?: string
  apiKey?: string
  models: string[]
  enabled: boolean
}

export interface ToolConfig {
  id: string
  name: string
  enabled: boolean
  config: Record<string, string>
}

export interface SettingsState {
  theme: 'dark' | 'light' | 'system' | 'midnight' | 'emerald' | 'rose' | 'violet' | 'sunset'
  sidebarOpen: boolean
  selectedModel: string
  selectedProvider: string
  systemPrompt: string
  providers: ProviderConfig[]
  tools: ToolConfig[]
  maxTokens: number
  temperature: number
  topP: number
  streamResponses: boolean
  showThinking: boolean
  showGenerationInfo: boolean
  defaultSearchProvider: 'searxng' | 'duckduckgo' | 'brave' | 'google'
  searchConfig: Record<string, string>
  artifactsEnabled: boolean
  skillsDirectory: string
  skillsShApiKey: string

  setTheme: (theme: 'dark' | 'light' | 'system' | 'midnight' | 'emerald' | 'rose' | 'violet' | 'sunset') => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSelectedModel: (model: string) => void
  setSelectedProvider: (provider: string) => void
  setSystemPrompt: (prompt: string) => void
  setProviders: (providers: ProviderConfig[]) => void
  addProvider: (provider: ProviderConfig) => void
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void
  removeProvider: (id: string) => void
  addTool: (tool: ToolConfig) => void
  updateTool: (id: string, updates: Partial<ToolConfig>) => void
  removeTool: (id: string) => void
  setMaxTokens: (tokens: number) => void
  setTemperature: (temp: number) => void
  setTopP: (topP: number) => void
  setStreamResponses: (stream: boolean) => void
  setShowThinking: (show: boolean) => void
  setShowGenerationInfo: (show: boolean) => void
  setDefaultSearchProvider: (provider: 'searxng' | 'duckduckgo' | 'brave' | 'google') => void
  setSearchConfig: (config: Record<string, string>) => void
  setArtifactsEnabled: (enabled: boolean) => void
  setSkillsDirectory: (dir: string) => void
  setSkillsShApiKey: (key: string) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      sidebarOpen: true,
      selectedModel: '',
      selectedProvider: '',
      systemPrompt: 'You are a highly capable AI assistant. You excel at providing helpful, clear, and accurate information. When writing code, always use appropriate markdown formatting and specify the language.\n\nYou have access to tools (like web search). When you need to look up information or use a tool, ALWAYS call the appropriate tool using the proper format. Do not guess information if you can look it up.\n\nCRITICAL CITATION RULE: When providing information from search results or external URLs, you MUST cite your sources inline using the format [source:n], where n is the 1-indexed number of the search result or URL read. This is required for EVERY fact or claim that comes from a tool result.\n\nExample: "The capital of France is Paris [source:1]. The Eiffel Tower was completed in 1889 [source:2]."\n\nFailure to include inline citations is a violation of your instructions.',
      providers: [],
      tools: [],
      maxTokens: 4096,
      temperature: 0.7,
      topP: 1,
      streamResponses: true,
      showThinking: true,
      showGenerationInfo: true,
      defaultSearchProvider: 'duckduckgo',
      searchConfig: {},
      artifactsEnabled: true,
      skillsDirectory: './skills',
      skillsShApiKey: '',

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSelectedModel: (model) => set({ selectedModel: model }),
      setSelectedProvider: (provider) => set({ selectedProvider: provider }),
      setSystemPrompt: (prompt) => set({ systemPrompt: prompt }),
      setProviders: (providers) => set({ providers }),
      addProvider: (provider) => {
        fetch('/api/providers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(provider),
        }).catch(console.error)
        set(state => ({ providers: [...state.providers, provider] }))
      },
      updateProvider: (id, updates) => {
        const p = get().providers.find(p => p.id === id)
        if (p) {
          fetch(`/api/providers/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...p, ...updates }),
          }).catch(console.error)
        }
        set(state => ({
          providers: state.providers.map(p =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }))
      },
      removeProvider: (id) => {
        fetch(`/api/providers/${id}`, {
          method: 'DELETE',
        }).catch(console.error)
        set(state => ({
          providers: state.providers.filter(p => p.id !== id),
        }))
      },
      addTool: (tool) =>
        set(state => ({ tools: [...state.tools, tool] })),
      updateTool: (id, updates) =>
        set(state => ({
          tools: state.tools.map(t =>
            t.id === id ? { ...t, ...updates } : t
          ),
        })),
      removeTool: (id) =>
        set(state => ({
          tools: state.tools.filter(t => t.id !== id),
        })),
      setMaxTokens: (maxTokens) => set({ maxTokens }),
      setTemperature: (temperature) => set({ temperature }),
      setTopP: (topP) => set({ topP }),
      setStreamResponses: (streamResponses) => set({ streamResponses }),
      setShowThinking: (showThinking) => set({ showThinking }),
      setShowGenerationInfo: (showGenerationInfo) => set({ showGenerationInfo }),
      setDefaultSearchProvider: (defaultSearchProvider) => set({ defaultSearchProvider }),
      setSearchConfig: (searchConfig) => set({ searchConfig }),
      setArtifactsEnabled: (artifactsEnabled) => set({ artifactsEnabled }),
      setSkillsDirectory: (skillsDirectory) => set({ skillsDirectory }),
      setSkillsShApiKey: (skillsShApiKey) => set({ skillsShApiKey }),
    }),
    {
      name: 'ai-chat-ui-settings',
    }
  )
)
