import React, { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Wrench, Search, Globe, ToggleLeft, ToggleRight,
  Plus, Trash2, Plug, Unplug, ChevronDown, ChevronRight, Loader2, AlertCircle,
  FileCode, Terminal as TerminalIcon, Sparkles, LayoutList, FileSearch, PenTool
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
    transport: 'stdio' | 'sse' | 'streamable-http'
    command?: string
    args?: string[]
    url?: string
    headers?: Record<string, string>
    enabled: boolean
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

interface ParsedServer {
  tempId: string
  name: string
  transport: 'stdio' | 'sse' | 'streamable-http'
  command?: string
  args?: string[]
  url?: string
  headers?: Record<string, string>
  env?: Record<string, string>
}

function parseMCPJson(text: string): { servers: ParsedServer[]; error?: string } {
  if (!text.trim()) {
    return { servers: [] }
  }
  try {
    const data = JSON.parse(text)
    if (!data || typeof data !== 'object') {
      return { servers: [], error: 'JSON must be an object' }
    }

    const validateConfig = (name: string, config: any): ParsedServer | null => {
      if (!config || typeof config !== 'object') return null
      
      let transport: 'stdio' | 'sse' | 'streamable-http' = 'stdio'
      if (config.transport === 'streamable-http' || config.transport === 'streamableHttp') {
        transport = 'streamable-http'
      } else if (config.url) {
        transport = 'sse'
      }

      if (transport === 'stdio' && !config.command) {
        return null
      }
      if ((transport === 'sse' || transport === 'streamable-http') && !config.url) {
        return null
      }

      let finalName = name || config.name || ''
      if (!finalName && transport === 'stdio' && config.command) {
        if ((config.command === 'npx' || config.command === 'uvx') && Array.isArray(config.args)) {
          const pkgArg = config.args.find((arg: string) => !arg.startsWith('-'))
          if (pkgArg) {
            const parts = pkgArg.split('/')
            finalName = parts[parts.length - 1].replace('server-', '')
          }
        }
        if (!finalName) {
          finalName = config.command
        }
      }
      if (!finalName) {
        finalName = 'unnamed-server'
      }

      return {
        tempId: Math.random().toString(36).slice(2, 9),
        name: finalName,
        transport,
        command: config.command,
        args: Array.isArray(config.args) ? config.args : undefined,
        url: config.url,
        headers: config.headers && typeof config.headers === 'object' ? config.headers : undefined,
        env: config.env && typeof config.env === 'object' ? config.env : undefined
      }
    }

    // Case 1: Standard Claude Config structure
    if (data.mcpServers && typeof data.mcpServers === 'object') {
      const servers: ParsedServer[] = []
      for (const [name, config] of Object.entries(data.mcpServers)) {
        const parsed = validateConfig(name, config)
        if (parsed) servers.push(parsed)
      }
      if (servers.length > 0) return { servers }
    }

    // Case 2: Object containing server configs directly as keys
    const keys = Object.keys(data)
    const isMultiServer = keys.length > 0 && keys.every(k => {
      const val = data[k]
      return val && typeof val === 'object' && (val.command || val.url)
    })

    if (isMultiServer) {
      const servers: ParsedServer[] = []
      for (const [name, config] of Object.entries(data)) {
        const parsed = validateConfig(name, config)
        if (parsed) servers.push(parsed)
      }
      if (servers.length > 0) return { servers }
    }

    // Case 3: A single server config object directly
    if (data.command || data.url) {
      const parsed = validateConfig('', data)
      if (parsed) {
        return { servers: [parsed] }
      }
    }

    return { servers: [], error: 'Could not find any valid MCP server configurations in the JSON. Expected command or url fields.' }
  } catch (err: any) {
    return { servers: [], error: err.message }
  }
}

export function ToolsModal() {
  const { toolSelectorOpen, setToolSelectorOpen } = useUIStore()
  const {
    tools,
    addTool,
    setTools,
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
  const [addMode, setAddMode] = useState<'manual' | 'json'>('manual')
  const [newName, setNewName] = useState('')
  const [newTransport, setNewTransport] = useState<'stdio' | 'sse' | 'streamable-http'>('stdio')
  const [newCommand, setNewCommand] = useState('')
  const [newArgs, setNewArgs] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [newHeaders, setNewHeaders] = useState('')
  const [jsonBlob, setJsonBlob] = useState('')
  const [jsonError, setJsonError] = useState<string | null>(null)
  const [parsedServers, setParsedServers] = useState<ParsedServer[]>([])
  const [showConfigEditor, setShowConfigEditor] = useState(false)
  const [rawConfig, setRawConfig] = useState('')

  const refresh = () => {
    fetch('/api/tools')
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data)) {
          // Filter out MCP tools (they show under their server)
          setBackendTools(data.filter((t: any) => !t.name?.startsWith('mcp:')))
          setTools(data.map((tool: any) => ({
            id: tool.name,
            name: tool.name,
            enabled: tool.enabled !== false,
            config: tool.config || {},
          })))
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

  const handleJsonChange = (val: string) => {
    setJsonBlob(val)
    if (!val.trim()) {
      setJsonError(null)
      setParsedServers([])
      return
    }
    const result = parseMCPJson(val)
    if (result.error) {
      setJsonError(result.error)
      setParsedServers([])
    } else {
      setJsonError(null)
      setParsedServers(result.servers)
    }
  }

  const handleUpdateParsedName = (tempId: string, name: string) => {
    setParsedServers(prev => prev.map(s => s.tempId === tempId ? { ...s, name } : s))
  }

  const handleAddServerJson = async () => {
    if (parsedServers.length === 0) return
    setActionLoading('add')
    try {
      for (const server of parsedServers) {
        if (!server.name.trim()) continue
        const res = await fetch('/api/mcp/servers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: server.name,
            transport: server.transport,
            command: server.transport === 'stdio' ? server.command : undefined,
            args: server.transport === 'stdio' ? server.args : undefined,
            url: (server.transport === 'sse' || server.transport === 'streamable-http') ? server.url : undefined,
            headers: server.headers,
            env: server.env,
            autoConnect: true,
          }),
        })
        if (!res.ok) {
          throw new Error(await res.text())
        }
      }
      setJsonBlob('')
      setParsedServers([])
      setShowAddForm(false)
      refresh()
    } catch (err: any) {
      console.error('Failed to add server:', err)
      alert('Failed to add server: ' + err.message)
    }
    setActionLoading(null)
  }

  const handleAddServer = async () => {
    if (!newName) return
    setActionLoading('add')
    try {
      // Parse headers from JSON string if streamable-http
      let headers: Record<string, string> | undefined = undefined
      if (newTransport === 'streamable-http' && newHeaders.trim()) {
        try {
          headers = JSON.parse(newHeaders)
        } catch {
          headers = { Authorization: `Bearer ${newHeaders.trim()}` }
        }
      }

      await fetch('/api/mcp/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName,
          transport: newTransport,
          command: newTransport === 'stdio' ? newCommand : undefined,
          args: newTransport === 'stdio' && newArgs ? newArgs.split(' ') : undefined,
          url: (newTransport === 'sse' || newTransport === 'streamable-http') ? newUrl : undefined,
          headers,
          autoConnect: true,
        }),
      })
      setNewName('')
      setNewCommand('')
      setNewArgs('')
      setNewUrl('')
      setNewHeaders('')
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

  const handleOpenConfigEditor = async () => {
    try {
      const res = await fetch('/api/mcp/config')
      const data = await res.json()
      setRawConfig(JSON.stringify(data, null, 2))
      setShowConfigEditor(true)
    } catch (err: any) {
      alert('Failed to load config: ' + err.message)
    }
  }

  const handleSaveConfig = async () => {
    try {
      const parsed = JSON.parse(rawConfig)
      setActionLoading('config')
      const res = await fetch('/api/mcp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      })
      if (!res.ok) throw new Error(await res.text())
      setShowConfigEditor(false)
      refresh()
    } catch (err: any) {
      alert('Failed to save config: ' + err.message)
    } finally {
      setActionLoading(null)
    }
  }

  if (!toolSelectorOpen) return null

  const isToolEnabled = (name: string) => {
    const t = tools.find(t => t.name === name)
    if (t) return t.enabled
    return true // Default to enabled
  }

  const toggleTool = (name: string) => {
    const t = tools.find(t => t.name === name)
    const newState = t ? !t.enabled : false // If it was enabled (default), now it's disabled
    if (t) {
      updateTool(t.id, { enabled: newState })
    } else {
      addTool({ id: name, name, enabled: newState, config: {} })
    }
  }

  const toolIcons: Record<string, React.ReactNode> = {
    web_search: <Search className="w-4 h-4" />,
    read_url: <Globe className="w-4 h-4" />,
    python: <FileCode className="w-4 h-4" />,
    terminal: <TerminalIcon className="w-4 h-4" />,
    code_edit: <PenTool className="w-4 h-4" />,
    list_skills: <LayoutList className="w-4 h-4" />,
    read_skill: <FileSearch className="w-4 h-4" />,
    make_skill: <Sparkles className="w-4 h-4" />,
  }

  const searchProviders = [
    { id: 'searxng' as const, name: 'SearXNG', description: 'Self-hosted meta search' },
    { id: 'duckduckgo' as const, name: 'DuckDuckGo', description: 'Privacy-focused search' },
    { id: 'brave' as const, name: 'Brave', description: 'API key required' },
    { id: 'google' as const, name: 'Google', description: 'API key required' },
    { id: 'parallel' as const, name: 'Parallel', description: 'AI-native search API' },
    { id: 'exa' as const, name: 'Exa', description: 'Neural search for LLMs' },
    { id: 'tavily' as const, name: 'Tavily', description: 'AI search engine' },
    { id: 'tinyfish' as const, name: 'TinyFish', description: 'Fast agent-tuned search (docs.tinyfish.ai)' },
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
            <div className="flex items-center gap-2">
              <button
                onClick={handleOpenConfigEditor}
                className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground hover:text-accent transition-colors px-2 py-1 border border-border rounded-sm mr-2"
              >
                Edit Config
              </button>
              <button
                onClick={() => setToolSelectorOpen(false)}
                className="p-1.5 hover:bg-secondary rounded-sm transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
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
                      <div className="w-10 h-10 rounded-sm bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
                        {toolIcons[bt.name] || <Wrench className="w-4 h-4" />}
                      </div>
                      <div>
                        <p className="text-sm font-medium">{bt.name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</p>
                        <p className="text-xs text-muted-foreground line-clamp-1" title={bt.description}>{bt.description}</p>
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
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1" title={sp.description}>{sp.description}</p>
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
              {defaultSearchProvider === 'tinyfish' && (
                <label className="block">
                  <span className="text-xs text-muted-foreground">TinyFish API Key <a href="https://docs.tinyfish.ai/" target="_blank" rel="noreferrer" className="text-accent underline">docs</a></span>
                  <input
                    type="password"
                    value={searchConfig.tinyfishApiKey || ''}
                    onChange={e => setSearchConfig({ ...searchConfig, tinyfishApiKey: e.target.value })}
                    placeholder="TinyFish API key"
                    className="w-full mt-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                  />
                  <span className="text-[11px] text-muted-foreground">Get one at https://agent.tinyfish.ai/api-keys</span>
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
                  {/* Tab Selector */}
                  <div className="flex border-b border-border pb-2 mb-2 gap-4">
                    <button
                      onClick={() => setAddMode('manual')}
                      className={cn(
                        'text-xs font-semibold uppercase tracking-wider pb-1 transition-all border-b-2',
                        addMode === 'manual' ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Manual Form
                    </button>
                    <button
                      onClick={() => setAddMode('json')}
                      className={cn(
                        'text-xs font-semibold uppercase tracking-wider pb-1 transition-all border-b-2',
                        addMode === 'json' ? 'border-accent text-accent' : 'border-transparent text-muted-foreground hover:text-foreground'
                      )}
                    >
                      Paste JSON
                    </button>
                  </div>

                  {addMode === 'json' ? (
                    <div className="space-y-3">
                      <div className="text-xs text-muted-foreground">
                        Paste a JSON block representing one or more server configs (e.g. from Claude Desktop config).
                      </div>
                      <textarea
                        value={jsonBlob}
                        onChange={e => handleJsonChange(e.target.value)}
                        placeholder={`{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-weather"]
    }
  }
}`}
                        className="w-full h-32 bg-secondary/50 font-mono text-xs p-3 rounded-sm border border-border focus:outline-none focus:border-accent resize-y"
                        spellCheck={false}
                      />
                      
                      {jsonError && (
                        <div className="p-2 bg-destructive/10 border border-destructive/20 rounded-sm flex items-start gap-2">
                          <AlertCircle className="w-3.5 h-3.5 text-destructive flex-shrink-0 mt-0.5" />
                          <p className="text-xs text-destructive font-mono">{jsonError}</p>
                        </div>
                      )}

                      {parsedServers.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                            Parsed {parsedServers.length} server{parsedServers.length > 1 ? 's' : ''}:
                          </p>
                          <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                            {parsedServers.map(server => (
                              <div key={server.tempId} className="p-2.5 bg-secondary/50 border border-border rounded-sm space-y-2">
                                <div className="flex items-center gap-2">
                                  <span className="text-xs text-muted-foreground flex-shrink-0">Name:</span>
                                  <input
                                    type="text"
                                    value={server.name}
                                    onChange={e => handleUpdateParsedName(server.tempId, e.target.value)}
                                    placeholder="Enter server name"
                                    className="flex-1 px-2 py-1 bg-background border border-border rounded-sm text-xs focus:outline-none focus:border-accent font-medium"
                                  />
                                </div>
                                <div className="text-[10px] font-mono text-muted-foreground bg-background/50 p-2 rounded border border-border/50 space-y-1">
                                  <div><span className="text-accent/80 font-semibold">transport:</span> {server.transport}</div>
                                  {server.command && <div><span className="text-accent/80 font-semibold">command:</span> {server.command}</div>}
                                  {server.args && <div><span className="text-accent/80 font-semibold">args:</span> {JSON.stringify(server.args)}</div>}
                                  {server.url && <div><span className="text-accent/80 font-semibold">url:</span> {server.url}</div>}
                                  {server.headers && (
                                    <div>
                                      <span className="text-accent/80 font-semibold">headers:</span> {JSON.stringify(server.headers)}
                                    </div>
                                  )}
                                  {server.env && (
                                    <div>
                                      <span className="text-accent/80 font-semibold">env:</span> {JSON.stringify(server.env)}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => {
                            setJsonBlob('')
                            setParsedServers([])
                            setJsonError(null)
                            setShowAddForm(false)
                          }}
                          className="px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleAddServerJson}
                          disabled={parsedServers.length === 0 || parsedServers.some(s => !s.name.trim()) || actionLoading === 'add'}
                          className="px-3 py-1.5 text-xs bg-accent text-accent-foreground rounded-sm hover:bg-accent/90 transition-colors disabled:opacity-50 font-bold"
                        >
                          {actionLoading === 'add' ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : 'Add & Connect'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
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
                          SSE (Remote)
                        </button>
                        <button
                          onClick={() => setNewTransport('streamable-http')}
                          className={cn(
                            'flex-1 px-3 py-1.5 text-xs border rounded-sm transition-all',
                            newTransport === 'streamable-http' ? 'border-accent bg-accent/10 text-foreground' : 'border-border text-muted-foreground'
                          )}
                        >
                          Streamable HTTP
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
                        <>
                          <input
                            type="text"
                            value={newUrl}
                            onChange={e => setNewUrl(e.target.value)}
                            placeholder="Server URL (e.g. http://localhost:3001/mcp)"
                            className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                          />
                          {newTransport === 'streamable-http' && (
                            <>
                              <input
                                type="text"
                                value={newHeaders}
                                onChange={e => setNewHeaders(e.target.value)}
                                placeholder="Bearer token or JSON headers object"
                                className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:border-accent"
                              />
                              <p className="text-[10px] text-muted-foreground leading-relaxed">
                                Paste a Bearer token, or a JSON object with auth headers (Authorization, X-Api-Key, etc.)
                              </p>
                            </>
                          )}
                        </>
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
                    </>
                  )}
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
                        {server.config.transport === 'streamable-http' && server.config.headers && (
                          <span className="ml-1 text-[10px] italic">[auth configured]</span>
                        )}
                      </p>
                    </div>
                    {server.status === 'connected' && (
                      <span className="text-xs text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                        {server.toolCount} tools
                      </span>
                    )}
                    <div className="flex items-center gap-1">
                      {/* Enable/disable toggle */}
                      <button
                        onClick={async () => {
                          setActionLoading(server.config.id)
                          try {
                            await fetch(`/api/mcp/servers/${server.config.id}`, {
                              method: 'PATCH',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ enabled: !server.config.enabled }),
                            })
                            const res = await fetch('/api/mcp/servers')
                            const servers = await res.json()
                            setMcpServers(servers)
                          } finally {
                            setActionLoading(null)
                          }
                        }}
                        disabled={actionLoading === server.config.id}
                        className={`p-1 rounded-sm transition-colors ${
                          server.config.enabled
                            ? 'text-accent hover:text-accent-hover'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                        title={server.config.enabled ? 'Disable all tools' : 'Enable all tools'}
                      >
                        {server.config.enabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                      </button>
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
                  {expandedServer === server.config.id && (
                    <div className="border-t border-border">
                      {server.status === 'connected' ? (
                        server.config.enabled ? (
                          (serverTools[server.config.id] || []).map(tool => {
                            const isDisabled = useSettingsStore.getState().disabledMcpTools.includes(tool.name)
                            return (
                              <div key={tool.name} className="px-3 py-2 flex items-center gap-2 border-b border-border/50 last:border-0">
                                <Wrench className={`w-3 h-3 flex-shrink-0 ${isDisabled ? 'text-muted-foreground' : 'text-foreground'}`} />
                                <div className="min-w-0 flex-1">
                                  <p className={`text-xs font-medium truncate ${isDisabled ? 'text-muted-foreground' : 'text-foreground'}`}>{tool.originalName}</p>
                                  <p className="text-xs text-muted-foreground truncate" title={tool.description}>{tool.description}</p>
                                </div>
                                <button
                                  onClick={() => {
                                    const store = useSettingsStore.getState()
                                    const current = store.disabledMcpTools
                                    const updated = isDisabled
                                      ? current.filter(n => n !== tool.name)
                                      : [...current, tool.name]
                                    store.setDisabledMcpTools(updated)
                                  }}
                                  className={`p-1 rounded-sm transition-colors ${
                                    isDisabled
                                      ? 'text-muted-foreground hover:text-foreground'
                                      : 'text-accent hover:text-accent-hover'
                                  }`}
                                  title={isDisabled ? 'Enable tool' : 'Disable tool'}
                                >
                                  {isDisabled ? <ToggleLeft className="w-3.5 h-3.5" /> : <ToggleRight className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            )
                          })
                        ) : (
                          <div className="px-3 py-2 text-xs text-muted-foreground italic">Server disabled — tools not available</div>
                        )
                      ) : (
                        <div className="px-3 py-2 text-xs text-muted-foreground italic">Disconnected</div>
                      )}
                      {server.status === 'connected' && server.config.enabled && (serverTools[server.config.id] || []).length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground italic">Loading tools...</div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Config Editor Modal */}
        <AnimatePresence>
          {showConfigEditor && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60"
              onClick={() => setShowConfigEditor(false)}
            >
              <div 
                className="bg-card border border-border rounded-sm shadow-3xl w-full max-w-2xl flex flex-col h-[70vh]"
                onClick={e => e.stopPropagation()}
              >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                  <h3 className="text-sm font-semibold uppercase tracking-wider">Edit mcp.json</h3>
                  <button onClick={() => setShowConfigEditor(false)}>
                    <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
                <div className="flex-1 p-4">
                  <textarea
                    value={rawConfig}
                    onChange={e => setRawConfig(e.target.value)}
                    className="w-full h-full bg-secondary/50 font-mono text-xs p-4 rounded-sm border border-border focus:outline-none focus:border-accent resize-none"
                    spellCheck={false}
                  />
                </div>
                <div className="px-4 py-3 border-t border-border flex justify-between items-center bg-secondary/20">
                  <p className="text-[10px] text-muted-foreground">
                    Format: {"{ \"mcpServers\": { \"name\": { \"command\": \"...\", \"args\": [] } } }"}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowConfigEditor(false)}
                      className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveConfig}
                      disabled={actionLoading === 'config'}
                      className="px-4 py-2 text-xs bg-accent text-accent-foreground rounded-sm hover:bg-accent/90 transition-all font-bold flex items-center gap-2"
                    >
                      {actionLoading === 'config' ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Save Config'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}
