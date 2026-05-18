import fs from 'fs'
import path from 'path'
import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { ChatMessage } from '../types'
import { uploadToCatbox } from '../image/service'

const catboxCache = new Map<string, string>()

export class OpenAIProvider extends BaseProvider {
  id = 'openai'
  name = 'OpenAI'
  type = 'openai'

  constructor(config: { apiKey?: string }) {
    super({ apiKey: config.apiKey || process.env.OPENAI_API_KEY })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const reasoningEffort = this.getOpenAIReasoningEffort(options.reasoningEffort)

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        messages: await this.formatMessages(options.messages),
        temperature: options.temperature,
        max_tokens: options.maxTokens || undefined,
        top_p: options.topP,
        reasoning_effort: reasoningEffort,
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
      throw new Error(`OpenAI API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0
    let accumulatedToolCalls: any[] = []

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
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
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    const delta = data.choices?.[0]?.delta
    if (!delta) return null

    const chunk: CompletionChunk = {}

    if (delta.content) {
      chunk.content = delta.content
    }

    if (delta.tool_calls) {
      chunk.toolCalls = delta.tool_calls
    }

    if (data.usage) {
      chunk.generationInfo = {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        tokensUsed: data.usage.total_tokens,
      }
    }

    return chunk
  }

  private async resolveAttachmentUrl(url: string): Promise<string> {
    if (url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
      return url
    }
    const cached = catboxCache.get(url)
    if (cached) return cached

    let filePath = url
    if (url.startsWith('http')) {
      try { filePath = new URL(url).pathname } catch { /* ignore */ }
    }
    const absolutePath = path.join(process.cwd(), filePath.replace(/^\/+/, ''))
    if (!fs.existsSync(absolutePath)) {
      catboxCache.set(url, url)
      return url
    }

    try {
      const buffer = fs.readFileSync(absolutePath)
      const publicUrl = await uploadToCatbox(buffer, path.basename(absolutePath))
      catboxCache.set(url, publicUrl)
      return publicUrl
    } catch {
      // fall through
    }

    const buffer = fs.readFileSync(absolutePath)
    const ext = path.extname(absolutePath).toLowerCase()
    const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
      : ext === '.webp' ? 'image/webp'
        : ext === '.gif' ? 'image/gif'
          : 'image/png'
    const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`
    catboxCache.set(url, dataUrl)
    return dataUrl
  }

  private async formatMessages(messages: ChatMessage[]): Promise<any[]> {
    const result: any[] = []
    for (const m of messages) {
      const msg: any = {
        role: m.role,
        content: m.content || null,
      }

      if (m.role === 'assistant' && m.toolCalls) {
        msg.tool_calls = m.toolCalls.map(tc => ({
          id: tc.id,
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments),
          },
        }))
      }

      if (m.role === 'tool' && m.toolResults) {
        msg.tool_call_id = m.toolResults[0]?.toolCallId
      }

      if (m.attachments && m.attachments.length > 0) {
        const attachmentContents = await Promise.all(
          m.attachments.map(async (a) => {
            const url = a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}`
            const resolvedUrl = await this.resolveAttachmentUrl(url)
            return { type: 'image_url', image_url: { url: resolvedUrl } }
          })
        )
        msg.content = [
          { type: 'text', text: m.content },
          ...attachmentContents,
        ]
      }

      result.push(msg)
    }
    return result
  }
}
