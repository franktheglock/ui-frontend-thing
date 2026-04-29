import { Router, Request, Response } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getDb } from '../db'
import { getProvider } from '../providers'
import { executeTool, listTools } from '../tools'

const router = Router()

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
    })),
  })
})

router.post('/sessions', async (req, res) => {
  const db = await getDb()
  const id = req.body.id || uuidv4()
  const { title, model, provider, systemPrompt } = req.body
  const now = Date.now()

  await db.run(
    'INSERT INTO sessions (id, title, model, provider, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    id, title || 'New Chat', model, provider, systemPrompt || null, now, now
  )

  res.json({ id, title: title || 'New Chat', model, provider, systemPrompt, createdAt: now, updatedAt: now, messages: [] })
})

router.delete('/sessions/:id', async (req, res) => {
  const db = await getDb()
  await db.run('DELETE FROM sessions WHERE id = ?', req.params.id)
  res.json({ success: true })
})

router.patch('/sessions/:id', async (req, res) => {
  const db = await getDb()
  const { title, lastResponseId } = req.body
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
  const { id: msgId, role, content, thinking, toolCalls, toolResults, attachments, generationInfo } = req.body
  const id = msgId || uuidv4()
  const timestamp = Date.now()

  await db.run(
    `INSERT INTO messages (id, session_id, role, content, thinking, tool_calls, tool_results, attachments, generation_info, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, req.params.id, role, content,
    thinking || null,
    toolCalls ? JSON.stringify(toolCalls) : null,
    toolResults ? JSON.stringify(toolResults) : null,
    attachments ? JSON.stringify(attachments) : null,
    generationInfo ? JSON.stringify(generationInfo) : null,
    timestamp
  )

  await db.run('UPDATE sessions SET updated_at = ? WHERE id = ?', Date.now(), req.params.id)
  res.json({ id, role, content, thinking, toolCalls, toolResults, attachments, generationInfo, timestamp })
})

router.patch('/sessions/:sessionId/messages/:messageId', async (req, res) => {
  const db = await getDb()
  const { thinking, toolCalls, toolResults, attachments, generationInfo, content } = req.body
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
  if (updates.length === 0) {
    return res.json({ success: true })
  }

  values.push(req.params.messageId)
  await db.run(`UPDATE messages SET ${updates.join(', ')} WHERE id = ?`, values)
  res.json({ success: true })
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
  const { messages, model, provider, systemPrompt, temperature, maxTokens, topP, tools, lastResponseId } = req.body
  
  try {
    const providerInstance = await getProvider(provider)
    if (!providerInstance) {
      return res.status(404).json({ error: `Provider "${provider}" not found or disabled` })
    }

    const allTools = listTools()

    const stream = providerInstance.chatCompletion({
      model,
      messages: systemPrompt ? [{ role: 'system', content: systemPrompt }, ...messages] : messages,
      temperature,
      maxTokens,
      topP,
      tools: allTools.length > 0 ? allTools.map(t => ({ ...t, id: t.name })) : undefined,
      stream: true,
      lastResponseId,
    })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    for await (const chunk of stream) {
      res.write(`data: ${JSON.stringify(chunk)}\n\n`)
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (error: any) {
    console.error(`[chat] ${provider} error:`, error.message)
    const cleanMessage = getCleanErrorMessage(error, provider)
    const statusCode = getErrorStatusCode(cleanMessage)
    res.status(statusCode).json({ error: cleanMessage })
  }
})

router.post('/tool-call', async (req, res) => {
  const { name, arguments: args } = req.body
  try {
    const parsedArgs = typeof args === 'string' ? JSON.parse(args) : args
    const result = await executeTool(name, parsedArgs)
    res.json({ result })
  } catch (error: any) {
    res.status(500).json({ error: error.message })
  }
})

export default router
