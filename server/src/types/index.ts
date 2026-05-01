export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  attachments?: Attachment[]
  generationInfo?: GenerationInfo
  timestamp: number
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  display?: string
}

export interface ToolResult {
  toolCallId: string
  name: string
  result: string
}

export interface Attachment {
  id: string
  type: 'image' | 'file'
  url: string
  name: string
  mimeType: string
}

export interface GenerationInfo {
  model: string
  provider: string
  tokensUsed?: number
  promptTokens?: number
  completionTokens?: number
  tokensPerSecond?: number
  totalDuration?: number
  loadDuration?: number
  promptEvalDuration?: number
  evalDuration?: number
  totalCost?: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  model: string
  provider: string
  systemPrompt?: string
  createdAt: number
  updatedAt: number
}

export interface LLMProvider {
  id: string
  name: string
  type: string
  baseUrl?: string
  apiKey?: string
  models: string[]
  enabled: boolean
}

export interface ToolDefinition {
  id: string
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, {
      type: string
      description?: string
      enum?: string[]
    }>
    required?: string[]
  }
}

export interface SkillManifest {
  name: string
  version: string
  description: string
  author?: string
  entry: string
  config?: Record<string, {
    type: string
    description: string
    required?: boolean
    default?: unknown
  }>
}
