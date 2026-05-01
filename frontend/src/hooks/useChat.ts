import { useCallback } from 'react'
import { useChatStore, generateUUID } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { Message, Attachment, ToolCall, ToolResult } from '../stores/chatStore'
import { getToolDisplay } from '../lib/toolDisplay'
import { useUIStore } from '../stores/uiStore'

function safeJsonParse(json: string): any {
  try { return JSON.parse(json) } catch {
    let s = json.trim()
    if (!s) return {}
    // Strip trailing broken escapes
    while (s.endsWith('\\')) s = s.slice(0, -1)
    // Find and close unterminated strings
    let inStr = false, esc = false, lastQuoteIdx = -1
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; lastQuoteIdx = i }
    }
    if (inStr && lastQuoteIdx >= 0) s = s.slice(0, lastQuoteIdx) + '"'
    // Remove trailing commas
    s = s.replace(/,\s*([}\]])/g, '$1')
    // Close open brackets
    let openBraces = 0, openBrackets = 0
    inStr = false; esc = false
    for (let i = 0; i < s.length; i++) {
      const c = s[i]
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') { inStr = !inStr; continue }
      if (inStr) continue
      if (c === '{') openBraces++
      else if (c === '}') openBraces--
      else if (c === '[') openBrackets++
      else if (c === ']') openBrackets--
    }
    while (openBrackets > 0) { s += ']'; openBrackets-- }
    while (openBraces > 0) { s += '}'; openBraces-- }
    try { return JSON.parse(s) } catch {
      // Last resort: extract the outermost JSON object
      let depth = 0, start = -1
      inStr = false; esc = false
      for (let i = 0; i < json.length; i++) {
        const c = json[i]
        if (esc) { esc = false; continue }
        if (c === '\\') { esc = true; continue }
        if (c === '"') { inStr = !inStr; continue }
        if (inStr) continue
        if (c === '{') { if (depth === 0) start = i; depth++ }
        else if (c === '}') { depth--; if (depth === 0 && start >= 0) {
          try { return JSON.parse(json.slice(start, i + 1)) } catch {}
        }}
      }
      throw new Error(`Invalid JSON: ${json.slice(0, 100)}`)
    }
  }
}

