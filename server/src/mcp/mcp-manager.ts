import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { getDb } from '../db'

export interface MCPServerConfig {
  id: string
  name: string
  transport: 'stdio' | 'sse'
  command?: string    // for stdio
  args?: string[]     // for stdio
  url?: string        // for sse
  env?: Record<string, string>
  enabled: boolean
  autoConnect: boolean
}

export interface MCPToolSchema {
  name: string           // namespaced: "mcp:serverId:toolName"
  description: string
  parameters: any
  serverId: string
  serverName: string
  originalName: string   // raw tool name from server
}

type ServerStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ManagedServer {
  config: MCPServerConfig
  client: Client | null
  status: ServerStatus
  error?: string
  tools: MCPToolSchema[]
}

class MCPManager {
  private servers: Map<string, ManagedServer> = new Map()

  async loadFromDb(): Promise<void> {
    const db = await getDb()
    const rows = await db.all('SELECT * FROM mcp_servers')

    for (const row of rows as any[]) {
      const config: MCPServerConfig = {
        id: row.id,
        name: row.name,
        transport: row.transport,
        command: row.command || undefined,
        args: row.args ? JSON.parse(row.args) : undefined,
        url: row.url || undefined,
        env: row.env ? JSON.parse(row.env) : undefined,
        enabled: !!row.enabled,
        autoConnect: !!row.auto_connect,
      }

      this.servers.set(config.id, {
        config,
        client: null,
        status: 'disconnected',
        tools: [],
      })

      if (config.enabled && config.autoConnect) {
        // Connect in background, don't block startup
        this.connectServer(config.id).catch(err => {
          console.error(`[mcp] Failed to auto-connect ${config.name}:`, err.message)
        })
      }
    }

    console.log(`[mcp] Loaded ${rows.length} server(s) from database`)
  }

  async addServer(config: MCPServerConfig): Promise<void> {
    const db = await getDb()
    await db.run(
      `INSERT INTO mcp_servers (id, name, transport, command, args, url, env, enabled, auto_connect)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      config.id,
      config.name,
      config.transport,
      config.command || null,
      config.args ? JSON.stringify(config.args) : null,
      config.url || null,
      config.env ? JSON.stringify(config.env) : null,
      config.enabled ? 1 : 0,
      config.autoConnect ? 1 : 0
    )

    this.servers.set(config.id, {
      config,
      client: null,
      status: 'disconnected',
      tools: [],
    })
  }

  async removeServer(id: string): Promise<void> {
    await this.disconnectServer(id)
    const db = await getDb()
    await db.run('DELETE FROM mcp_servers WHERE id = ?', id)
    this.servers.delete(id)
  }

  async connectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server) throw new Error(`MCP server ${id} not found`)
    if (server.status === 'connected') return

    server.status = 'connecting'
    server.error = undefined

    try {
      const client = new Client(
        { name: 'ai-chat-ui', version: '1.0.0' },
        { capabilities: {} }
      )

      let transport: any

      if (server.config.transport === 'stdio') {
        if (!server.config.command) {
          throw new Error('stdio transport requires a command')
        }
        transport = new StdioClientTransport({
          command: server.config.command,
          args: server.config.args || [],
          env: {
            ...process.env,
            ...(server.config.env || {}),
          } as Record<string, string>,
        })
      } else {
        if (!server.config.url) {
          throw new Error('SSE transport requires a URL')
        }
        transport = new StreamableHTTPClientTransport(
          new URL(server.config.url)
        )
      }

      await client.connect(transport)
      server.client = client
      server.status = 'connected'

      // Discover tools
      await this.refreshTools(id)

      console.log(`[mcp] Connected to ${server.config.name} (${server.tools.length} tools)`)
    } catch (err: any) {
      server.status = 'error'
      server.error = err.message
      server.client = null
      throw err
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id)
    if (!server || !server.client) return

    try {
      await server.client.close()
    } catch {
      // Ignore close errors
    }

    server.client = null
    server.status = 'disconnected'
    server.tools = []
    console.log(`[mcp] Disconnected from ${server.config.name}`)
  }

  async refreshTools(id: string): Promise<MCPToolSchema[]> {
    const server = this.servers.get(id)
    if (!server?.client) throw new Error(`Server ${id} not connected`)

    const result = await server.client.listTools()

    server.tools = (result.tools || []).map((t: any) => ({
      name: `mcp:${id}:${t.name}`,
      description: t.description || '',
      parameters: t.inputSchema || { type: 'object', properties: {} },
      serverId: id,
      serverName: server.config.name,
      originalName: t.name,
    }))

    return server.tools
  }

  getAllTools(): MCPToolSchema[] {
    const tools: MCPToolSchema[] = []
    for (const server of this.servers.values()) {
      if (server.status === 'connected') {
        tools.push(...server.tools)
      }
    }
    return tools
  }

  async callTool(namespacedName: string, args: Record<string, unknown>): Promise<string> {
    // Parse "mcp:serverId:toolName"
    const parts = namespacedName.split(':')
    if (parts.length < 3 || parts[0] !== 'mcp') {
      throw new Error(`Invalid MCP tool name: ${namespacedName}`)
    }

    const serverId = parts[1]
    const toolName = parts.slice(2).join(':') // Handle tool names with colons

    const server = this.servers.get(serverId)
    if (!server?.client) {
      throw new Error(`MCP server ${serverId} is not connected`)
    }

    const result = await server.client.callTool({
      name: toolName,
      arguments: args,
    })

    // Convert result to string
    if (result.content && Array.isArray(result.content)) {
      return result.content
        .map((c: any) => {
          if (c.type === 'text') return c.text
          if (c.type === 'image') return `[Image: ${c.mimeType}]`
          return JSON.stringify(c)
        })
        .join('\n')
    }

    return JSON.stringify(result)
  }

  getServers(): Array<{
    config: MCPServerConfig
    status: ServerStatus
    error?: string
    toolCount: number
  }> {
    return Array.from(this.servers.values()).map(s => ({
      config: s.config,
      status: s.status,
      error: s.error,
      toolCount: s.tools.length,
    }))
  }

  getServerTools(id: string): MCPToolSchema[] {
    return this.servers.get(id)?.tools || []
  }

  isMCPTool(name: string): boolean {
    return name.startsWith('mcp:')
  }
}

// Singleton
export const mcpManager = new MCPManager()
