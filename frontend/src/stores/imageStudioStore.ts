import { create } from 'zustand'

export type ImageProviderId = 'local' | 'fal' | 'openrouter' | 'grok' | 'openai' | 'gemini'

export interface ImageProviderConfig {
  id: ImageProviderId
  name: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export interface GeneratedImage {
  id: string
  url: string
  width?: number
  height?: number
  mimeType: string
}

export interface ImageGenerationRecord {
  id: string
  prompt: string
  providerId: ImageProviderId
  model: string
  images: GeneratedImage[]
  params: Record<string, unknown>
  createdAt: number
}

interface ImageStudioState {
  settingsLoaded: boolean
  historyLoaded: boolean
  selectedProvider: ImageProviderId
  providers: ImageProviderConfig[]
  history: ImageGenerationRecord[]
  isGenerating: boolean
  error: string | null

  loadSettings: () => Promise<void>
  loadHistory: (limit?: number) => Promise<void>
  setSelectedProvider: (providerId: ImageProviderId) => Promise<void>
  updateProvider: (providerId: ImageProviderId, updates: Partial<ImageProviderConfig>) => Promise<void>
  generateImage: (payload: Record<string, unknown>) => Promise<{ provider: ImageProviderId; model: string; images: GeneratedImage[]; params: Record<string, unknown> }>
  editImage: (payload: Record<string, unknown>) => Promise<{ provider: ImageProviderId; model: string; images: GeneratedImage[]; params: Record<string, unknown> }>
  deleteHistoryImage: (recordId: string, imageId: string) => Promise<void>
}

async function patchImageSettings(updates: Partial<Pick<ImageStudioState, 'selectedProvider' | 'providers'>>) {
  const response = await fetch('/api/images/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  })

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}))
    throw new Error(payload.error || 'Failed to update image settings')
  }

  return response.json()
}

export const useImageStudioStore = create<ImageStudioState>()((set, get) => ({
  settingsLoaded: false,
  historyLoaded: false,
  selectedProvider: 'local',
  providers: [],
  history: [],
  isGenerating: false,
  error: null,

  loadSettings: async () => {
    const response = await fetch('/api/images/settings')
    if (!response.ok) {
      throw new Error('Failed to load image settings')
    }

    const payload = await response.json()
    set({
      settingsLoaded: true,
      selectedProvider: payload.settings?.selectedProvider || 'local',
      providers: Array.isArray(payload.settings?.providers) ? payload.settings.providers : [],
    })
  },

  loadHistory: async (limit = 48) => {
    const response = await fetch(`/api/images/history?limit=${encodeURIComponent(String(limit))}`)
    if (!response.ok) {
      throw new Error('Failed to load image history')
    }

    const payload = await response.json()
    set({
      historyLoaded: true,
      history: Array.isArray(payload.history) ? payload.history : [],
    })
  },

  setSelectedProvider: async (providerId) => {
    set({ selectedProvider: providerId })
    try {
      await patchImageSettings({ selectedProvider: providerId })
    } catch (error) {
      await get().loadSettings()
      throw error
    }
  },

  updateProvider: async (providerId, updates) => {
    const providers = get().providers.map((provider) => provider.id === providerId ? { ...provider, ...updates } : provider)
    set({ providers })

    try {
      await patchImageSettings({ providers })
    } catch (error) {
      await get().loadSettings()
      throw error
    }
  },

  generateImage: async (payload) => {
    set({ isGenerating: true, error: null })
    try {
      const response = await fetch('/api/images/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Image generation failed')
      }

      await get().loadHistory()
      set({ isGenerating: false })
      return data
    } catch (error: any) {
      set({ isGenerating: false, error: error.message || 'Image generation failed' })
      throw error
    }
  },

  editImage: async (payload) => {
    set({ isGenerating: true, error: null })
    try {
      const response = await fetch('/api/images/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || 'Image editing failed')
      }

      await get().loadHistory()
      set({ isGenerating: false })
      return data
    } catch (error: any) {
      set({ isGenerating: false, error: error.message || 'Image editing failed' })
      throw error
    }
  },

  deleteHistoryImage: async (recordId, imageId) => {
    const response = await fetch(`/api/images/history/${encodeURIComponent(recordId)}/images/${encodeURIComponent(imageId)}`, {
      method: 'DELETE',
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || 'Failed to delete image history item')
    }

    await get().loadHistory()
  },
}))