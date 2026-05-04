import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import path from 'path'
import fs from 'fs'
import { getDb } from '../db'
import { getProvider } from '../providers'
import { executeTool, listTools } from '../tools'
import { SpawnSubagentTool } from '../tools/subagent'
import { safeJsonParse } from '../utils/json'

const router = Router()
const spawnSubagentTool = new SpawnSubagentTool()
const DEFAULT_SUBAGENT_TOOL_TURNS = 6

const DEEP_RESEARCH_PROMPT = [
  'You are operating in Deep Research mode.',
  'Before answering, conduct thorough multi-step research using available tools.',
  'Make multiple targeted searches from diverse sources, inspect the most relevant materials, then synthesize the findings critically.',
  'Do not answer prematurely. Research first, then write the final synthesis with citations where available.'
].join(' ')

function buildEnhancedSystemPrompt(systemPrompt?: string, deepResearch?: boolean, extraInstructions?: string) {
  const dateStr = `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`
  const parts = [dateStr]
  if (systemPrompt) parts.push(systemPrompt)
  if (deepResearch) parts.push(DEEP_RESEARCH_PROMPT)
  if (extraInstructions) parts.push(extraInstructions)
  return parts.join('\n\n')
}

function countSourcesFromResult(result: string, name: string) {
  if (name === 'web_search') {
    const matches = result.match(/URL:\s*(https?:\/\/[^\s]+)/g)
    return matches ? matches.length : 0
  }
  if (name === 'read_url' || name === 'read_browser_page') {
    return 1
  }
  return 0
}

function extractSourceUrls(toolResults: Array<{ result: string }>) {
  const urls = new Set<string>()
  for (const toolResult of toolResults) {
    const matches = toolResult.result.match(/URL:\s*(https?:\/\/[^\s]+)/g)
    if (!matches) continue
    for (const match of matches) {
      const url = match.replace(/^URL:\s*/, '')
      urls.add(url)
    }
  }
  return Array.from(urls)
}

function normalizeToolArguments(name: string, rawArgs: any, sourceCount: number, defaultSearchProvider?: string, searchConfig?: Record<string, string>) {
  const parsedArgs = typeof rawArgs === 'string' ? safeJsonParse(rawArgs) : rawArgs
  if (name === 'web_search') {
    parsedArgs.provider = defaultSearchProvider || parsedArgs.provider
    parsedArgs.searchConfig = {
      searxngUrl: 'http://192.168.1.70:8888',
      ...(searchConfig || {}),
      ...(parsedArgs.searchConfig || {}),
    }
    if (!parsedArgs.searchConfig.searxngUrl) {
      parsedArgs.searchConfig.searxngUrl = 'http://192.168.1.70:8888'
    }
    parsedArgs.startIndex = sourceCount
  } else if (name === 'read_url' || name === 'read_browser_page') {
    parsedArgs.startIndex = sourceCount
  }
  return parsedArgs
}

function resolveToolDefinitions(disabledTools: string[], includeSubagentTool = false) {
  const baseTools = listTools().filter((tool) => !disabledTools.includes(tool.name) && tool.name !== spawnSubagentTool.name)
  if (includeSubagentTool) {
    baseTools.push(spawnSubagentTool.getSchema())
  }
  return baseTools.map((tool) => ({ ...tool, id: tool.name }))
}

