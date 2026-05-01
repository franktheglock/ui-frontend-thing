import { create } from 'zustand'

export interface ToolInfo {
  name: string
  description: string
  enabled: boolean
  isMcp?: boolean
}

interface ToolState {
  availableTools: ToolInfo[]
  setAvailableTools: (tools: ToolInfo[]) => void
  toggleTool: (name: string) => void
}

export const useToolStore = create<ToolState>((set) => ({
  availableTools: [],
  setAvailableTools: (tools) => set({ availableTools: tools }),
  toggleTool: (name) => set(state => ({
    availableTools: state.availableTools.map(t => 
      t.name === name ? { ...t, enabled: !t.enabled } : t
    )
  })),
}))
