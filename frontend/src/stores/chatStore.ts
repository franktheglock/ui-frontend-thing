import { create } from 'zustand'

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  thinking?: string
  toolCalls?: ToolCall[]
  toolResults?: ToolResult[]
  attachments?: Attachment[]
  generationInfo?: GenerationInfo
  timestamp: number
  responseId?: string
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
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
}

export interface ChatSession {
  id: string
  title: string
  messages: Message[]
  model: string
  provider: string
  systemPrompt?: string
  createdAt: number
  updatedAt: number
  lastResponseId?: string
  activeSkill?: string // Name/path of loaded skill
}

// Per-session streaming state
export interface SessionStreamState {
  content: string
  thinking: string
  toolCalls: ToolCall[]
  isGenerating: boolean
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null

  // Per-session streaming state (keyed by sessionId)
  streaming: Record<string, SessionStreamState>

  loadSessions: () => Promise<void>
  createSession: () => Promise<string>
  setCurrentSession: (id: string) => void
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  addMessage: (sessionId: string, message: Message) => Promise<void>
  updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => Promise<void>
  clearMessages: (sessionId: string) => void

  // Per-session streaming actions
  startGenerating: (sessionId: string) => void
  stopGenerating: (sessionId: string) => void
  appendStreamingContent: (sessionId: string, content: string) => void
  appendStreamingThinking: (sessionId: string, thinking: string) => void
  setActiveToolCalls: (sessionId: string, calls: ToolCall[]) => void
  clearStreaming: (sessionId: string) => void

  updateSessionModel: (sessionId: string, model: string, provider: string) => void
  setSessionResponseId: (sessionId: string, responseId: string) => Promise<void>
  setActiveSkill: (sessionId: string, skillName: string | undefined) => void
}

export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// Helper to get or create a default streaming state
function getStreamState(streaming: Record<string, SessionStreamState>, sessionId: string): SessionStreamState {
  return streaming[sessionId] || { content: '', thinking: '', toolCalls: [], isGenerating: false }
}

export const useChatStore = create<ChatState>()((set, get) => ({
  sessions: [],
  currentSessionId: null,
  streaming: {},

  loadSessions: async () => {
    try {
      const res = await fetch('/api/chat/sessions')
      if (!res.ok) return
      const sessions: any[] = await res.json()

      // Load messages for each session
      const fullSessions: ChatSession[] = await Promise.all(
        sessions.map(async (s: any) => {
          try {
            const msgRes = await fetch(`/api/chat/sessions/${s.id}`)
            if (!msgRes.ok) return { ...s, messages: [] }
            const data = await msgRes.json()
            return {
              id: data.id,
              title: data.title,
              model: data.model,
              provider: data.provider,
              systemPrompt: data.systemPrompt || data.system_prompt,
              createdAt: data.createdAt || data.created_at,
              updatedAt: data.updatedAt || data.updated_at,
              lastResponseId: data.lastResponseId || data.last_response_id,
              messages: (data.messages || []).map((m: any) => ({
                id: m.id,
                role: m.role,
                content: m.content,
                thinking: m.thinking,
                toolCalls: m.toolCalls,
                toolResults: m.toolResults,
                attachments: m.attachments,
                generationInfo: m.generationInfo,
                timestamp: m.timestamp,
                responseId: m.responseId,
              })),
            }
          } catch {
            return { ...s, messages: [] }
          }
        })
      )

      set({ sessions: fullSessions })
    } catch (err) {
      console.error('[chatStore] Failed to load sessions:', err)
    }
  },

  createSession: async () => {
    const id = generateUUID()
    const session: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      model: get().sessions.find(s => s.id === get().currentSessionId)?.model || 'gpt-4o',
      provider: get().sessions.find(s => s.id === get().currentSessionId)?.provider || 'openai',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    // Optimistic local update
    set(state => ({
      sessions: [session, ...state.sessions],
      currentSessionId: id,
    }))

    // Sync to server
    try {
      await fetch('/api/chat/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: session.id,
          title: session.title,
          model: session.model,
          provider: session.provider,
        }),
      })
    } catch (err) {
      console.error('[chatStore] Failed to create session on server:', err)
    }

    return id
  },

  setCurrentSession: (id) => {
    set({ currentSessionId: id })
  },

  deleteSession: async (id) => {
    set(state => {
      const sessions = state.sessions.filter(s => s.id !== id)
      const { [id]: _, ...remainingStreaming } = state.streaming
      return {
        sessions,
        streaming: remainingStreaming,
        currentSessionId: state.currentSessionId === id ? (sessions[0]?.id || null) : state.currentSessionId,
      }
    })

    try {
      await fetch(`/api/chat/sessions/${id}`, { method: 'DELETE' })
    } catch (err) {
      console.error('[chatStore] Failed to delete session:', err)
    }
  },

  renameSession: async (id, title) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === id ? { ...s, title } : s
      ),
    }))

    try {
      await fetch(`/api/chat/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title }),
      })
    } catch (err) {
      console.error('[chatStore] Failed to rename session:', err)
    }
  },

  addMessage: async (sessionId, message) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, message], updatedAt: Date.now() }
          : s
      ),
    }))

    try {
      await fetch(`/api/chat/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message),
      })
    } catch (err) {
      console.error('[chatStore] Failed to add message:', err)
    }
  },

  updateMessage: async (sessionId, messageId, updates) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId
          ? {
              ...s,
              messages: s.messages.map(m =>
                m.id === messageId ? { ...m, ...updates } : m
              ),
              updatedAt: Date.now(),
            }
          : s
      ),
    }))

    try {
      await fetch(`/api/chat/sessions/${sessionId}/messages/${messageId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })
    } catch (err) {
      console.error('[chatStore] Failed to update message:', err)
    }
  },

  clearMessages: (sessionId) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, messages: [], updatedAt: Date.now() } : s
      ),
    }))
  },

  // Per-session streaming actions
  startGenerating: (sessionId) => set(state => ({
    streaming: {
      ...state.streaming,
      [sessionId]: { content: '', thinking: '', toolCalls: [], isGenerating: true },
    },
  })),

  stopGenerating: (sessionId) => set(state => {
    const { [sessionId]: _, ...rest } = state.streaming
    return { streaming: rest }
  }),

  appendStreamingContent: (sessionId, content) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, content: current.content + content },
      },
    }
  }),

  appendStreamingThinking: (sessionId, thinking) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, thinking: current.thinking + thinking },
      },
    }
  }),

  setActiveToolCalls: (sessionId, calls) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, toolCalls: calls },
      },
    }
  }),

  clearStreaming: (sessionId) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, content: '', thinking: '', toolCalls: [] },
      },
    }
  }),

  updateSessionModel: (sessionId, model, provider) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, model, provider } : s
      ),
    }))
  },

  setSessionResponseId: async (sessionId, responseId) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, lastResponseId: responseId } : s
      ),
    }))

    try {
      await fetch(`/api/chat/sessions/${sessionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastResponseId: responseId }),
      })
    } catch (err) {
      console.error('[chatStore] Failed to update session responseId:', err)
    }
  },

  setActiveSkill: (sessionId, skillName) => {
    set(state => ({
      sessions: state.sessions.map(s =>
        s.id === sessionId ? { ...s, activeSkill: skillName } : s
      ),
    }))
  },
}))
