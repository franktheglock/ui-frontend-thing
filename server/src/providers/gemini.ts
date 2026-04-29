import { BaseProvider, CompletionOptions, CompletionChunk } from './base'

export class GeminiProvider extends BaseProvider {
  id = 'gemini'
  name = 'Google Gemini'
  type = 'gemini'

  constructor(config: { apiKey?: string }) {
    super({ apiKey: config.apiKey || process.env.GEMINI_API_KEY })
  }

  async *chatCompletion(options: CompletionOptions): AsyncGenerator<CompletionChunk> {
    const systemMessage = options.messages.find(m => m.role === 'system')
    const userMessages = options.messages.filter(m => m.role !== 'system')

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${options.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: userMessages.map(m => ({
            role: m.role === 'user' ? 'user' : 'model',
            parts: [{ text: m.content }],
          })),
          systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
          generationConfig: {
            temperature: options.temperature,
            maxOutputTokens: options.maxTokens,
            topP: options.topP,
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
