import React, { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Settings, Key, Wrench, Download, Loader2, Trash2 } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { cn } from '../lib/utils'

type SettingsTab = 'general' | 'providers' | 'tools' | 'skills'

const reasoningEffortOptions = [
  { value: 'auto', label: 'Provider default' },
  { value: 'none', label: 'None' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'X-High' },
  { value: 'max', label: 'Max' },
] as const

function getReasoningEffortHint(providerId: string) {
  switch (providerId) {
    case 'openai':
    case 'openrouter':
    case 'openai-compatible':
    case 'nvidia':
    case 'lmstudio':
      return 'OpenAI-style providers use the nearest supported reasoning effort level.'
    case 'anthropic':
      return 'Anthropic maps this to Claude effort. Unsupported lower levels are rounded up.'
    case 'gemini':
      return 'Gemini maps this to thinking level on Gemini 3 and thinking budget on Gemini 2.5.'
    default:
      return 'Applied only when the selected provider supports reasoning controls.'
  }
}

function LocalInput({ value, onChange, ...props }: any) {
  const [localValue, setLocalValue] = useState(value)
  React.useEffect(() => { setLocalValue(value) }, [value])
  return (
    <input
      {...props}
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      onBlur={() => onChange(localValue)}
    />
  )
}

function LocalTextarea({ value, onChange, ...props }: any) {
  const [localValue, setLocalValue] = useState(value)
  React.useEffect(() => { setLocalValue(value) }, [value])
  return (
    <textarea
      {...props}
      value={localValue}
      onChange={e => setLocalValue(e.target.value)}
      onBlur={() => onChange(localValue)}
    />
  )
}

