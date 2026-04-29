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
      setIsGenerating, 
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

    // Handle /skill command
    const skillCommandMatch = content.match(/^\/skill\s+(.+)$/i)
    if (skillCommandMatch) {
      const skillName = skillCommandMatch[1].trim()
      const skillContent = await loadSkillContent(skillName)
      if (skillContent) {
        useChatStore.getState().setActiveSkill(sessionId, skillName)
        const confirmMessage: Message = {
          id: generateUUID(),
          role: 'assistant',
          content: `Loaded skill: **${skillName}**\n\nThe skill context has been added to this conversation.`,
          timestamp: Date.now(),
        }
        await addMessage(sessionId, confirmMessage)
        return
      } else {
        const errorMessage: Message = {
          id: generateUUID(),
          role: 'assistant',
          content: `Skill not found: "${skillName}". Use \`/skill <name>\` to load a skill.`,
          timestamp: Date.now(),
        }
        await addMessage(sessionId, errorMessage)
        return
      }
    }

    // Handle /model command
    const modelCommandMatch = content.match(/^\/model\s+(.+)$/i)
    if (modelCommandMatch) {
      const arg = modelCommandMatch[1].trim()
      const { providers, selectedProvider: currentProviderId } = useSettingsStore.getState()
      
      // Try parsing provider/model format first
      let targetProvider = null
      let targetModel = arg
      
      const slashIdx = arg.indexOf('/')
      if (slashIdx > 0 && !arg.startsWith('/')) {
        const maybeProviderId = arg.slice(0, slashIdx)
        const maybeModel = arg.slice(slashIdx + 1)
        const matchedProvider = providers.find(p => p.id === maybeProviderId && p.models.includes(maybeModel))
        if (matchedProvider) {
          targetProvider = matchedProvider
          targetModel = maybeModel
        }
      }
      
      // If no provider prefix matched, try to find the model
      if (!targetProvider) {
        // Prefer current provider if it has the model
        const currentProvider = providers.find(p => p.id === currentProviderId)
        if (currentProvider && currentProvider.models.includes(arg)) {
          targetProvider = currentProvider
        } else {
          // Find first provider with this model
          targetProvider = providers.find(p => p.models.includes(arg))
        }
      }
      
      if (targetProvider) {
        useSettingsStore.getState().setSelectedModel(targetModel)
        useSettingsStore.getState().setSelectedProvider(targetProvider.id)
        const confirmMessage: Message = {
          id: generateUUID(),
          role: 'assistant',
          content: `Switched to model: **${targetModel}** (${targetProvider.name})`,
          timestamp: Date.now(),
        }
        await addMessage(sessionId, confirmMessage)
        return
      } else {
        const errorMessage: Message = {
          id: generateUUID(),
          role: 'assistant',
          content: `Model not found: "${arg}". Available models: ${providers.flatMap(p => p.models).join(', ')}`,
          timestamp: Date.now(),
        }
        await addMessage(sessionId, errorMessage)
        return
      }
    }

    const userMessage: Message = {
      id: generateUUID(),
      role: 'user',
      content,
      attachments,
      timestamp: Date.now(),
    }

    await addMessage(sessionId, userMessage)
    setIsGenerating(true)
    clearStreaming()

    try {
      let hasToolCalls = false

      do {
        hasToolCalls = false
        const session = useChatStore.getState().sessions.find(s => s.id === sessionId)
        const messages = session?.messages || []

        // Build enhanced system prompt with active skill
        let enhancedSystemPrompt = systemPrompt
        if (session?.activeSkill) {
          const skillContent = await loadSkillContent(session.activeSkill)
          if (skillContent) {
            enhancedSystemPrompt = `${systemPrompt}\n\n---\n\n## ACTIVE SKILL: ${session.activeSkill}\n\n${skillContent}`
          }
        }

        const response = await fetch('/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: messages.map(m => ({
              role: m.role,
              content: m.content,
              attachments: m.attachments,
              toolCalls: m.toolCalls,
              toolResults: m.toolResults,
            })),
            lastResponseId: session?.lastResponseId,
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

        if (!response.ok) {
          let errorMsg = `Request failed (${response.status})`
          try {
            const errData = await response.json()
            errorMsg = errData.error || errorMsg
          } catch {}
          throw new Error(errorMsg)
        }

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No response body')

        const decoder = new TextDecoder()
        let buffer = ''
        let fullContent = ''
        let fullThinking = ''
        let generationInfo: any = null
        let responseId: string | undefined = undefined

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6)
              if (data === '[DONE]') continue

              try {
                const parsed = JSON.parse(data)
                
                if (parsed.content) {
                  fullContent += parsed.content
                  appendStreamingContent(parsed.content)
                }
                
                if (parsed.thinking) {
                  fullThinking += parsed.thinking
                  appendStreamingThinking(parsed.thinking)
                }

                if (parsed.toolCalls) {
                  setActiveToolCalls(parsed.toolCalls)
                }

                if (parsed.generationInfo) {
                  generationInfo = parsed.generationInfo
                }

                if (parsed.responseId) {
                  responseId = parsed.responseId
                }
              } catch {}
            }
          }
        }

        const activeCalls = useChatStore.getState().activeToolCalls
        clearStreaming() // clear BEFORE adding to prevent duplicate flash
        const assistantMessage: Message = {
      id: generateUUID(),
          role: 'assistant',
          content: fullContent,
          thinking: fullThinking || undefined,
          toolCalls: activeCalls.length > 0 ? [...activeCalls] : undefined,
          generationInfo: generationInfo ? {
            ...generationInfo,
            model: selectedModel,
            provider: selectedProvider,
          } : undefined,
          responseId, // Store the response ID in the message
          timestamp: Date.now(),
        }

        await addMessage(sessionId, assistantMessage)
        if (responseId) {
          await useChatStore.getState().setSessionResponseId(sessionId, responseId)
        }

        if (activeCalls.length > 0) {
          hasToolCalls = true
          const toolResults = []

          // Calculate how many sources already exist in the session to provide continuous numbering
          const session = useChatStore.getState().sessions.find(s => s.id === sessionId)
          let currentSourceCount = 0
          session?.messages.forEach(m => {
            if (m.toolResults) {
              for (const tr of m.toolResults) {
                const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
                const matches = tr.result.match(urlRegex)
                if (matches) {
                  currentSourceCount += matches.length
                } else if (tr.name === 'read_url' || tr.name === 'read_browser_page') {
                  currentSourceCount += 1
                }
              }
            }
          })

          for (const tc of activeCalls) {
            try {
              let parsedArgs = typeof tc.arguments === 'string' ? JSON.parse(tc.arguments) : tc.arguments
              if (tc.name === 'web_search') {
                if (!parsedArgs.provider) {
                  parsedArgs.provider = defaultSearchProvider
                }
                parsedArgs.searchConfig = searchConfig
                parsedArgs.startIndex = currentSourceCount
              } else if (tc.name === 'read_url') {
                parsedArgs.startIndex = currentSourceCount
              }

              const res = await fetch('/api/chat/tool-call', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: tc.name, arguments: parsedArgs }),
              })
              const { result } = await res.json()
              toolResults.push({ toolCallId: tc.id, name: tc.name, result })

              // Update source count for subsequent tool calls in the same turn
              const urlRegex = /URL:\s*(https?:\/\/[^\s]+)/g
              const matches = result.match(urlRegex)
              if (matches) {
                currentSourceCount += matches.length
              } else if (tc.name === 'read_url' || tc.name === 'read_browser_page') {
                currentSourceCount += 1
              }
            } catch (err: any) {
              toolResults.push({ toolCallId: tc.id, name: tc.name, result: `Error executing tool: ${err.message}` })
            }
          }

          await useChatStore.getState().updateMessage(sessionId, assistantMessage.id, { toolResults })
          clearStreaming() // reset for the next loop iteration
        }
      } while (hasToolCalls)

      setIsGenerating(false)
      clearStreaming()

      // Auto-generate title if this is the first exchange
      const updatedSession = useChatStore.getState().sessions.find(s => s.id === sessionId)
      if (updatedSession && updatedSession.title === 'New Chat' && updatedSession.messages.length >= 2) {
        try {
          const titleResponse = await fetch('/api/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [
                ...updatedSession.messages.map(m => ({ role: m.role, content: m.content })),
                { role: 'user', content: 'Summarize this conversation. Return a JSON object with a "title" field containing a creative 3-5 word title. Return ONLY the JSON.' }
              ],
              model: selectedModel,
              provider: selectedProvider,
              stream: false,
            }),
          })
          if (titleResponse.ok) {
            const reader = titleResponse.body?.getReader()
            if (reader) {
              const decoder = new TextDecoder()
              let accumulatedResponse = ''
              while (true) {
                const { done, value } = await reader.read()
                if (done) break
                const chunk = decoder.decode(value)
                const lines = chunk.split('\n')
                for (const line of lines) {
                  if (line.startsWith('data: ')) {
                    try {
                      const data = JSON.parse(line.slice(6))
                      if (data.content) accumulatedResponse += data.content
                    } catch {}
                  }
                }
              }
              if (accumulatedResponse) {
                try {
                  const cleaned = accumulatedResponse.trim().replace(/^```json|```$/g, '').trim()
                  const parsed = JSON.parse(cleaned)
                  if (parsed.title) {
                    await renameSession(sessionId, parsed.title.trim())
                  }
                } catch (e) {
                  // Fallback if model failed to return valid JSON
                  await renameSession(sessionId, accumulatedResponse.trim().substring(0, 40))
                }
              }
            }
          }
        } catch (err) {
          console.error('Failed to generate title:', err)
        }
      }

    } catch (error: any) {
      console.error('Chat error:', error)
      const errorMessage: Message = {
        id: generateUUID(),
        role: 'assistant',
        content: `Error: ${error.message}`,
        timestamp: Date.now(),
      }
      await addMessage(sessionId, errorMessage)
    } finally {
      setIsGenerating(false)
      clearStreaming()
    }
  }, [])

  return { sendMessage }
}
