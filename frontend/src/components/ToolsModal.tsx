import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Wrench, Search, Globe, ToggleLeft, ToggleRight,
  Plus, Trash2, Plug, Unplug, ChevronDown, ChevronRight, Loader2, AlertCircle
} from 'lucide-react'
import { useUIStore } from '../stores/uiStore'
import { useSettingsStore } from '../stores/settingsStore'
import { cn } from '../lib/utils'

interface BackendTool {
  name: string
  description: string
  parameters: any
}

interface MCPServer {
  config: {
    id: string
    name: string
    transport: 'stdio' | 'sse'
    command?: string
    args?: string[]
    url?: string
  }
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string
  toolCount: number
}

interface MCPTool {
  name: string
  description: string
  originalName: string
  serverName: string
}

export function ToolsModal() {
  const { toolSelectorOpen, setToolSelectorOpen } = useUIStore()
  const {
    tools,
    addTool,
    updateTool,
    defaultSearchProvider,
    setDefaultSearchProvider,
    searchConfig,
    setSearchConfig,
  } = useSettingsStore()

  const [backendTools, setBackendTools] = useState<BackendTool[]>([])
  const [mcpServers, setMcpServers] = useState<MCPServer[]>([])
  const [showAddForm, setShowAddForm] = useState(false)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const [serverTools, setServerTools] = useState<Record<string, MCPTool[]>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  // Add form state
  const [newName, setNewName] = useState('')
  const [newTransport, setNewTransport] = useState<'stdio' | 'sse'>('stdio')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [newUrl, setNewUrl] = useState('')

  const refresh = () => {
    fetch('/api/tools')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // Filter out MCP tools (they show under their server)
          setBackendTools(data.filter((t: any) => !t.name?.startsWith('mcp:')))
          // Sync local tool configs
          for (const bt of data) {
            if (!bt.name?.startsWith('mcp:') && !tools.find(t => t.name === bt.name)) {
              addTool({ id: bt.name, name: bt.name, enabled: true, config: {} })
            }
          }
        }
      })
      .catch(console.error)

    fetch('/api/mcp/servers')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) setMcpServers(data)
      })
      .catch(console.error)
  }

  useEffect(() => {
    if (toolSelectorOpen) refresh()
  }, [toolSelectorOpen])

  const loadServerTools = async (serverId: string) => {
    try {
      const res = await fetch(`/api/mcp/servers/${serverId}/tools`)
      const data = await res.json()
      if (Array.isArray(data)) {
        setServerTools(prev => ({ ...prev, [serverId]: data }))
      }
    } catch {}
  }

  const toggleExpand = (serverId: string) => {
    if (expandedServer === serverId) {
      setExpandedServer(null)
    } else {
      setExpandedServer(serverId)
      loadServerTools(serverId)
    }
  }

  const handleAddServer = async () => {
    if (!newName) return
    setActionLoading('add')
    try {
      await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          transport: newTransport,
          command: newTransport === 'stdio' ? newCommand : undefined,
          args: newTransport === 'stdio' && newArgs ? newArgs.split(' ') : undefined,
          url: newTransport === 'sse' ? newUrl : undefined,
          autoConnect: true,
        }),
      })
      setNewName('')
      setNewCommand('')
      setNewArgs('')
      setNewUrl('')
      setShowAddForm(false)
      refresh()
    } catch (err: any) {
      console.error('Failed to add server:', err)
    }
    setActionLoading(null)
  }

  const handleConnect = async (id: string) => {
    setActionLoading(id)
    try {
      await fetch(`/api/mcp/servers/${id}/connect`, { method: 'POST' })
      refresh()
    } catch {}
    setActionLoading(null)
  }

  const handleDisconnect = async (id: string) => {
    setActionLoading(id)
    try {
      await fetch(`/api/mcp/servers/${id}/disconnect`, { method: 'POST' })
      refresh()
    } catch {}
    setActionLoading(null)
  }

  const handleRemove = async (id: string) => {
    try {
      await fetch(`/api/mcp/servers/${id}`, { method: 'DELETE' })
      refresh()
    } catch {}
  }

  if (!toolSelectorOpen) return null

  const isToolEnabled = (name: string) => {
    const t = tools.find(t => t.name === name)
    return t ? t.enabled : true
  }

  const toggleTool = (name: string) => {
    const t = tools.find(t => t.name === name)
    if (t) {
      updateTool(t.id, { enabled: !t.enabled })
    } else {
      addTool({ id: name, name, enabled: false, config: {} })
    }
  }

  const toolIcons: Record<string, React.ReactNode> = {
    web_search: <Search className="w-4 h-4" />,
    read_url: <Globe className="w-4 h-4" />,
  }

  const searchProviders = [
    { id: 'searxng' as const, name: 'SearXNG', description: 'Self-hosted meta search' },
    { id: 'duckduckgo' as const, name: 'DuckDuckGo', description: 'Privacy-focused search' },
    { id: 'brave' as const, name: 'Brave', description: 'API key required' },
    { id: 'google' as const, name: 'Google', description: 'API key required' },
    { id: 'parallel' as const, name: 'Parallel', description: 'AI-native search API' },
    { id: 'exa' as const, name: 'Exa', description: 'Neural search for LLMs' },
    { id: 'tavily' as const, name: 'Tavily', description: 'AI search engine' },
  ]

  const statusColors: Record<string, string> = {
    connected: 'bg-green-500',
    connecting: 'bg-yellow-500 animate-pulse',
    disconnected: 'bg-zinc-500',
    error: 'bg-red-500',
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
        onClick={() => setToolSelectorOpen(false)}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          transition={{ duration: 0.2 }}
          className="bg-background border border-border rounded-sm shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-accent" />
              <h2 className="text-lg font-display font-semibold">Tools & MCP</h2>
            </div>
            <button
              onClick={() => setToolSelectorOpen(false)}
              className="p-1.5 hover:bg-secondary rounded-sm transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Built-in Tools */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Built-in Tools</h3>
              <div className="space-y-2">
                {backendTools.map(bt => (
                  <div
                    key={bt.name}
                    className="flex items-center justify-between p-3 bg-secondary/30 border border-border rounded-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-sm bg-accent/10 flex items-center justify-center text-accent">
                        {toolIcons[bt.name] || <Wrench className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{bt.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                        <p className="text-xs text-muted-foreground">{bt.description}</p>
                      </div>
                    </div>
                    <button onClick={() => toggleTool(bt.name)} className="flex-shrink-0">
                      {isToolEnabled(bt.name) ? (
                        <ToggleRight className="w-7 h-7 text-accent" />
                      ) : (
                        <ToggleLeft className="w-7 h-7 text-muted-foreground" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Search Provider */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Search Provider</h3>
              <div className="grid grid-cols-2 gap-2">
                {searchProviders.map(sp => (
                  <button
                    key={sp.id}
                    onClick={() => setDefaultSearchProvider(sp.id)}
                    className={cn(
                      'p-3 text-left border rounded-sm transition-all',
                      defaultSearchProvider === sp.id
                        ? 'border-accent bg-accent/10 text-foreground'
                        : 'border-border bg-secondary/20 text-muted-foreground hover:border-accent/50'
                    )}
                  >
                    <p className="text-sm font-medium">{sp.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{sp.description}</p>
                  </button>
                ))}
              </div>

              {/* Inline config for selected provider */}
              {defaultSearchProvider === 'searxng' && (
                <label className="block">
                  <span className="text-xs text-muted-foreground">SearXNG Instance URL</span>
                  <input
                    type="text"
                    value={searchConfig.searxngUrl || ''}
                    onChange={e => setSearchConfig({ ...searchConfig, searxngUrl: e.target.value })}
                    placeholder="http://192.168.1.70:8888"
                    className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              )}
              {defaultSearchProvider === 'brave' && (
                <label className="block">
                  <span className="text-xs text-muted-foreground">Brave API Key</span>
                  <input
                    type="password"
                    value={searchConfig.braveApiKey || ''}
                    onChange={e => setSearchConfig({ ...searchConfig, braveApiKey: e.target.value })}
                    placeholder="BSA..."
                    className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              )}
              {defaultSearchProvider === 'google' && (
                <div className="space-y-2">
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Google PSE API Key</span>
                    <input
                      type="password"
                      value={searchConfig.googleApiKey || ''}
                      onChange={e => setSearchConfig({ ...searchConfig, googleApiKey: e.target.value })}
                      placeholder="AIza..."
                      className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                    />
                  </label>
                  <label className="block">
                    <span className="text-xs text-muted-foreground">Google PSE CX</span>
                    <input
                      type="text"
                      value={searchConfig.googleCx || ''}
                      onChange={e => setSearchConfig({ ...searchConfig, googleCx: e.target.value })}
                      placeholder="cx..."
                      className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                    />
                  </label>
                </div>
              )}
              {defaultSearchProvider === 'parallel' && (
                <label className="block">
                  <span className="text-xs text-muted-foreground">Parallel API Key</span>
                  <input
                    type="password"
                    value={searchConfig.parallelApiKey || ''}
                    onChange={e => setSearchConfig({ ...searchConfig, parallelApiKey: e.target.value })}
                    placeholder="x-api-key..."
                    className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              )}
              {defaultSearchProvider === 'exa' && (
                <label className="block">
                  <span className="text-xs text-muted-foreground">Exa API Key</span>
                  <input
                    type="password"
                    value={searchConfig.exaApiKey || ''}
                    onChange={e => setSearchConfig({ ...searchConfig, exaApiKey: e.target.value })}
                    placeholder="x-api-key..."
                    className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              )}
              {defaultSearchProvider === 'tavily' && (
                <label className="block">
                  <span className="text-xs text-muted-foreground">Tavily API Key</span>
                  <input
                    type="password"
                    value={searchConfig.tavilyApiKey || ''}
                    onChange={e => setSearchConfig({ ...searchConfig, tavilyApiKey: e.target.value })}
                    placeholder="tvly-..."
                    className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                </label>
              )}
            </div>

            {/* MCP Servers */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">MCP Servers</h3>
                <button
                  onClick={() => setShowAddForm(!showAddForm)}
                  className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Server
                </button>
              </div>

              {/* Add Server Form */}
              {showAddForm && (
                <div className="p-3 bg-secondary/30 border border-border rounded-sm space-y-3">
                  <input
                    type="text"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="Server name"
                    className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => setNewTransport('stdio')}
                      className={cn(
                        'flex-1 px-3 py-1.5 text-xs border rounded-sm transition-all',
                        newTransport === 'stdio' ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'
                      )}
                    >
                      Stdio (Local)
                    </button>
                    <button
                      onClick={() => setNewTransport('sse')}
                      className={cn(
                        'flex-1 px-3 py-1.5 text-xs border rounded-sm transition-all',
                        newTransport === 'sse' ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'
                      )}
                    >
                      HTTP/SSE (Remote)
                    </button>
                  </div>
                  {newTransport === 'stdio' ? (
                    <>
                      <input
                        type="text"
                        value={newCommand}
                        onChange={e => setNewCommand(e.target.value)}
                        placeholder="Command (e.g. npx)"
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                      />
                      <input
                        type="text"
                        value={newArgs}
                        onChange={e => setNewArgs(e.target.value)}
                        placeholder="Arguments (space-separated, e.g. -y @anthropic/mcp-server-filesystem /tmp)"
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                      />
                    </>
                  ) : (
                    <input
                      type="text"
                      value={newUrl}
                      onChange={e => setNewUrl(e.target.value)}
                      placeholder="Server URL (e.g. http://localhost:3001/mcp)"
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                    />
                  )}
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => setShowAddForm(false)}
                      className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleAddServer}
                      disabled={!newName || actionLoading === 'add'}
                      className="px-3 py-1.5 text-xs bg-accent text-accent-foreground rounded-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
                    >
                      {actionLoading === 'add' ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : 'Add & Connect'}
                    </button>
                  </div>
                </div>
              )}

              {/* Server List */}
              {mcpServers.length === 0 && !showAddForm && (
                <div className="p-4 bg-secondary/20 border border-dashed border-border rounded-sm text-center">
                  <p className="text-sm text-muted-foreground">No MCP servers configured</p>
                  <p className="text-xs text-muted-foreground mt-1">Click "Add Server" to connect a local or remote MCP server</p>
                </div>
              )}

              {mcpServers.map(server => (
                <div key={server.config.id} className="border border-border rounded-sm overflow-hidden">
                  {/* Server Header */}
                  <div className="flex items-center gap-3 px-3 py-2.5 bg-secondary/30">
                    <button onClick={() => toggleExpand(server.config.id)} className="flex-shrink-0">
                      {expandedServer === server.config.id ? (
                        <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                      )}
                    </button>
                    <div className={cn('w-2 h-2 rounded-full flex-shrink-0', statusColors[server.status])} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{server.config.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {server.config.transport === 'stdio'
                          ? `${server.config.command} ${server.config.args?.join(' ') || ''}`
                          : server.config.url
                        }
                      </p>
                    </div>
                    {server.status === 'connected' && (
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                        {server.toolCount} tools
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      {server.status === 'connected' ? (
                        <button
                          onClick={() => handleDisconnect(server.config.id)}
                          disabled={actionLoading === server.config.id}
                          className="p-1 hover:bg-secondary rounded-sm transition-colors text-muted-foreground hover:text-foreground"
                          title="Disconnect"
                        >
                          {actionLoading === server.config.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Unplug className="w-3.5 h-3.5" />
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleConnect(server.config.id)}
                          disabled={actionLoading === server.config.id}
                          className="p-1 hover:bg-secondary rounded-sm transition-colors text-muted-foreground hover:text-accent"
                          title="Connect"
                        >
                          {actionLoading === server.config.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Plug className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        onClick={() => handleRemove(server.config.id)}
                        className="p-1 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors text-muted-foreground"
                        title="Remove"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Error display */}
                  {server.status === 'error' && server.error && (
                    <div className="px-3 py-2 bg-destructive/10 border-t border-border flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive">{server.error}</p>
                    </div>
                  )}

                  {/* Expanded tool list */}
                  {expandedServer === server.config.id && server.status === 'connected' && (
                    <div className="border-t border-border">
                      {(serverTools[server.config.id] || []).map(tool => (
                        <div key={tool.name} className="px-3 py-2 flex items-center gap-2 border-b border-border/50 last:border-0">
                          <Wrench className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{tool.originalName}</p>
                            <p className="text-xs text-muted-foreground truncate">{tool.description}</p>
                          </div>
                        </div>
                      ))}
                      {(serverTools[server.config.id] || []).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground italic">Loading tools...</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
