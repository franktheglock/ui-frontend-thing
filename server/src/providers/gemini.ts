import { BaseProvider, CompletionOptions, CompletionChunk } from './base'
import { safeJsonParse } from '../utils/json'

export class GeminiProvider extends BaseProvider {
  id = 'gemini'
  name = 'Google Gemini'
  type = 'gemini'

  private getThinkingConfig(model: string, effort?: CompletionOptions['reasoningEffort']) {
    if (!effort || effort === 'auto') return undefined

    const normalizedModel = model.toLowerCase()

    if (normalizedModel.includes('gemini-3')) {
      if (effort === 'max' || effort === 'xhigh') return { thinkingLevel: 'high' }
      if (effort === 'none') return { thinkingLevel: 'minimal' }
      if (effort === 'minimal' || effort === 'low' || effort === 'medium' || effort === 'high') {
        return { thinkingLevel: effort }
      }
      return undefined
    }

    if (normalizedModel.includes('gemini-2.5')) {
      if (effort === 'none') return { thinkingBudget: 0 }
      if (effort === 'minimal' || effort === 'low') return { thinkingBudget: 1024 }
      if (effort === 'medium') return { thinkingBudget: 8192 }
      if (effort === 'high' || effort === 'xhigh' || effort === 'max') return { thinkingBudget: 24576 }
    }

    return undefined
  }

  constructor(config: { apiKey?: string }) {
    super({ apiKey: config.apiKey || process.env.GEMINI_API_KEY })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const systemMessage = options.messages.find(m => m.role === 'system')
    const userMessages = options.messages.filter(m => m.role !== 'system')
    const thinkingConfig = this.getThinkingConfig(options.model, options.reasoningEffort)

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: userMessages.map(m => {
            const role = m.role === 'user' ? 'user' : 'model'
            const parts: any[] = [{ text: m.content || '' }]

            if (m.role === 'assistant' && m.toolCalls) {
              m.toolCalls.forEach(tc => {
                parts.push({
                  functionCall: {
                    name: tc.name,
                    args: typeof tc.arguments === 'string' ? safeJsonParse(tc.arguments) : tc.arguments,
                  }
                })
              })
            }

            if (m.role === 'tool' && m.toolResults) {
              m.toolResults.forEach(tr => {
                parts.push({
                  functionResponse: {
                    name: tr.name,
                    response: { result: tr.result }
                  }
                })
              })
            }

            return { role, parts }
          }),
          systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens || undefined,
            topP: options.topP,
            thinkingConfig,
          },
          tools: options.tools?.map(t => ({
            functionDeclarations: [{
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            }],
          })),
        }),
      }
    )

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`Gemini API error: ${error}`)
    }

    let promptTokens = 0
    let completionTokens = 0

    for await (const chunk of this.streamResponse(response)) {
      if (chunk.generationInfo) {
        promptTokens = chunk.generationInfo.promptTokens || promptTokens
        completionTokens = chunk.generationInfo.completionTokens || completionTokens
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
    const chunk: CompletionChunk = {}

    if (data.candidates?.[0]?.content?.parts?.[0]?.text) {
      chunk.content = data.candidates[0].content.parts[0].text
    }

    if (data.usageMetadata) {
      chunk.generationInfo = {
        promptTokens: data.usageMetadata.promptTokenCount,
        completionTokens: data.usageMetadata.candidatesTokenCount,
        tokensUsed: data.usageMetadata.totalTokenCount,
      }
    }

    return Object.keys(chunk).length > 0 ? chunk : null
  }
}
