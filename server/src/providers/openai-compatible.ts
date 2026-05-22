import fs from 'fs'
import path from 'path'
import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { ChatMessage } from '../types'
import { uploadToCatbox } from '../image/service'

const catboxCache = new Map<string, string>()

export class OpenAICompatibleProvider extends BaseProvider {
  id = 'openai-compatible'
  name = 'OpenAI Compatible'
  type = 'openai-compatible'
  baseUrl: string

  constructor(config: { baseUrl?: string; apiKey?: string }) {
    super(config)
    let url = config.baseUrl || 'https://api.openai.com'
    // Strip trailing /v1 or /v1/ to avoid double /v1/v1
    url = url.replace(/\/v1\/?$/, '')
    this.baseUrl = url
  }

  protected getRequestHeaders(): Record<string, string> {
    const customHeaders = (this.config?.headers || {}) as Record<string, string>
    return {
      'Content-Type': 'application/json',
      ...customHeaders,
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
    }
  }

  protected getModelRequestHeaders(): Record<string, string> {
    const customHeaders = (this.config?.headers || {}) as Record<string, string>
    return {
      ...customHeaders,
      ...(this.apiKey ? { 'Authorization': `Bearer ${this.apiKey}` } : {}),
    }
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: this.getRequestHeaders(),
      body: JSON.stringify({
        model: options.model,
        messages: await this.formatMessages(options.messages),
        temperature: options.temperature,
        max_tokens: options.maxTokens || undefined,
        top_p: options.topP,
        tools: options.tools?.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
        stream: true,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`${this.name} API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0
    let accumulatedToolCalls: any[] = []

    // Track additional gen info from last chunk (timings, etc.)
    let lastGenInfo: Record<string, any> = {}

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
        lastGenInfo = { ...lastGenInfo, ...chunk.generationInfo }
      }
      if (chunk.toolCalls) {
        for (const tc of chunk.toolCalls) {
          const index = tc.index ?? 0
          const newArgs = tc.function?.arguments || tc.arguments || ''
          const newName = tc.function?.name || tc.name || ''
          if (!accumulatedToolCalls[index]) {
            accumulatedToolCalls[index] = { 
              id: tc.id || `call_${index}`, 
              name: newName, 
              arguments: newArgs
            }
          } else {
            if (tc.id && !accumulatedToolCalls[index].id) accumulatedToolCalls[index].id = tc.id
            if (newName) accumulatedToolCalls[index].name = newName
            if (newArgs) {
              const existing = accumulatedToolCalls[index].arguments || ''
              accumulatedToolCalls[index].arguments = existing + newArgs
            }
          }
        }
        chunk.toolCalls = accumulatedToolCalls.filter(Boolean)
      }
      yield chunk
    }

    yield {
      done: true,
      generationInfo: {
        promptTokens,
        completionTokens,
        tokensUsed: promptTokens + completionTokens,
        tokensPerSecond: lastGenInfo.tokensPerSecond,
        promptPerSecond: lastGenInfo.promptPerSecond,
        totalDuration: lastGenInfo.totalDuration,
        provider: this.id,
        model: options.model,
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    const delta = data.choices?.[0]?.delta
    const chunk: CompletionChunk = {
      responseId: data.id
    }

    if (delta?.content) {
      chunk.content = delta.content
    }

    if (delta?.reasoning_content || delta?.reasoning) {
      chunk.thinking = delta.reasoning_content || delta.reasoning
    }

    if (delta?.tool_calls) {
      chunk.toolCalls = delta.tool_calls
    }

    if (data.usage) {
      chunk.generationInfo = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        tokensUsed: data.usage.total_tokens,
        totalCost: data.usage.total_cost,
      }
    }

    if (data.timings) {
      if (!chunk.generationInfo) chunk.generationInfo = {}
      chunk.generationInfo = {
        ...chunk.generationInfo,
        promptTokens: data.timings.prompt_n,
        completionTokens: data.timings.predicted_n,
        tokensUsed: (data.timings.prompt_n || 0) + (data.timings.predicted_n || 0),
        tokensPerSecond: data.timings.predicted_per_second,
        promptPerSecond: data.timings.prompt_per_second,
        totalDuration: data.timings.predicted_ms,
      }
    }

    return Object.keys(chunk).length > 0 ? chunk : null
  }

  protected async resolveAttachmentUrl(url: string): Promise<string> {
    // Already public — no conversion needed
    if (url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      return url
    }

    // Check cache
    const cached = catboxCache.get(url)
    if (cached) return cached

    // Extract path from URL
    let filePath = url
    if (url.startsWith('http')) {
      try {
        const parsed = new URL(url)
        filePath = parsed.pathname
      } catch {
        filePath = url
      }
    }
    const absolutePath = path.join(process.cwd(), filePath.replace(/^\/+/, ''))

    if (!fs.existsSync(absolutePath)) {
      catboxCache.set(url, url) // don't retry nonexistent paths
      return url
    }

    // Try uploading to catbox for a short public URL (saves tokens vs base64)
    try {
      const buffer = fs.readFileSync(absolutePath)
      const publicUrl = await uploadToCatbox(buffer, path.basename(absolutePath))
      catboxCache.set(url, publicUrl)
      return publicUrl
    } catch {
      // Fall through to base64
    }

    // Fallback: inline as base64
    const buffer = fs.readFileSync(absolutePath)
    const ext = path.extname(absolutePath).toLowerCase()
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
          : 'image/png'
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    catboxCache.set(url, dataUrl) // cache base64 too so we don't re-read for same url
    return dataUrl
  }

  protected async formatMessages(messages: any[]): Promise<any[]> {
    const formatted: any[] = []

    for (const m of messages) {
      const base: any = {
        role: m.role,
        content: m.content || '',
      }

      if (m.role === 'assistant' && m.thinking) {
        base.reasoning_content = m.thinking
      }

      if (m.attachments && m.attachments.length > 0) {
        const attachmentContents = await Promise.all(
          m.attachments.map(async (a: any) => {
            const url = a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}`
            const resolvedUrl = await this.resolveAttachmentUrl(url)
            if (a.type === 'image') {
              return {
                type: 'image_url',
                image_url: { url: resolvedUrl }
              }
            } else {
              return {
                type: 'file',
                file_url: { url: resolvedUrl, name: a.name, mime_type: a.mimeType }
              }
            }
          })
        )
        base.content = [
          { type: 'text', text: m.content || '' },
          ...attachmentContents,
        ]
      }

      if (m.toolCalls && m.toolCalls.length > 0) {
        base.tool_calls = m.toolCalls.map((tc: any) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments) }
        }))
      }

      formatted.push(base)

      if (m.toolResults && m.toolResults.length > 0) {
        for (const tr of m.toolResults) {
          formatted.push({
            role: 'tool',
            tool_call_id: tr.toolCallId,
            content: tr.result !== undefined ? (typeof tr.result === 'string' ? tr.result : JSON.stringify(tr.result)) : ''
          })
        }
      }
    }

    return formatted
  }

  async fetchModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        headers: this.getModelRequestHeaders(),
      })
      if (!response.ok) throw new Error('Failed to fetch models')
      const data = await response.json() as any
      return (data.data || []).map((m: any) => m.id).filter((id: string) => id && !id.includes('embed') && !id.includes('tts') && !id.includes('whisper') && !id.includes('dall'))
    } catch {
      return []
    }
  }
}
