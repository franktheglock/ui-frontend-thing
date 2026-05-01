import { create } from 'zustand'
import { getToolDisplay } from '../lib/toolDisplay'

export interface TimelineEvent {
  type: 'thinking' | 'tool_call' | 'tool_result' | 'content'
  content: string
  toolCallId?: string
  toolName?: string
  toolArgs?: Record<string, unknown>
  display?: string
  timestamp: number
}

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
  timeline?: TimelineEvent[]
  metadata?: {
    version?: number
    active?: boolean
    turnId?: string
  }
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
  totalCost?: number
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
  toolResults?: ToolResult[]
  isGenerating: boolean
  timeline: TimelineEvent[]
  generationInfo?: GenerationInfo
}

interface ChatState {
  sessions: ChatSession[]
  currentSessionId: string | null

  // Per-session streaming state (keyed by sessionId)
  streaming: Record<string, SessionStreamState>

  loadSessions: () => Promise<void>
  createSession: (model?: string, provider?: string) => Promise<string>
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
  setStreamingContent: (sessionId: string, content: string) => void
  appendStreamingThinking: (sessionId: string, thinking: string) => void
  setActiveToolCalls: (sessionId: string, calls: ToolCall[]) => void
  setActiveToolResults: (sessionId: string, results: ToolResult[]) => void
  addToolResult: (sessionId: string, result: ToolResult) => void
  setStreamingGenerationInfo: (sessionId: string, info: GenerationInfo) => void
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
  return streaming[sessionId] || { content: '', thinking: '', toolCalls: [], toolResults: [], isGenerating: false, timeline: [] }
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
                timeline: m.timeline,
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

  createSession: async (model?: string, provider?: string) => {
    const id = generateUUID()
    
    // If no model/provider passed, try to inherit from current session or use placeholders
    // We avoid 'openai' / 'gpt-4o' hardcoded strings here to prevent accidental fallbacks
    const session: ChatSession = {
      id,
      title: 'New Chat',
      messages: [],
      model: model || get().sessions.find(s => s.id === get().currentSessionId)?.model || '',
      provider: provider || get().sessions.find(s => s.id === get().currentSessionId)?.provider || '',
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
      [sessionId]: { content: '', thinking: '', toolCalls: [], toolResults: [], isGenerating: true, timeline: [] },
    },
  })),

  stopGenerating: (sessionId) => set(state => {
    const { [sessionId]: _, ...rest } = state.streaming
    return { streaming: rest }
  }),

  appendStreamingContent: (sessionId, content) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    const newTimeline = [...current.timeline]
    const lastEvent = newTimeline[newTimeline.length - 1]
    if (!lastEvent || lastEvent.type !== 'content') {
      newTimeline.push({ type: 'content', content: '', timestamp: Date.now() })
    }
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, content: current.content + content, timeline: newTimeline },
      },
    }
  }),

  setStreamingContent: (sessionId, content) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, content },
      },
    }
  }),

  appendStreamingThinking: (sessionId, thinking) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    const newTimeline = [...current.timeline]
    const lastEvent = newTimeline[newTimeline.length - 1]
    if (lastEvent && lastEvent.type === 'thinking') {
      lastEvent.content += thinking
    } else {
      newTimeline.push({ type: 'thinking', content: thinking, timestamp: Date.now() })
    }
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, thinking: current.thinking + thinking, timeline: newTimeline },
      },
    }
  }),

  setActiveToolCalls: (sessionId, calls) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    const newTimeline = [...current.timeline]
    // Add or update tool call events
    for (const call of calls) {
      const display = call.display || getToolDisplay(call.name, call.arguments)
      const existing = newTimeline.find(e => e.type === 'tool_call' && e.toolCallId === call.id)
      if (existing) {
        existing.toolName = call.name
        existing.toolArgs = call.arguments
        existing.display = display
      } else {
        newTimeline.push({
          type: 'tool_call',
          content: '',
          toolCallId: call.id,
          toolName: call.name,
          toolArgs: call.arguments,
          display,
          timestamp: Date.now(),
        })
      }
    }
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, toolCalls: calls, timeline: newTimeline },
      },
    }
  }),

  setActiveToolResults: (sessionId, results) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    const newTimeline = [...current.timeline]
    for (const result of results) {
      if (!newTimeline.find(e => e.type === 'tool_result' && e.toolCallId === result.toolCallId)) {
        newTimeline.push({
          type: 'tool_result',
          content: result.result,
          toolCallId: result.toolCallId,
          toolName: result.name,
          timestamp: Date.now(),
        })
      }
    }
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, toolResults: results, timeline: newTimeline },
      },
    }
  }),

  addToolResult: (sessionId, result: ToolResult) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    const newTimeline = [...current.timeline]
    newTimeline.push({
      type: 'tool_result',
      content: result.result,
      toolCallId: result.toolCallId,
      toolName: result.name,
      timestamp: Date.now(),
    })
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, timeline: newTimeline },
      },
    }
  }),
  
  setStreamingGenerationInfo: (sessionId, info) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, generationInfo: info },
      },
    }
  }),

  clearStreaming: (sessionId) => set(state => {
    const current = getStreamState(state.streaming, sessionId)
    return {
      streaming: {
        ...state.streaming,
        [sessionId]: { ...current, content: '', thinking: '', toolCalls: [], timeline: [] },
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