async function runProviderToolLoop(options: {
  providerId: string
  model: string
  systemPrompt: string
  messages: any[]
  temperature?: number
  maxTokens?: number
  topP?: number
  reasoningEffort?: any
  disabledTools: string[]
  defaultSearchProvider?: string
  searchConfig?: Record<string, string>
  maxToolTurns?: number
  sessionId?: string
}) {
  const providerInstance = await getProvider(options.providerId)
  if (!providerInstance) {
    throw new Error(`Provider "${options.providerId}" not found or disabled`)
  }

  const configuredMaxToolTurns = options.maxToolTurns && options.maxToolTurns > 0
    ? options.maxToolTurns
    : DEFAULT_SUBAGENT_TOOL_TURNS
  const conversationMessages = [...options.messages]

  let finalContent = ''
  let finalThinking = ''
  let finalResponseId = ''
  let finalGenInfo: any = undefined
  let toolTurnCount = 0
  let allToolCalls: any[] = []
  let allToolResults: Array<{ toolCallId: string, name: string, result: string }> = []
  let hasToolCalls = false

  do {
    hasToolCalls = false

    const stream = providerInstance.chatCompletion({
      model: options.model,
      messages: [{ role: 'system', content: options.systemPrompt }, ...conversationMessages],
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      topP: options.topP,
      reasoningEffort: options.reasoningEffort,
      tools: resolveToolDefinitions(options.disabledTools, false),
      stream: true,
      sessionId: options.sessionId,
    })

    let turnContent = ''
    let turnThinking = ''
    let responseId = ''
    let generationInfo: any = undefined
    const turnToolCalls: any[] = []

    for await (const chunk of stream) {
      if (chunk.content) turnContent += chunk.content
      if (chunk.thinking) turnThinking += chunk.thinking
      if (chunk.responseId) responseId = chunk.responseId
      if (chunk.generationInfo) generationInfo = chunk.generationInfo
      if (chunk.toolCalls?.length) turnToolCalls.push(...chunk.toolCalls)
    }

    if (turnContent) finalContent += turnContent
    if (turnThinking) finalThinking = finalThinking ? `${finalThinking}\n\n${turnThinking}` : turnThinking
    if (responseId) finalResponseId = responseId
    if (generationInfo) finalGenInfo = generationInfo

    if (turnToolCalls.length === 0) {
      break
    }

    if (toolTurnCount >= configuredMaxToolTurns) {
      const limitMessage = `Stopped after ${configuredMaxToolTurns} subagent tool rounds.`
      finalContent = finalContent ? `${finalContent}\n\n${limitMessage}` : limitMessage
      break
    }

    hasToolCalls = true
    toolTurnCount += 1
    let currentSourceCount = allToolResults.reduce((count, result) => count + countSourcesFromResult(result.result, result.name), 0)
    const normalizedTurnToolCalls: any[] = []
    const turnResults: Array<{ toolCallId: string, name: string, result: string }> = []

    for (const toolCall of turnToolCalls) {
      const normalizedArguments = normalizeToolArguments(
        toolCall.name,
        toolCall.arguments,
        currentSourceCount,
        options.defaultSearchProvider,
        options.searchConfig,
      )
      normalizedTurnToolCalls.push({
        ...toolCall,
        arguments: normalizedArguments,
      })

      if (toolCall.name === spawnSubagentTool.name) {
        turnResults.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: 'Error: Subagents cannot spawn additional subagents.',
        })
        continue
      }

      try {
        const result = await executeTool(toolCall.name, normalizedArguments)
        turnResults.push({ toolCallId: toolCall.id, name: toolCall.name, result })
        currentSourceCount += countSourcesFromResult(result, toolCall.name)
      } catch (error: any) {
        turnResults.push({
          toolCallId: toolCall.id,
          name: toolCall.name,
          result: `Error: ${error.message}`,
        })
      }
    }

    conversationMessages.push({
      role: 'assistant',
      content: turnContent,
      thinking: turnThinking || undefined,
      toolCalls: normalizedTurnToolCalls,
    })
    turnResults.forEach((turnResult) => {
      conversationMessages.push({
        role: 'tool',
        content: '',
        toolResults: [turnResult],
      })
    })

    allToolCalls = [...allToolCalls, ...normalizedTurnToolCalls]
    allToolResults = [...allToolResults, ...turnResults]
  } while (hasToolCalls)

  return {
    content: finalContent,
    thinking: finalThinking,
    responseId: finalResponseId,
    generationInfo: finalGenInfo,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    toolTurnCount,
  }
}

