import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { mcpManager } from '../mcp/mcp-manager'

const router = Router()

// List all configured MCP servers with status
router.get('/servers', (_req, res) => {
  const servers = mcpManager.getServers()
  res.json(servers)
})

// Add a new MCP server
router.post('/servers', async (req, res) => {
  try {
    const { name, transport, command, args, url, env, autoConnect } = req.body

    if (!name || !transport) {
      return res.status(400).json({ error: 'name and transport are required' })
    }

    if (transport === 'stdio' && !command) {
      return res.status(400).json({ error: 'command is required for stdio transport' })
    }

    if (transport === 'sse' && !url) {
      return res.status(400).json({ error: 'url is required for sse transport' })
    }

    const config = {
      id: name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 16),
      name,
      transport,
      command: command || undefined,
      args: args || undefined,
      url: url || undefined,
      env: env || undefined,
      enabled: true,
      autoConnect: autoConnect !== false,
    }

    await mcpManager.addServer(config)

    // Auto-connect if requested
    if (config.autoConnect) {
      try {
        await mcpManager.connectServer(config.id)
      } catch (err: any) {
        // Don't fail the add, just report connection error
        console.error(`[mcp] Auto-connect failed for ${name}:`, err.message)
      }
    }

    const servers = mcpManager.getServers()
    const server = servers.find(s => s.config.id === config.id)
    res.json(server)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Remove an MCP server
router.delete('/servers/:id', async (req, res) => {
  try {
    await mcpManager.removeServer(req.params.id)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Connect to an MCP server
router.post('/servers/:id/connect', async (req, res) => {
  try {
    await mcpManager.connectServer(req.params.id)
    const servers = mcpManager.getServers()
    const server = servers.find(s => s.config.id === req.params.id)
    res.json(server)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// Disconnect from an MCP server
router.post('/servers/:id/disconnect', async (req, res) => {
  try {
    await mcpManager.disconnectServer(req.params.id)
    const servers = mcpManager.getServers()
    const server = servers.find(s => s.config.id === req.params.id)
    res.json(server)
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

// List tools from a specific server
router.get('/servers/:id/tools', (req, res) => {
  const tools = mcpManager.getServerTools(req.params.id)
  res.json(tools)
})

// List all MCP tools from all connected servers
router.get('/tools', (_req, res) => {
  const tools = mcpManager.getAllTools()
  res.json(tools)
})

// Get full mcp.json config
router.get('/config', (_req, res) => {
  res.json(mcpManager.getFullConfig())
})

// Update full mcp.json config
router.post('/config', async (req, res) => {
  try {
    const { mcpServers } = req.body
    if (!mcpServers || typeof mcpServers !== 'object') {
      return res.status(400).json({ error: 'Invalid config format. Expected { mcpServers: { ... } }' })
    }
    await mcpManager.replaceAllServers(mcpServers)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})

export default router
