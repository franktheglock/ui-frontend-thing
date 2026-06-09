import fs from 'fs'
import path from 'path'
import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { extractPythonToolCalls } from '../tools/python-tool-calls'

async function resolveLocalImageToBase64(url: string): Promise<string> {
  if (url.startsWith('http') && !url.includes('localhost') && !url.includes('127.0.0.1')) {
    return url
  }
  let filePath = url
  if (url.startsWith('http')) {
    try { filePath = new URL(url).pathname } catch { /* ignore */ }
  }
  const absolutePath = path.join(process.cwd(), filePath.replace(/^\/+/, ''))
  if (!fs.existsSync(absolutePath)) return url
  const buffer = fs.readFileSync(absolutePath)
  const ext = path.extname(absolutePath).toLowerCase()
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
    : ext === '.webp' ? 'image/webp'
      : ext === '.gif' ? 'image/gif'
        : 'image/png'
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

export class OllamaProvider extends BaseProvider {
  id = 'ollama'
  name = 'Ollama'
  type = 'ollama'

  constructor(config: { baseUrl?: string }) {
    super({ baseUrl: config.baseUrl || process.env.OLLAMA_BASE_URL || 'http://localhost:11434' })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const messages = await Promise.all(
      options.messages.map(async (m) => ({
        role: m.role,
        content: m.content,
        images: m.attachments
          ? await Promise.all(
              m.attachments
                .filter((a) => a.type === 'image')
                .map(async (a) => {
                  const url = a.url.startsWith('http') ? a.url : `http://localhost:3456${a.url}`
                  return resolveLocalImageToBase64(url)
                })
            )
          : undefined,
      }))
    )

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options.model,
        messages,
        options: {
          temperature: options.temperature,
          num_predict: options.maxTokens || undefined,
          top_p: options.topP,
        },
        stream: true,
        tools: options.tools?.map(t => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        })),
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Ollama API error: ${error}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    const decoder = new TextDecoder()
    let buffer = ''
    let totalDuration = 0
    let loadDuration = 0
    let promptEvalCount = 0
    let evalCount = 0
    let promptEvalDuration = 0
    let evalDuration = 0
    let contentBuffer = '' // For Python-style tool call detection

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const data = JSON.parse(line)
          
          if (data.total_duration) totalDuration = data.total_duration
          if (data.load_duration) loadDuration = data.load_duration
          if (data.prompt_eval_count) promptEvalCount = data.prompt_eval_count
          if (data.eval_count) evalCount = data.eval_count
          if (data.prompt_eval_duration) promptEvalDuration = data.prompt_eval_duration
          if (data.eval_duration) evalDuration = data.eval_duration

          if (data.message?.content) {
            contentBuffer += data.message.content

            // Check for complete Python-style tool calls
            const { cleanedContent, toolCalls: extractedCalls } = extractPythonToolCalls(contentBuffer)
            if (extractedCalls.length > 0) {
              if (cleanedContent) {
                yield { content: cleanedContent }
              }
              for (const tc of extractedCalls) {
                yield { toolCalls: [{ id: tc.id, name: tc.name, arguments: tc.arguments }] }
              }
              contentBuffer = ''
              continue
            }

            // Partial tool call marker — hold content until we have the complete marker
            const markerIdx = contentBuffer.lastIndexOf('<|tool_call_start|>')
            if (markerIdx >= 0) {
              const safeContent = contentBuffer.slice(0, markerIdx)
              if (safeContent) yield { content: safeContent }
              contentBuffer = contentBuffer.slice(markerIdx)
              continue
            }

            // Normal content
            yield { content: contentBuffer }
            contentBuffer = ''
          }

          if (data.message?.tool_calls) {
            yield { toolCalls: data.message.tool_calls }
          }
        } catch {}
      }
    }

    // Flush remaining buffer
    if (contentBuffer) {
      const { cleanedContent, toolCalls: remainingCalls } = extractPythonToolCalls(contentBuffer)
      if (remainingCalls.length > 0) {
        if (cleanedContent) yield { content: cleanedContent }
        for (const tc of remainingCalls) {
          yield { toolCalls: [{ id: tc.id, name: tc.name, arguments: tc.arguments }] }
        }
      } else {
        yield { content: contentBuffer }
      }
    }

    const tokensPerSecond = evalDuration > 0 
      ? Math.round((evalCount / (evalDuration / 1e9)) * 10) / 10 
      : 0

    yield {
      done: true,
      generationInfo: {
        tokensUsed: promptEvalCount + evalCount,
        promptTokens: promptEvalCount,
        completionTokens: evalCount,
        tokensPerSecond,
        totalDuration,
        loadDuration,
        promptEvalDuration,
        evalDuration,
      },
    }
  }

  protected parseChunk(data: any): CompletionChunk | null {
    return null // Handled manually above
  }
}