async function runSubagentTask(req: Request) {
  const {
    arguments: rawArgs,
    model,
    provider,
    temperature,
    maxTokens,
    topP,
    reasoningEffort,
    disabledTools,
    defaultSearchProvider,
    searchConfig,
    maxToolTurns,
    subagentModel,
    subagentProvider,
    sessionId,
  } = req.body

  const parsedArgs = typeof rawArgs === 'string' ? safeJsonParse(rawArgs) : rawArgs
  const scope = String(parsedArgs.scope || parsedArgs.topic || parsedArgs.focus || 'general research').trim()
  const task = String(parsedArgs.task || parsedArgs.prompt || parsedArgs.query || '').trim()
  if (!task) {
    throw new Error('spawn_subagent requires a task')
  }

  const resolvedProvider = String(subagentProvider || provider || '').trim()
  const resolvedModel = String(subagentModel || model || '').trim()
  if (!resolvedProvider || !resolvedModel) {
    throw new Error('Subagent provider and model must resolve to valid values')
  }

  const subagentPrompt = [
    'You are a focused research subagent working for a larger orchestrator.',
    `Scope: ${scope}.`,
    `Task: ${task}.`,
    'Use tools aggressively but stay within the assigned scope.',
    'Return a concise research summary with the most important findings, caveats, and source-backed claims.',
  ].join(' ')

  const result = await runProviderToolLoop({
    providerId: resolvedProvider,
    model: resolvedModel,
    systemPrompt: buildEnhancedSystemPrompt(undefined, true, subagentPrompt),
    messages: [{ role: 'user', content: task }],
    temperature,
    maxTokens,
    topP,
    reasoningEffort,
    disabledTools: Array.isArray(disabledTools) ? disabledTools : [],
    defaultSearchProvider,
    searchConfig,
    maxToolTurns,
    sessionId: sessionId ? `${sessionId}:subagent:${scope}` : undefined,
  })

  return JSON.stringify({
    scope,
    task,
    summary: result.content || result.thinking || 'Subagent completed without a final summary.',
    toolTurns: result.toolTurnCount,
    sources: extractSourceUrls(result.toolResults),
    model: resolvedModel,
    provider: resolvedProvider,
  })
}

router.get('/sessions', async (_req, res) => {
  const db = await getDb()
  const sessions = await db.all('SELECT * FROM sessions ORDER BY updated_at DESC')
  res.json(sessions.map(s => ({
    ...s,
    createdAt: s.created_at,
    updatedAt: s.updated_at,
    systemPrompt: s.system_prompt,
    lastResponseId: s.last_response_id,
    messages: [],
  })))
})

router.get('/sessions/:id', async (req, res) => {
  const db = await getDb()
  const session = await db.get('SELECT * FROM sessions WHERE id = ?', req.params.id)
  if (!session) return res.status(404).json({ error: 'Session not found' })

  const messages = await db.all('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp', req.params.id)
  res.json({
    ...session,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    systemPrompt: session.system_prompt,
    lastResponseId: session.last_response_id,
    messages: messages.map((m: any) => ({
      ...m,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      toolResults: m.tool_results ? JSON.parse(m.tool_results) : undefined,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
      generationInfo: m.generation_info ? JSON.parse(m.generation_info) : undefined,
      timeline: m.timeline ? JSON.parse(m.timeline) : undefined,
    })),
  })
})

router.post('/sessions', async (req, res) => {
  const db = await getDb()
  const id = req.body.id || uuidv4()
  const { title, model, provider, systemPrompt } = req.body
  const now = Date.now()

  try {
    await db.run(
      'INSERT INTO sessions (id, title, model, provider, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id, title || 'New Chat', model, provider, systemPrompt || null, now, now
    )
    res.json({ id, title: title || 'New Chat', model, provider, systemPrompt, createdAt: now, updatedAt: now, messages: [] })
  } catch (error: any) {
    console.error('[api/chat] Failed to create session:', error)
    res.status(500).json({ error: 'Failed to create session' })
  }
})