export function SettingsModal() {
  const { settingsOpen, setSettingsOpen } = useUIStore()
  const {
    systemPrompt,
    temperature,
    maxTokens,
    topP,
    selectedProvider,
    reasoningEffort,
    streamResponses,
    showThinking,
    showGenerationInfo,
    defaultSearchProvider,
    searchConfig,
    artifactsEnabled,
    toolDisplayMode,
    maxToolTurns,
    setSystemPrompt,
    setTemperature,
    setMaxTokens,
    setTopP,
    setReasoningEffort,
    setStreamResponses,
    setShowThinking,
    setShowGenerationInfo,
    setDefaultSearchProvider,
    setSearchConfig,
    setArtifactsEnabled,
    setToolDisplayMode,
    setMaxToolTurns,
    providers,
    updateProvider,
    removeProvider,
  } = useSettingsStore()

  const [activeTab, setActiveTab] = useState<SettingsTab>('general')
  const [skillSearch, setSkillSearch] = useState('')
  const [skillView, setSkillView] = useState<'trending' | 'all-time' | 'curated'>('trending')
  const [browseSkills, setBrowseSkills] = useState<any[]>([])
  const [installedSkills, setInstalledSkills] = useState<any[]>([])
  const [loadingSkills, setLoadingSkills] = useState(false)
  const [installingSkill, setInstallingSkill] = useState<string | null>(null)
  const [skillError, setSkillError] = useState<string | null>(null)
  const [skillUrl, setSkillUrl] = useState('')
  const [installingUrl, setInstallingUrl] = useState(false)

  const loadInstalledSkills = async () => {
    try {
      const res = await fetch('/api/skills/local')
      if (res.ok) {
        const data = await res.json()
        setInstalledSkills(data)
      }
    } catch {}
  }

  const loadBrowseSkills = async () => {
    setLoadingSkills(true)
    setSkillError(null)
    try {
      let url: string
      if (skillView === 'curated') {
        url = '/api/skills/curated'
      } else if (skillSearch.trim()) {
        url = `/api/skills/browse?q=${encodeURIComponent(skillSearch.trim())}`
      } else {
        url = `/api/skills/browse?view=${skillView}`
      }
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setSkillError(data.error || 'Failed to load skills')
        setBrowseSkills([])
        return
      }
      const data = await res.json()
      if (skillView === 'curated') {
        const all: any[] = []
        for (const owner of (data.data || [])) {
          for (const skill of (owner.skills || [])) {
            all.push({ ...skill, owner: owner.owner })
          }
        }
        setBrowseSkills(all)
      } else {
        setBrowseSkills(data.data || [])
      }
    } catch (e: any) {
      setSkillError(e.message || 'Failed to load skills')
      setBrowseSkills([])
    }
    setLoadingSkills(false)
  }

  const handleInstallSkill = async (skillId: string) => {
    setInstallingSkill(skillId)
    try {
      const response = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId }),
      })
      if (response.ok) {
        await loadInstalledSkills()
      } else {
        const data = await response.json()
        alert(`Error: ${data.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setInstallingSkill(null)
    }
  }

  const handleInstallUrl = async () => {
    if (!skillUrl.trim()) return
    setInstallingUrl(true)
    try {
      const response = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: skillUrl.trim() }),
      })
      if (response.ok) {
        setSkillUrl('')
        await loadInstalledSkills()
      } else {
        const data = await response.json()
        alert(`Error: ${data.error}`)
      }
    } catch (error: any) {
      alert(`Error: ${error.message}`)
    } finally {
      setInstallingUrl(false)
    }
  }

  const handleUninstallSkill = async (id: string) => {
    try {
      await fetch(`/api/skills/${id}`, { method: 'DELETE' })
      await loadInstalledSkills()
    } catch {}
  }

  React.useEffect(() => {
    if (activeTab === 'skills') {
      loadInstalledSkills()
      loadBrowseSkills()
    }
  }, [activeTab])

  React.useEffect(() => {
    if (activeTab === 'skills') {
      loadBrowseSkills()
    }
  }, [skillView])

  const tabs = [
    { id: 'general' as SettingsTab, label: 'General', icon: Settings },
    { id: 'providers' as SettingsTab, label: 'Providers', icon: Key },
    { id: 'tools' as SettingsTab, label: 'Tools', icon: Wrench },
    { id: 'skills' as SettingsTab, label: 'Skills', icon: Download },
  ]

  return (
    <AnimatePresence>
      {settingsOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
          onClick={() => setSettingsOpen(false)}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card border border-border rounded-sm w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Settings</h2>
              <button
                onClick={() => setSettingsOpen(false)}
                className="p-1.5 hover:bg-secondary rounded-sm transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex border-b border-border">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2.5 text-sm border-b-2 transition-colors',
                    activeTab === tab.id
                      ? 'border-accent text-accent'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  )}
                >
                  <tab.icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {activeTab === 'general' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">System Prompt</label>
                    <LocalTextarea
                      value={systemPrompt}
                      onChange={setSystemPrompt}
                      rows={4}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Temperature</label>
                      <LocalInput
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={temperature}
                        onChange={(val: string) => setTemperature(parseFloat(val))}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Max Tokens</label>
                      <LocalInput
                        type="number"
                        min={0}
                        max={1000000}
                        value={maxTokens}
                        onChange={(val: string) => setMaxTokens(parseInt(val) || 0)}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Set to 0 for Auto/Model Maximum.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Top P</label>
                    <LocalInput
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={topP}
                      onChange={(val: string) => setTopP(parseFloat(val))}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Reasoning Effort</label>
                    <select
                      value={reasoningEffort}
                      onChange={(e) => setReasoningEffort(e.target.value as any)}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      {reasoningEffortOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-muted-foreground">
                      {getReasoningEffortHint(selectedProvider)}
                    </p>
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={streamResponses}
                        onChange={(e) => setStreamResponses(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Stream responses</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showThinking}
                        onChange={(e) => setShowThinking(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Show thinking/reasoning</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={showGenerationInfo}
                        onChange={(e) => setShowGenerationInfo(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Show generation info</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={artifactsEnabled}
                        onChange={(e) => setArtifactsEnabled(e.target.checked)}
                        className="rounded border-border"
                      />
                      <span className="text-sm">Enable code artifacts</span>
                    </label>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tool Display Mode</label>
                    <select
                      value={toolDisplayMode}
                      onChange={(e) => setToolDisplayMode(e.target.value as any)}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="individual">Individual (Default)</option>
                      <option value="grouped">Grouped by Type</option>
                      <option value="timeline">Timeline</option>
                    </select>
                    <p className="text-xs text-muted-foreground">
                      How tool calls are visualized in the chat history.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'tools' && (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Default Search Provider</label>
                    <select
                      value={defaultSearchProvider}
                      onChange={(e) => setDefaultSearchProvider(e.target.value as any)}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="searxng">SearxNG</option>
                      <option value="duckduckgo">DuckDuckGo</option>
                      <option value="brave">Brave Search</option>
                      <option value="google">Google PSE</option>
                      <option value="parallel">Parallel Search</option>
                      <option value="exa">Exa</option>
                      <option value="tavily">Tavily</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Search Configuration</label>
                    <div className="space-y-2">
                      <LocalInput
                        type="text"
                        placeholder="http://192.168.1.70:8888"
                        value={searchConfig.searxngUrl || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, searxngUrl: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Brave API Key"
                        value={searchConfig.braveApiKey || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, braveApiKey: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Google PSE API Key"
                        value={searchConfig.googleApiKey || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, googleApiKey: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="text"
                        placeholder="Google PSE CX"
                        value={searchConfig.googleCx || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, googleCx: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Parallel API Key"
                        value={searchConfig.parallelApiKey || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, parallelApiKey: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Exa API Key"
                        value={searchConfig.exaApiKey || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, exaApiKey: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <LocalInput
                        type="password"
                        placeholder="Tavily API Key"
                        value={searchConfig.tavilyApiKey || ''}
                        onChange={(val: string) => setSearchConfig({ ...searchConfig, tavilyApiKey: val })}
                        className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-sm font-medium">Tool Turn Limit</label>
                    <LocalInput
                      type="number"
                      min="0"
                      step="1"
                      value={String(maxToolTurns ?? 0)}
                      onChange={(val: string) => {
                        const parsed = Number.parseInt(val, 10)
                        setMaxToolTurns(Number.isFinite(parsed) && parsed > 0 ? parsed : 0)
                      }}
                      className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      Maximum consecutive tool-call rounds before stopping. Set to 0 for unlimited.
                    </p>
                  </div>
                </div>
              )}

              {activeTab === 'skills' && (
                <div className="space-y-6">
                  {/* Browse skills.sh */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <label className="text-sm font-medium">Browse skills.sh</label>
                      <div className="flex gap-1 bg-secondary rounded-sm p-0.5">
                        {(['trending', 'all-time', 'curated'] as const).map(v => (
                          <button
                            key={v}
                            onClick={() => setSkillView(v)}
                            className={cn(
                              'px-2.5 py-1 text-xs rounded-sm transition-colors capitalize',
                              skillView === v ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
                            )}
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Search skills..."
                        value={skillSearch}
                        onChange={(e) => setSkillSearch(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && loadBrowseSkills()}
                        className="flex-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        onClick={loadBrowseSkills}
                        disabled={loadingSkills}
                        className="px-4 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {loadingSkills ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Search'}
                      </button>
                    </div>

                    {skillError && (
                      <div className="bg-destructive/10 text-destructive text-xs p-3 rounded-sm border border-destructive/20">
                        {skillError}
                      </div>
                    )}
                    <div className="max-h-[300px] overflow-y-auto space-y-1 border border-border rounded-sm">
                      {browseSkills.length === 0 && !loadingSkills && !skillError && (
                        <p className="text-xs text-muted-foreground p-4 text-center">No skills found</p>
                      )}
                      {browseSkills.filter((s: any) => !s.isDuplicate).map((skill: any) => {
                        const isInstalled = installedSkills.some((is: any) => is.source === skill.id)
                        return (
                          <div key={skill.id} className="flex items-center justify-between px-3 py-2 hover:bg-secondary/50 transition-colors">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium truncate">{skill.name}</span>
                                <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded-sm">{skill.installs?.toLocaleString()} installs</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground truncate block">{skill.id}</span>
                            </div>
                            <button
                              onClick={() => handleInstallSkill(skill.id)}
                              disabled={installingSkill === skill.id || isInstalled}
                              className={cn(
                                'flex-shrink-0 px-3 py-1.5 rounded-sm text-xs transition-colors',
                                isInstalled
                                  ? 'bg-secondary/50 text-muted-foreground cursor-default'
                                  : installingSkill === skill.id
                                    ? 'bg-accent/50 text-accent-foreground/50'
                                    : 'bg-accent text-accent-foreground hover:bg-accent/90'
                              )}
                            >
                              {installingSkill === skill.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : isInstalled ? (
                                'Installed'
                              ) : (
                                'Install'
                              )}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>

                  {/* Install from URL */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Install from URL</label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="https://github.com/owner/repo or tarball URL"
                        value={skillUrl}
                        onChange={(e) => setSkillUrl(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleInstallUrl()}
                        className="flex-1 px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        onClick={handleInstallUrl}
                        disabled={installingUrl || !skillUrl.trim()}
                        className="px-4 py-2 bg-accent text-accent-foreground rounded-sm text-sm hover:bg-accent/90 transition-colors disabled:opacity-50"
                      >
                        {installingUrl ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Install'}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Enter a GitHub repo URL or direct tarball link. Works like{' '}
                      <code className="bg-secondary px-1 rounded-sm">npx skills add {'<url>'}</code>.
                    </p>
                  </div>

                  {/* Installed skills */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Installed Skills</label>
                    {installedSkills.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No skills installed</p>
                    ) : (
                      <div className="space-y-1 border border-border rounded-sm divide-y divide-border">
                        {installedSkills.map((skill: any) => (
                          <div key={skill.id} className="flex items-center justify-between px-3 py-2">
                            <div className="min-w-0">
                              <span className="text-sm font-medium">{skill.name}</span>
                              <span className="text-[10px] text-muted-foreground ml-2">{skill.source}</span>
                            </div>
                            <button
                              onClick={() => handleUninstallSkill(skill.id)}
                              className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'providers' && (
                <div className="space-y-4">
                  {providers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No providers configured. Add them from the Model Selector.
                    </p>
                  ) : (
                    <div className="space-y-4">
                      {providers.map(provider => (
                        <div key={provider.id} className="border border-border rounded-sm p-4 space-y-3 relative bg-secondary/20">
                          <div className="flex items-center justify-between">
                            <h3 className="text-sm font-medium">{provider.name} ({provider.type})</h3>
                            <button
                              onClick={() => removeProvider(provider.id)}
                              className="p-1.5 hover:bg-destructive/10 hover:text-destructive rounded-sm transition-colors"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                          
                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">Base URL</label>
                            <LocalInput
                              type="text"
                              value={provider.baseUrl || ''}
                              onChange={(val: string) => updateProvider(provider.id, { baseUrl: val })}
                              placeholder="Default"
                              className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">API Key</label>
                            <LocalInput
                              type="password"
                              value={provider.apiKey || ''}
                              onChange={(val: string) => updateProvider(provider.id, { apiKey: val })}
                              placeholder="API Key"
                              className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-medium text-muted-foreground">Models (comma-separated)</label>
                            <LocalTextarea
                              value={provider.models.join(', ')}
                              onChange={(val: string) => updateProvider(provider.id, { models: val.split(',').map(m => m.trim()).filter(Boolean) })}
                              placeholder="Model names"
                              rows={3}
                              className="w-full px-3 py-2 bg-secondary border border-border rounded-sm text-sm focus:outline-none focus:ring-1 focus:ring-ring font-mono break-all"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
