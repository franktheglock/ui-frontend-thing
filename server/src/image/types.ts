export type ImageProviderId = 'local' | 'fal' | 'openrouter' | 'grok' | 'openai' | 'gemini'

export interface ImageProviderConfig {
  id: ImageProviderId
  name: string
  enabled: boolean
  baseUrl: string
  apiKey: string
  model: string
}

export interface ImageGenerationSettings {
  selectedProvider: ImageProviderId
  providers: ImageProviderConfig[]
}

export interface ImageGenerationRequest {
  prompt: string
  providerId?: ImageProviderId
  width?: number
  height?: number
  steps?: number
  guidanceScale?: number
  seed?: number
  variations?: number
  aspectRatio?: string
}

export interface ImageEditRequest extends ImageGenerationRequest {
  sourceImageUrl: string
  referenceImageUrl?: string
  strength?: number
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