router.delete('/sessions/:id', async (req, res) => {
  const db = await getDb()
  await db.run('DELETE FROM sessions WHERE id = ?', req.params.id)
  res.json({ success: true })
})

router.patch('/sessions/:id', async (req, res) => {
  const db = await getDb()
  const { title, lastResponseId, model, provider } = req.body
  const updates: string[] = []
  const values: any[] = []

  if (title !== undefined) {
    updates.push('title = ?')
    values.push(title)
  }
  if (lastResponseId !== undefined) {
    updates.push('last_response_id = ?')
    values.push(lastResponseId)
  }
  if (model !== undefined) {
    updates.push('model = ?')
    values.push(model)
  }
  if (provider !== undefined) {
    updates.push('provider = ?')
    values.push(provider)
  }
  if (updates.length === 0) {
    return res.json({ success: true })
  }

  updates.push('updated_at = ?')
  values.push(Date.now())
  values.push(req.params.id)

  await db.run(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`, values)
  res.json({ success: true })
})

router.post('/sessions/:id/messages', async (req, res) => {
  const db = await getDb()
  const { id: msgId, role, content, thinking, toolCalls, toolResults, attachments, generationInfo, timeline } = req.body
  const id = msgId || uuidv4()
  const timestamp = Date.now()

  try {
    await db.run(
      `INSERT INTO messages (id, session_id, role, content, thinking, tool_calls, tool_results, attachments, generation_info, timeline, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, req.params.id, role, content,
      thinking || null,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null,
      attachments ? JSON.stringify(attachments) : null,
      generationInfo ? JSON.stringify(generationInfo) : null,
      timeline ? JSON.stringify(timeline) : null,
      timestamp
    )
    await db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', Date.now(), req.params.id)
    res.json({ id, role, content, thinking, toolCalls, toolResults, attachments, generationInfo, timeline, timestamp })
  } catch (error: any) {
    console.error('[api/chat] Failed to save message:', error)
    res.status(500).json({ error: error.message || 'Failed to save message' })
  }
})