function createChildAbortController(parentSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs / 1000}s`)), timeoutMs)
  const abort = () => controller.abort(parentSignal.reason)

  if (parentSignal.aborted) {
    abort()
  } else {
    parentSignal.addEventListener('abort', abort, { once: true })
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      window.clearTimeout(timeout)
      parentSignal.removeEventListener('abort', abort)
    },
  }
}

export function useChat() {
  const { 
    currentSessionId, 
    addMessage, 
    startGenerating,
    stopGenerating,
    clearStreaming, 
    appendStreamingContent, 
    setStreamingContent,
    appendStreamingThinking,
    setActiveToolCalls,
    updateMessage,
    sessions,
    updateSessionModel,
    setActiveSkill,
    clearMessages
  } = useChatStore()

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
    maxToolTurns,
    setSelectedModel,
    setSelectedProvider
  } = useSettingsStore()

  const runCompletion = useCallback(async (sessionId: string) => {
    const abortController = new AbortController()
    const signal = abortController.signal

    const unsubscribe = useChatStore.subscribe((state) => {
      const exists = state.sessions.some(s => s.id === sessionId)
      if (!exists) abortController.abort()
    })

    try {
      startGenerating(sessionId)
      let hasToolCalls = false
      let allToolCalls: ToolCall[] = []
      let allToolResults: ToolResult[] = []
      let finalContent = ''
      let finalThinking = ''
      let finalResponseId = ''
      let finalGenInfo: any = undefined
      let messageId = generateUUID()
      let toolTurnCount = 0
      const configuredMaxToolTurns = maxToolTurns ?? 0
      
      do {
        hasToolCalls = false
        const latestSession = useChatStore.getState().sessions.find(s => s.id === sessionId)
        if (!latestSession) break

        const chatMessages = latestSession.messages.filter(m => {
           if (m.role === 'user') return true
           if (m.role === 'assistant') return m.metadata?.active !== false
           return true
        })
        
        const currentModel = latestSession.model || selectedModel
        const currentProvider = latestSession.provider || selectedProvider

        const apiMessages = chatMessages.map(m => ({
          role: m.role, content: m.content, thinking: m.thinking, toolCalls: m.toolCalls, toolResults: m.toolResults
        }))

        if (allToolCalls.length > 0) {
          apiMessages.push({
            role: 'assistant',
            content: finalContent,
            thinking: finalThinking || undefined,
            toolCalls: allToolCalls,
            toolResults: allToolResults
          } as any)
        }

        const response = await fetch('/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            messages: apiMessages,
            model: currentModel,
            provider: currentProvider,
            systemPrompt: latestSession.systemPrompt || systemPrompt,
            temperature,
            maxTokens,
            topP,
            stream: streamResponses,
            tools: tools.filter(t => t.enabled).map(t => t.name),
            sessionId: sessionId,
          }),
        })

        if (!response.ok) throw new Error(await response.text())

        let turnContent = ''
        let turnThinking = ''
        let responseId = ''
        let generationInfo = undefined

        const reader = response.body?.getReader()
        if (!reader) throw new Error('No reader available')

        const decoder = new TextDecoder()
        let buffer = ''
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
                let parsed: any
                try {
                  parsed = JSON.parse(data)
                } catch {
                  continue
                }
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
                if (parsed.content) {
                  turnContent += parsed.content
                  appendStreamingContent(sessionId, parsed.content)
                }
                if (parsed.thinking) {
                  turnThinking += parsed.thinking
                  appendStreamingThinking(sessionId, parsed.thinking)
                }
                if (parsed.toolCalls) setActiveToolCalls(sessionId, [...allToolCalls, ...parsed.toolCalls])
                if (parsed.responseId) responseId = parsed.responseId
                if (parsed.generationInfo) generationInfo = parsed.generationInfo
              }
            }
          }
        } finally {
          const tail = buffer.trim()
          if (tail.startsWith('data: ')) {
            const data = tail.slice(6)
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data)
                if (parsed.error) {
                  throw new Error(parsed.error)
                }
                if (parsed.content) {
                  turnContent += parsed.content
                  appendStreamingContent(sessionId, parsed.content)
                }
                if (parsed.thinking) {
                  turnThinking += parsed.thinking
                  appendStreamingThinking(sessionId, parsed.thinking)
                }
                if (parsed.toolCalls) setActiveToolCalls(sessionId, [...allToolCalls, ...parsed.toolCalls])
                if (parsed.responseId) responseId = parsed.responseId
                if (parsed.generationInfo) generationInfo = parsed.generationInfo
              } catch {}
            }
          }
          reader.releaseLock()
        }

        const streamState = useChatStore.getState().streaming[sessionId]
        const currentToolCalls = streamState?.toolCalls || []
        const activeCalls = currentToolCalls.filter(tc => !allToolCalls.some(a => a.id === tc.id))

        // Accumulate across turns
        if (activeCalls.length > 0) {
          setStreamingContent(sessionId, finalContent)
        } else {
          finalContent += turnContent
        }
        if (turnThinking) {
          finalThinking = finalThinking ? finalThinking + '\n\n' + turnThinking : turnThinking
        }
        if (responseId) finalResponseId = responseId
        if (generationInfo) finalGenInfo = generationInfo
        allToolCalls = [...allToolCalls, ...activeCalls]

        if (useChatStore.getState().sessions.some(s => s.id === sessionId)) {
          if (activeCalls.length > 0 && configuredMaxToolTurns > 0 && toolTurnCount >= configuredMaxToolTurns) {
            const finalStoreState = useChatStore.getState().streaming[sessionId]
            const finalTimeline = finalStoreState?.timeline ? [...finalStoreState.timeline] : []
            const limitMessage = `Stopped after ${configuredMaxToolTurns} consecutive tool-call turns. The model kept requesting tools instead of answering.`
            finalContent = finalContent ? `${finalContent}\n\n${limitMessage}` : limitMessage
            stopGenerating(sessionId)
            await addMessage(sessionId, {
              id: messageId,
              role: 'assistant',
              content: finalContent,
              thinking: finalThinking || undefined,
              toolCalls: allToolCalls.length > 0 ? [...allToolCalls] : undefined,
              toolResults: allToolResults.length > 0 ? [...allToolResults] : undefined,
              timeline: finalTimeline.length > 0 ? finalTimeline : undefined,
              responseId: finalResponseId,
              generationInfo: finalGenInfo,
              timestamp: Date.now(),
              metadata: { active: true }
            })
            if (useUIStore.getState().activeActivityMessageId === 'streaming') {
              useUIStore.getState().setActiveActivityMessageId(messageId)
            }
            break
          }

          if (activeCalls.length === 0) {
            // Final turn - capture timeline from store then stop
            const finalStoreState = useChatStore.getState().streaming[sessionId]
            const finalTimeline = finalStoreState?.timeline ? [...finalStoreState.timeline] : []
            stopGenerating(sessionId)
            const assistantMessage: Message = {
              id: messageId,
              role: 'assistant',
              content: finalContent,
              thinking: finalThinking || undefined,
              toolCalls: allToolCalls.length > 0 ? [...allToolCalls] : undefined,
              toolResults: allToolResults.length > 0 ? [...allToolResults] : undefined,
              timeline: finalTimeline.length > 0 ? finalTimeline : undefined,
              responseId: finalResponseId,
              generationInfo: finalGenInfo,
              timestamp: Date.now(),
              metadata: { active: true }
            }
            await addMessage(sessionId, assistantMessage)
            if (useUIStore.getState().activeActivityMessageId === 'streaming') {
              useUIStore.getState().setActiveActivityMessageId(messageId)
            }
          } else {
            // More turns coming - execute tools but preserve timeline
            hasToolCalls = true
            toolTurnCount += 1
            const toolResults = []
            let currentSourceCount = 0
            const sessionForTools = useChatStore.getState().sessions.find(s => s.id === sessionId)
            sessionForTools?.messages.forEach(m => {
              if (m.toolResults) m.toolResults.forEach(tr => {
                if (tr.name === 'web_search') {
                  const matches = tr.result.match(/URL:\s*(https?:\/\/[^\s]+)/g)
                  if (matches) currentSourceCount += matches.length
                } else if (tr.name === 'read_url' || tr.name === 'read_browser_page') currentSourceCount += 1
              })
            })

            for (const tc of activeCalls) {
              if (signal.aborted) break
              try {
                let parsedArgs = typeof tc.arguments === 'string' ? safeJsonParse(tc.arguments) : tc.arguments
                if (tc.name === 'web_search') {
                  parsedArgs.provider = defaultSearchProvider
                  parsedArgs.searchConfig = {
                    searxngUrl: 'http://192.168.1.70:8888',
                    ...searchConfig,
                  }
                  if (!parsedArgs.searchConfig.searxngUrl) {
                    parsedArgs.searchConfig.searxngUrl = 'http://192.168.1.70:8888'
                  }
                  parsedArgs.startIndex = currentSourceCount
                } else if (tc.name === 'read_url') parsedArgs.startIndex = currentSourceCount

                allToolCalls = allToolCalls.map(call =>
                  call.id === tc.id ? { ...call, arguments: parsedArgs, display: getToolDisplay(tc.name, parsedArgs) } : call
                )
                useChatStore.getState().setActiveToolCalls(sessionId, allToolCalls)

                const toolRequest = createChildAbortController(signal, 20000)
                let res: Response
                try {
                  res = await fetch('/api/chat/tool-call', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: toolRequest.signal,
                    body: JSON.stringify({ name: tc.name, arguments: parsedArgs }),
                  })
                } finally {
                  toolRequest.cleanup()
                }
                const data = await res.json()
                const result = res.ok ? data.result : `Error: ${data.error || res.statusText}`
                toolResults.push({ toolCallId: tc.id, name: tc.name, result })
                useChatStore.getState().setActiveToolResults(sessionId, [...allToolResults, ...toolResults])
                
                if (tc.name === 'web_search') {
                  const matches = result.match(/URL:\s*(https?:\/\/[^\s]+)/g)
                  if (matches) currentSourceCount += matches.length
                } else if (tc.name === 'read_url' || tc.name === 'read_browser_page') currentSourceCount += 1
              } catch (err: any) {
                toolResults.push({ toolCallId: tc.id, name: tc.name, result: `Error: ${err.message}` })
                useChatStore.getState().setActiveToolResults(sessionId, [...allToolResults, ...toolResults])
              }
            }
            allToolResults = [...allToolResults, ...toolResults]
            // Keep the live stream state intact between tool rounds so open process
            // panels and already-rendered tool results do not collapse or remount.
            useChatStore.getState().setActiveToolCalls(sessionId, allToolCalls)
            useChatStore.getState().setActiveToolResults(sessionId, allToolResults)
          }
        }
      } while (hasToolCalls && !signal.aborted)
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        console.error('Chat error:', error)
        addMessage(sessionId, { id: generateUUID(), role: 'assistant', content: `Error: ${error.message}`, timestamp: Date.now() })
      }
    } finally {
      unsubscribe()
      stopGenerating(sessionId)
    }
  }, [selectedModel, selectedProvider, systemPrompt, temperature, maxTokens, topP, streamResponses, tools, defaultSearchProvider, searchConfig, maxToolTurns, addMessage, startGenerating, stopGenerating, clearStreaming, appendStreamingContent, setStreamingContent, appendStreamingThinking, setActiveToolCalls, updateMessage])

  const sendMessage = useCallback(async (content: string, attachments?: Attachment[]) => {
    let sessionId = currentSessionId
    if (!sessionId) sessionId = await useChatStore.getState().createSession(selectedModel, selectedProvider)
    
    // Intercept slash commands
    if (content.startsWith('/')) {
      const parts = content.split(' ')
      const command = parts[0].slice(1).toLowerCase()
      const args = parts.slice(1).join(' ').trim()

      if (command === 'model' && args) {
        // Find the provider and model by splitting at the first slash
        const slashIdx = args.indexOf('/')
        if (slashIdx !== -1) {
          const provider = args.slice(0, slashIdx)
          const model = args.slice(slashIdx + 1)
          
          updateSessionModel(sessionId, model, provider)
          setSelectedProvider(provider)
          setSelectedModel(model)
          
          // Force a server sync for the session model
          await fetch(`/api/chat/sessions/${sessionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, provider }),
          })

          addMessage(sessionId, { 
            id: generateUUID(), 
            role: 'system', 
            content: `Model changed to ${model} (${provider})`, 
            timestamp: Date.now(),
            metadata: { active: true }
          })
          return
        }
      } else if (command === 'skill' && args) {
        setActiveSkill(sessionId, args)
        addMessage(sessionId, { 
          id: generateUUID(), 
          role: 'system', 
          content: `Skill loaded: ${args}`, 
          timestamp: Date.now(),
          metadata: { active: true }
        })
        return
      } else if (command === 'clear') {
        clearMessages(sessionId)
        return
      }
    }

    const userMessage: Message = {
      id: generateUUID(),
      role: 'user',
      content,
      attachments,
      timestamp: Date.now(),
      metadata: { active: true }
    }
    await addMessage(sessionId, userMessage)

    await runCompletion(sessionId)

    // Auto-naming for new sessions (after completion to avoid concurrent LM Studio requests)
    const session2 = useChatStore.getState().sessions.find(s => s.id === sessionId)
    if (session2 && (session2.title === 'New Chat' || !session2.title)) {
      try {
        const res = await fetch('/api/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: [
              { role: 'system', content: 'You are a title generator. Output ONLY the title text. No quotes, no explanations, no markdown, no numbers, no bullet points.' },
              { role: 'user', content: `Create a short 2-5 word title for this chat: ${content}` }
            ],
            model: (session2.model && session2.model !== 'default-model') ? session2.model : selectedModel,
            provider: (session2.provider && session2.provider !== 'default-provider') ? session2.provider : selectedProvider,
            temperature: 0.3,
            maxTokens: 9999,
            stream: false
          }),
        })
        if (res.ok) {
          const data = await res.json()
          let rawTitle = data.content || data.thinking || ''
          let title = rawTitle
            .replace(/^["'`]+|["'`]+$/g, '')
            .replace(/^Title:\s*/i, '')
            .replace(/^\d+\.\s*/, '')
            .replace(/\*\*(.+?)\*\*/, '$1')
            .split('\n')[0]
            .trim()
          if (title && title.length > 2 && title.length < 100) {
            if (title.length > 40) title = title.slice(0, 40) + '...'
            await useChatStore.getState().renameSession(sessionId, title)
          }
        } else {
          console.error('[auto-name] Request failed:', res.status, await res.text())
        }
      } catch (err) {
        console.error('[auto-name] Failed:', err)
      }
    }
  }, [currentSessionId, addMessage, runCompletion, updateSessionModel, setActiveSkill, setSelectedModel, setSelectedProvider, clearMessages, selectedModel, selectedProvider])

  const regenerateMessage = useCallback(async (messageId: string) => {
    if (!currentSessionId) return
    const session = sessions.find(s => s.id === currentSessionId)
    if (!session) return

    const messageIndex = session.messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) return

    let userMsgIndex = -1
    for (let i = messageIndex; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        userMsgIndex = i
        break
      }
    }
    if (userMsgIndex === -1) return

    const turnId = session.messages[userMsgIndex].id
    for (let i = userMsgIndex + 1; i < session.messages.length; i++) {
        const m = session.messages[i]
        if (m.role === 'assistant') {
            await updateMessage(currentSessionId, m.id, { metadata: { ...m.metadata, active: false, turnId } })
        }
    }
    
    await runCompletion(currentSessionId)
  }, [currentSessionId, sessions, runCompletion, updateMessage])

  return { sendMessage, regenerateMessage }
}
