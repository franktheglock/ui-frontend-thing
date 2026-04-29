import { useCallback } from 'react'
import { useChatStore, generateUUID } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Message, Attachment } from '../stores/chatStore'

async function loadSkillContent(skillName: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/skills/content/${encodeURIComponent(skillName)}`)
    if (!res.ok) return null
    const data = await res.json()
    return data.content || null
  } catch {
    return null
  }
}

export function useChat() {
  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    const { 
      currentSessionId, 
      addMessage, 
      startGenerating,
      stopGenerating,
      clearStreaming, 
      appendStreamingContent, 
      appendStreamingThinking,
      setActiveToolCalls,
      renameSession,
    } = useChatStore.getState()

    const {
      selectedModel,
      selectedProvider,
      systemPrompt,
      temperature,
      maxTokens,
      topP,
      streamResponses,
      tools,
      defaultSearchProvider,
      searchConfig,
    } = useSettingsStore.getState()

    let sessionId = currentSessionId
    if (!sessionId) {
      sessionId = await useChatStore.getState().createSession()
    }

    const abortController = new AbortController()
    const signal = abortController.signal

    // Subscribe to store changes to detect if THIS session is deleted
    const unsubscribe = useChatStore.subscribe((state) => {
      const exists = state.sessions.some(s => s.id === sessionId)
      if (!exists) {
        abortController.abort()
      }
    })

    try {
      // Handle slash commands
      if (content.startsWith('/skill ')) {
        const skillName = content.slice(7).trim()
        const skillContent = await loadSkillContent(skillName)
        if (skillContent) {
          useChatStore.getState().setActiveSkill(sessionId, skillName)
          await addMessage(sessionId, {
            id: generateUUID(),
            role: 'assistant',
            content: `Loaded skill: **${skillName}**`,
            timestamp: Date.now(),
          })
          return
        }
      }

      if (content.startsWith('/model ')) {
        const modelArg = content.slice(7).trim()
        useSettingsStore.getState().setSelectedModel(modelArg)
        await addMessage(sessionId, {
          id: generateUUID(),
          role: 'assistant',
          content: `Switched to model: **${modelArg}**`,
          timestamp: Date.now(),
        })
        return
      }

      const userMessage: Message = {
        id: generateUUID(),
        role: 'user',
        content,
        attachments,
        timestamp: Date.now(),
      }

      await addMessage(sessionId, userMessage)
      startGenerating(sessionId)

      let hasToolCalls = false
      do {
        const session = useChatStore.getState().sessions.find(s => s.id === sessionId)
        if (!session) break

        hasToolCalls = false
        const messages = session.messages || []

        let enhancedSystemPrompt = systemPrompt
        if (session.activeSkill) {
          const skillContent = await loadSkillContent(session.activeSkill)
          if (skillContent) {
            enhancedSystemPrompt = `${systemPrompt}\n\n---\n\n## ACTIVE SKILL: ${session.activeSkill}\n\n${skillContent}`
          }
        }

        const response = await fetch('/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
              toolCalls: m.toolCalls,
              toolResults: m.toolResults,
            })),
            lastResponseId: session.lastResponseId,
            model: selectedModel,
            provider: selectedProvider,
            systemPrompt: enhancedSystemPrompt,
            temperature,
            maxTokens,
            topP,
            stream: streamResponses,
            tools: tools.filter(t => t.enabled).map(t => t.name),
          }),
        })

        if (!response.ok) throw new Error(`Request failed: ${response.status}`)

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        let fullThinking = ''
        let responseId: string | undefined
        let generationInfo: any

        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() || ''

            for (const line of lines) {
              const trimmedLine = line.trim()
              if (!trimmedLine) continue

              if (trimmedLine.startsWith('data: ')) {
                const data = trimmedLine.slice(6)
                if (data === '[DONE]') continue
                try {
                  const parsed = JSON.parse(data)
                  if (parsed.content) {
                    fullContent += parsed.content
                    appendStreamingContent(sessionId, parsed.content)
                  }
                  if (parsed.thinking) {
                    fullThinking += parsed.thinking
                    appendStreamingThinking(sessionId, parsed.thinking)
                  }
                  if (parsed.toolCalls) setActiveToolCalls(sessionId, parsed.toolCalls)
                  if (parsed.responseId) responseId = parsed.responseId
                  if (parsed.generationInfo) generationInfo = parsed.generationInfo
                } catch {}
              } else {
                try {
                  const parsed = JSON.parse(trimmedLine)
                  if (parsed.content) {
                    fullContent = parsed.content
                    appendStreamingContent(sessionId, parsed.content)
                  }
                  if (parsed.thinking) {
                    fullThinking = parsed.thinking
                    appendStreamingThinking(sessionId, parsed.thinking)
                  }
                  if (parsed.toolCalls) setActiveToolCalls(sessionId, parsed.toolCalls)
                  if (parsed.responseId) responseId = parsed.responseId
                } catch {}
              }
            }
          }
        } finally {
          reader.releaseLock()
        }

        const streamState = useChatStore.getState().streaming[sessionId]
        const activeCalls = streamState?.toolCalls || []
        const assistantMessage: Message = {
          id: generateUUID(),
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking || undefined,
          toolCalls: activeCalls.length > 0 ? [...activeCalls] : undefined,
          responseId,
          generationInfo,
          timestamp: Date.now(),
        }

        if (useChatStore.getState().sessions.some(s => s.id === sessionId)) {
          // Clear streaming content before adding final message (prevents flash of duplicate)
          if (activeCalls.length === 0) {
            stopGenerating(sessionId)
          }

          await addMessage(sessionId, assistantMessage)
          if (responseId) await useChatStore.getState().setSessionResponseId(sessionId, responseId)
          
          if (activeCalls.length > 0) {
            hasToolCalls = true
            const toolResults = []

            // Calculate current source count for pagination
            let currentSourceCount = 0
            const latestSession = useChatStore.getState().sessions.find(s => s.id === sessionId)
            latestSession?.messages.forEach(m => {
              if (m.toolResults) {
                for (const tr of m.toolResults) {
                  if (tr.name === 'web_search') {
                    const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
                    const matches = tr.result.match(urlRegex)
                    if (matches) currentSourceCount += matches.length
                  } else if (tr.name === 'read_url' || tr.name === 'read_browser_page') {
                    currentSourceCount += 1
                  }
                }
              }
            })

            for (const tc of activeCalls) {
              if (signal.aborted) break
              try {
                let parsedArgs = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
                
                // Inject search provider and config
                if (tc.name === 'web_search') {
                  if (!parsedArgs.provider) parsedArgs.provider = defaultSearchProvider
                  parsedArgs.searchConfig = searchConfig
                  parsedArgs.startIndex = currentSourceCount
                } else if (tc.name === 'read_url') {
                  parsedArgs.startIndex = currentSourceCount
                }

                const res = await fetch('/api/chat/tool-call', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  signal,
                  body: JSON.stringify({ name: tc.name, arguments: parsedArgs }),
                })
                const { result } = await res.json()
                toolResults.push({ toolCallId: tc.id, name: tc.name, result })

                // Update count for next tool in the same turn
                if (tc.name === 'web_search') {
                  const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
                  const matches = result.match(urlRegex)
                  if (matches) currentSourceCount += matches.length
                } else if (tc.name === 'read_url' || tc.name === 'read_browser_page') {
                  currentSourceCount += 1
                }
              } catch (err: any) {
                if (err.name === 'AbortError') break
                toolResults.push({ toolCallId: tc.id, name: tc.name, result: `Error: ${err.message}` })
              }
            }

            if (useChatStore.getState().sessions.some(s => s.id === sessionId)) {
              await useChatStore.getState().updateMessage(sessionId, assistantMessage.id, { toolResults })
            }
            
            // Clear content for next LLM turn but stay generating
            clearStreaming(sessionId)
          }
        }
      } while (hasToolCalls && !signal.aborted)

      // Auto-title generation
      const finalSession = useChatStore.getState().sessions.find(s => s.id === sessionId)
      if (finalSession && finalSession.title === 'New Chat' && finalSession.messages.length >= 2 && !signal.aborted) {
        try {
          const titleResponse = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal,
            body: JSON.stringify({
              messages: [
                ...finalSession.messages.slice(0, 4).map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: 'Summarize this conversation into a creative 3-5 word title. Return JSON: {"title": "..."}' }
              ],
              model: selectedModel,
              provider: selectedProvider,
              stream: false,
            }),
          })
          if (titleResponse.ok) {
            const tReader = titleResponse.body?.getReader()
            if (tReader) {
              const tDecoder = new TextDecoder()
              let tContent = ''
              try {
                while (true) {
                  const { done, value } = await tReader.read()
                  if (done) break
                  const chunk = tDecoder.decode(value)
                  const lines = chunk.split('\n')
                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      try {
                        const data = JSON.parse(line.slice(6))
                        if (data.content) tContent += data.content
                      } catch {}
                    }
                  }
                }
              } finally {
                tReader.releaseLock()
              }
              if (tContent && !signal.aborted) {
                try {
                  const cleaned = tContent.trim().replace(/^```json|```$/g, '').trim()
                  const parsed = JSON.parse(cleaned)
                  if (parsed.title) await renameSession(sessionId, parsed.title.trim())
                } catch {
                  await renameSession(sessionId, tContent.trim().substring(0, 40))
                }
              }
            }
          }
        } catch {}
      }

    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Chat error:', error)
        await addMessage(sessionId, {
          id: generateUUID(),
          role: 'assistant',
          content: `Error: ${error.message}`,
          timestamp: Date.now(),
        })
      }
    } finally {
      unsubscribe()
      stopGenerating(sessionId)
    }
  }, [])

  return { sendMessage }
}
