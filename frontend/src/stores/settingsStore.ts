import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ProviderConfig {
  id: string
  name: string
  type: 'openai' | 'anthropic' | 'ollama' | 'gemini' | 'openrouter' | 'lmstudio' | 'nvidia' | 'opencode-go' | 'openai-compatible' | 'custom'
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

export type ReasoningEffort = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

type SharedSettingsSlice = Pick<SettingsState,
  'selectedModel'
  | 'selectedProvider'
  | 'systemPrompt'
  | 'maxTokens'
  | 'temperature'
  | 'topP'
  | 'reasoningEffort'
  | 'deepResearch'
  | 'multiAgentEnabled'
  | 'maxSubagents'
  | 'subagentModel'
  | 'subagentProvider'
  | 'streamResponses'
  | 'showThinking'
  | 'showGenerationInfo'
  | 'defaultSearchProvider'
  | 'searchConfig'
  | 'artifactsEnabled'
  | 'toolDisplayMode'
  | 'maxToolTurns'
>

export interface SettingsState {
  sharedSettingsLoaded: boolean
  providersLoaded: boolean
  toolsLoaded: boolean
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
  reasoningEffort: ReasoningEffort
  deepResearch: boolean
  multiAgentEnabled: boolean
  maxSubagents: number
  subagentModel: string
  subagentProvider: string
  streamResponses: boolean
  showThinking: boolean
  showGenerationInfo: boolean
  defaultSearchProvider: 'searxng' | 'duckduckgo' | 'brave' | 'google' | 'parallel' | 'exa' | 'tavily'
  searchConfig: Record<string, string>
  artifactsEnabled: boolean
  skillsDirectory: string
  skillsShApiKey: string
  toolDisplayMode: 'individual' | 'grouped' | 'timeline'
  maxToolTurns: number

  setTheme: (theme: 'dark' | 'light' | 'system' | 'midnight' | 'emerald' | 'rose' | 'violet' | 'sunset') => void
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setSelectedModel: (model: string) => void
  setSelectedProvider: (provider: string) => void
  setSelectedModelAndProvider: (model: string, provider: string) => void
  setSystemPrompt: (prompt: string) => void
  setProviders: (providers: ProviderConfig[]) => void
  setTools: (tools: ToolConfig[]) => void
  markProvidersLoaded: () => void
  markToolsLoaded: () => void
  hydrateSharedSettings: (settings: Partial<SharedSettingsSlice>) => void
  markSharedSettingsLoaded: () => void
  addProvider: (provider: ProviderConfig) => void
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void
  removeProvider: (id: string) => void
  addTool: (tool: ToolConfig) => void
  updateTool: (id: string, updates: Partial<ToolConfig>) => void
  removeTool: (id: string) => void
  setMaxTokens: (tokens: number) => void
  setTemperature: (temp: number) => void
  setTopP: (topP: number) => void
  setReasoningEffort: (effort: ReasoningEffort) => void
  setDeepResearch: (enabled: boolean) => void
  setMultiAgentEnabled: (enabled: boolean) => void
  setMaxSubagents: (count: number) => void
  setSubagentModel: (model: string) => void
  setSubagentProvider: (provider: string) => void
  setStreamResponses: (stream: boolean) => void
  setShowThinking: (show: boolean) => void
  setShowGenerationInfo: (show: boolean) => void
  setDefaultSearchProvider: (provider: 'searxng' | 'duckduckgo' | 'brave' | 'google' | 'parallel' | 'exa' | 'tavily') => void
  setSearchConfig: (config: Record<string, string>) => void
  setArtifactsEnabled: (enabled: boolean) => void
  setSkillsDirectory: (dir: string) => void
  setSkillsShApiKey: (key: string) => void
  setToolDisplayMode: (mode: 'individual' | 'grouped' | 'timeline') => void
  setMaxToolTurns: (turns: number) => void
}

const SHARED_SETTINGS_KEYS = [
  'selectedModel',
  'selectedProvider',
  'systemPrompt',
  'maxTokens',
  'temperature',
  'topP',
  'reasoningEffort',
  'deepResearch',
  'multiAgentEnabled',
  'maxSubagents',
  'subagentModel',
  'subagentProvider',
  'streamResponses',
  'showThinking',
  'showGenerationInfo',
  'defaultSearchProvider',
  'searchConfig',
  'artifactsEnabled',
  'toolDisplayMode',
  'maxToolTurns',
] as const satisfies ReadonlyArray<keyof SharedSettingsSlice>

function syncSharedSettings(updates: Partial<SharedSettingsSlice>) {
  fetch('/api/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  }).catch(console.error)
}

function syncToolState(tool: ToolConfig) {
  fetch(`/api/tools/${encodeURIComponent(tool.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enabled: tool.enabled,
      config: tool.config,
    }),
  }).catch(console.error)
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      sharedSettingsLoaded: false,
      providersLoaded: false,
      toolsLoaded: false,
      theme: 'dark',
      sidebarOpen: true,
      selectedModel: '',
      selectedProvider: '',
      systemPrompt: 'You are a highly capable AI assistant. You excel at providing helpful, clear, and accurate information. When writing code, always use appropriate markdown formatting and specify the language.\n\nYou have access to tools (like web search). When you need to look up information or use a tool, ALWAYS call the appropriate tool using the proper format. Do not guess information if you can look it up.\n\nCRITICAL CITATION RULE: When providing information from search results or external URLs, you MUST cite your sources inline using the format [source:n], where n is the 1-indexed number of the search result or URL read. This is required for EVERY fact or claim that comes from a tool result.\n\nExample: "The capital of France is Paris [source:1]. The Eiffel Tower was completed in 1889 [source:2]."\n\nFailure to include inline citations is a violation of your instructions.',
      providers: [],
      tools: [],
      maxTokens: 131072,
      temperature: 0.7,
      topP: 1,
      reasoningEffort: 'auto',
      deepResearch: false,
      multiAgentEnabled: false,
      maxSubagents: 3,
      subagentModel: '',
      subagentProvider: '',
      streamResponses: true,
      showThinking: true,
      showGenerationInfo: true,
      defaultSearchProvider: 'searxng',
      searchConfig: { searxngUrl: 'http://192.168.1.70:8888' },
      artifactsEnabled: true,
      skillsDirectory: './skills',
      skillsShApiKey: '',
      toolDisplayMode: 'individual',
      maxToolTurns: 0,

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set(state => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSelectedModel: (model) => {
        set({ selectedModel: model })
        syncSharedSettings({ selectedModel: model })
      },
      setSelectedProvider: (provider) => {
        set({ selectedProvider: provider })
        syncSharedSettings({ selectedProvider: provider })
      },
      setSelectedModelAndProvider: (model, provider) => {
        set({ selectedModel: model, selectedProvider: provider })
        syncSharedSettings({ selectedModel: model, selectedProvider: provider })
      },
      setSystemPrompt: (prompt) => {
        set({ systemPrompt: prompt })
        syncSharedSettings({ systemPrompt: prompt })
      },
      setProviders: (providers) => set({ providers, providersLoaded: true }),
      setTools: (tools) => set({ tools, toolsLoaded: true }),
      markProvidersLoaded: () => set({ providersLoaded: true }),
      markToolsLoaded: () => set({ toolsLoaded: true }),
      hydrateSharedSettings: (settings) => set(state => ({
        ...state,
        ...Object.fromEntries(
          SHARED_SETTINGS_KEYS
            .filter((key) => settings[key] !== undefined)
            .map((key) => [key, settings[key]])
        ),
        sharedSettingsLoaded: true,
      })),
      markSharedSettingsLoaded: () => set({ sharedSettingsLoaded: true }),
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
          fetch(`/api/providers/${encodeURIComponent(id)}`, {
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
        fetch(`/api/providers/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }).catch(console.error)
        set(state => ({
          providers: state.providers.filter(p => p.id !== id),
        }))
      },
      addTool: (tool) => {
        const nextTool = { ...tool, config: tool.config || {} }
        set(state => {
          const existing = state.tools.some(t => t.id === nextTool.id)
          return {
            tools: existing
              ? state.tools.map(t => t.id === nextTool.id ? nextTool : t)
              : [...state.tools, nextTool],
          }
        })
        syncToolState(nextTool)
      },
      updateTool: (id, updates) => {
        const currentTool = get().tools.find(t => t.id === id)
        const nextTool = {
          id,
          name: currentTool?.name || id,
          enabled: currentTool?.enabled ?? true,
          config: currentTool?.config || {},
          ...currentTool,
          ...updates,
        }

        set(state => ({
          tools: state.tools.some(t => t.id === id)
            ? state.tools.map(t => t.id === id ? nextTool : t)
            : [...state.tools, nextTool],
        }))

        syncToolState(nextTool)
      },
      removeTool: (id) => {
        fetch(`/api/tools/${encodeURIComponent(id)}`, {
          method: 'DELETE',
        }).catch(console.error)
        set(state => ({
          tools: state.tools.filter(t => t.id !== id),
        }))
      },
      setMaxTokens: (maxTokens) => {
        set({ maxTokens })
        syncSharedSettings({ maxTokens })
      },
      setTemperature: (temperature) => {
        set({ temperature })
        syncSharedSettings({ temperature })
      },
      setTopP: (topP) => {
        set({ topP })
        syncSharedSettings({ topP })
      },
      setReasoningEffort: (reasoningEffort) => {
        set({ reasoningEffort })
        syncSharedSettings({ reasoningEffort })
      },
      setDeepResearch: (deepResearch) => {
        set({ deepResearch })
        syncSharedSettings({ deepResearch })
      },
      setMultiAgentEnabled: (multiAgentEnabled) => {
        set({ multiAgentEnabled })
        syncSharedSettings({ multiAgentEnabled })
      },
      setMaxSubagents: (maxSubagents) => {
        set({ maxSubagents })
        syncSharedSettings({ maxSubagents })
      },
      setSubagentModel: (subagentModel) => {
        set({ subagentModel })
        syncSharedSettings({ subagentModel })
      },
      setSubagentProvider: (subagentProvider) => {
        set({ subagentProvider })
        syncSharedSettings({ subagentProvider })
      },
      setStreamResponses: (streamResponses) => {
        set({ streamResponses })
        syncSharedSettings({ streamResponses })
      },
      setShowThinking: (showThinking) => {
        set({ showThinking })
        syncSharedSettings({ showThinking })
      },
      setShowGenerationInfo: (showGenerationInfo) => {
        set({ showGenerationInfo })
        syncSharedSettings({ showGenerationInfo })
      },
      setDefaultSearchProvider: (defaultSearchProvider) => {
        set({ defaultSearchProvider })
        syncSharedSettings({ defaultSearchProvider })
      },
      setSearchConfig: (searchConfig) => {
        set({ searchConfig })
        syncSharedSettings({ searchConfig })
      },
      setArtifactsEnabled: (artifactsEnabled) => {
        set({ artifactsEnabled })
        syncSharedSettings({ artifactsEnabled })
      },
      setSkillsDirectory: (skillsDirectory) => set({ skillsDirectory }),
      setSkillsShApiKey: (skillsShApiKey) => set({ skillsShApiKey }),
      setToolDisplayMode: (toolDisplayMode) => {
        set({ toolDisplayMode })
        syncSharedSettings({ toolDisplayMode })
      },
      setMaxToolTurns: (maxToolTurns) => {
        set({ maxToolTurns })
        syncSharedSettings({ maxToolTurns })
      },
    }),
    {
      name: 'ai-chat-ui-settings',
      partialize: (state) => ({
        theme: state.theme,
        sidebarOpen: state.sidebarOpen,
        providers: state.providers,
        tools: state.tools,
        skillsDirectory: state.skillsDirectory,
        skillsShApiKey: state.skillsShApiKey,
      }),
    }
  )
)