router.patch('/sessions/:sessionId/messages/:messageId', async (req, res) => {
  const db = await getDb()
  const { thinking, toolCalls, toolResults, attachments, generationInfo, content, timeline } = req.body
  const updates: string[] = []
  const values: any[] = []

  if (content !== undefined) {
    updates.push('content = ?')
    values.push(content)
  }
  if (thinking !== undefined) {
    updates.push('thinking = ?')
    values.push(thinking)
  }
  if (toolCalls !== undefined) {
    updates.push('tool_calls = ?')
    values.push(JSON.stringify(toolCalls))
  }
  if (toolResults !== undefined) {
    updates.push('tool_results = ?')
    values.push(JSON.stringify(toolResults))
  }
  if (attachments !== undefined) {
    updates.push('attachments = ?')
    values.push(JSON.stringify(attachments))
  }
  if (generationInfo !== undefined) {
    updates.push('generation_info = ?')
    values.push(JSON.stringify(generationInfo))
  }
  if (timeline !== undefined) {
    updates.push('timeline = ?')
    values.push(JSON.stringify(timeline))
  }
  if (updates.length === 0) {
    return res.json({ success: true })
  }

  values.push(req.params.messageId)
  await db.run(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`, values)
  res.json({ success: true })
})

router.get('/messages/:id/poll-cost', async (req, res) => {
  const db = await getDb()
  const { provider, responseId } = req.query
  const { id } = req.params

  if (!provider || !responseId) {
    return res.status(400).json({ error: 'Missing provider or responseId' })
  }

  try {
    const providerInstance = await getProvider(provider as string)
    if (!providerInstance || provider !== 'openrouter') {
      return res.status(400).json({ error: 'Invalid provider for cost polling' })
    }

    const apiKey = providerInstance.apiKey || process.env.OPENROUTER_API_KEY
    if (!apiKey) {
      return res.status(500).json({ error: 'Missing OpenRouter API key for cost polling' })
    }

    // Single poll attempt
    const statsRes = await fetch(`https://openrouter.ai/api/v1/generation?id=${responseId}`, {
      headers: { 'Authorization': `Bearer ${apiKey}` }
    })
    
    if (statsRes.ok) {
      const stats = await statsRes.json() as any
      const rawCost = stats.data?.total_cost ?? stats.total_cost ?? stats.data?.cost ?? stats.cost
      const foundCost = typeof rawCost === 'string' ? Number(rawCost) : rawCost
      if (typeof foundCost === 'number' && Number.isFinite(foundCost)) {
        // Update DB
        const msg = await db.get('SELECT generation_info FROM messages WHERE id = ?', id)
        if (msg) {
          const info = JSON.parse(msg.generation_info || '{}')
          info.totalCost = foundCost
          info.isGatheringCost = false
          await db.run('UPDATE messages SET generation_info = ? WHERE id = ?', JSON.stringify(info), id)
        }
        return res.json({ cost: foundCost })
      }
    }
    res.json({ cost: null })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

function getErrorStatusCode(errorMessage: string): number {
  const msg = errorMessage.toLowerCase()
  if (msg.includes('api key') || msg.includes('unauthorized') || msg.includes('authentication') || msg.includes('invalid_key')) {
    return 401
  }
  if (msg.includes('not found') || msg.includes('model') && msg.includes('does not exist')) {
    return 404
  }
  if (msg.includes('rate limit') || msg.includes('too many requests')) {
    return 429
  }
  if (msg.includes('bad request') || msg.includes('invalid')) {
    return 400
  }
  return 500
}

function getCleanErrorMessage(error: any, provider: string): string {
  let message = error.message || 'Unknown error'
  
  // Try to parse nested JSON error messages
  try {
    if (message.includes('{')) {
      const jsonStart = message.indexOf('{')
      const jsonStr = message.substring(jsonStart)
      const parsed = JSON.parse(jsonStr)
      const rawNested = parsed.error?.metadata?.raw
      if (typeof rawNested === 'string') {
        try {
          const nestedParsed = JSON.parse(rawNested)
          if (nestedParsed.error?.message) {
            message = nestedParsed.error.message
          }
        } catch {}
      }
      if (parsed.error?.message) {
        message = parsed.error.message
      }
    }
  } catch {}
  
  // Add provider context
  if (!message.toLowerCase().includes(provider.toLowerCase())) {
    message = `${provider}: ${message}`
  }
  
  return message
}

router.post('/completions', async (req, res) => {
  const { messages, model, provider, systemPrompt, temperature, maxTokens, topP, reasoningEffort, deepResearch, multiAgentEnabled, disabledTools, lastResponseId, sessionId } = req.body
    
    console.log(`[chat] /completions - Request: { model: "${model}", provider: "${provider}", sessionId: "${sessionId}" }`)

    try {
      const providerInstance = await getProvider(provider)
      if (!providerInstance) {
        console.error(`[chat] Provider "${provider}" not found or disabled in DB`)
        return res.status(404).json({ error: `Provider "${provider}" not found or disabled` })
      }
      
      console.log(`[chat] Using provider instance: ${providerInstance.name} (${providerInstance.type})`)
  
      const disabledToolNames = Array.isArray(disabledTools) ? (disabledTools as string[]) : []
      const allTools = resolveToolDefinitions(disabledToolNames, Boolean(multiAgentEnabled))

    const enhancedSystemPrompt = buildEnhancedSystemPrompt(systemPrompt, Boolean(deepResearch))

    // Process attachments: Read text files and append to message content
    const processedMessages = await Promise.all((messages || []).map(async (m: any) => {
      if (m.attachments && m.attachments.length > 0) {
        let content = m.content || ''
        const attachmentsToKeep = []

        for (const a of m.attachments) {
          // Resolve file path correctly relative to the uploads directory
          const filename = path.basename(a.url)
          
          // Check multiple potential locations for the uploads folder
          const possiblePaths = [
            path.resolve(process.cwd(), 'uploads', filename),
            path.resolve(process.cwd(), 'server', 'uploads', filename),
            path.resolve(__dirname, '../../uploads', filename),
            path.resolve(__dirname, '../../../uploads', filename)
          ]
          
          let filePath = possiblePaths.find(p => fs.existsSync(p))
          
          // List of text-based extensions to read
          const textExtensions = ['.txt', '.md', '.json', '.js', '.ts', '.tsx', '.css', '.html', '.py', '.c', '.cpp', '.rs', '.go', '.sh', '.yaml', '.yml']
          const ext = path.extname(a.name).toLowerCase()
          
          if (textExtensions.includes(ext) && filePath) {
            try {
              console.log(`[chat] Extracting text from ${a.name} (Path: ${filePath})`)
              const textContent = fs.readFileSync(filePath, 'utf-8')
              content += `\n\n[File Attachment: ${a.name}]\n\`\`\`${ext.slice(1) || 'text'}\n${textContent}\n\`\`\``
            } catch (err) {
              console.error(`[chat] Failed to read text file ${a.name}:`, err)
              attachmentsToKeep.push(a)
            }
          } else {
            if (textExtensions.includes(ext)) {
              console.warn(`[chat] Text file ${a.name} found but path could not be resolved. Tried:`, possiblePaths)
            }
            attachmentsToKeep.push(a)
          }
        }
        return { ...m, content, attachments: attachmentsToKeep }
      }
      return m
    }))

    const stream = providerInstance.chatCompletion({
      model,
      messages: [{ role: 'system', content: enhancedSystemPrompt }, ...processedMessages],
      temperature,
      maxTokens,
      topP,
      reasoningEffort,
      tools: allTools.length > 0 ? allTools : undefined,
      stream: true,
      lastResponseId,
      sessionId,
    })

    if (req.body.stream === false) {
      let fullContent = ''
      let fullThinking = ''
      let lastResponseId = ''
      let lastGenInfo = undefined

      for await (const chunk of stream) {
        if (chunk.content) fullContent += chunk.content
        if (chunk.thinking) fullThinking += chunk.thinking
        if (chunk.responseId) lastResponseId = chunk.responseId
        if (chunk.generationInfo) lastGenInfo = chunk.generationInfo
      }
      return res.json({ content: fullContent, thinking: fullThinking, responseId: lastResponseId, generationInfo: lastGenInfo })
    }

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    let headersSent = false
    for await (const chunk of stream) {
      if (!headersSent) {
        headersSent = true
      }
      try {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`)
      } catch {
        break
      }
    }

    if (headersSent && !res.writableEnded) {
      res.write('data: [DONE]\n\n')
      res.end()
    }
  } catch (error: any) {
    console.error(`[chat] ${provider} error:`, error.message)
    if (!res.headersSent) {
      const cleanMessage = getCleanErrorMessage(error, provider)
      const statusCode = getErrorStatusCode(cleanMessage)
      res.status(statusCode).json({ error: cleanMessage })
    } else {
      // Stream already started, send error as SSE event
      try {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`)
        res.write('data: [DONE]\n\n')
        res.end()
      } catch {}
    }
  }
})

router.post('/tool-call', async (req, res) => {
  const { name, arguments: args } = req.body
  try {
    if (name === spawnSubagentTool.name) {
      const result = await runSubagentTask(req)
      return res.json({ result })
    }
    const parsedArgs = typeof args === 'string' ? safeJsonParse(args) : args
    const result = await executeTool(name, parsedArgs)
    res.json({ result })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

export default router
