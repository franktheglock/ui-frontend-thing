import { BaseTool } from './base'
import { WebSearchTool } from './web-search'
import { ReadURLTool } from './read-url'
import { PythonTool, CodeEditTool } from './python'
import { TerminalTool } from './terminal'
import { ListSkillsTool, ReadSkillTool, MakeSkillTool } from './skill-tools'
import { mcpManager } from '../mcp/mcp-manager'

const tools: BaseTool[] = [
  new WebSearchTool(),
  new ReadURLTool(),
  new PythonTool(),
  new CodeEditTool(),
  new TerminalTool(),
  new ListSkillsTool(),
  new ReadSkillTool(),
  new MakeSkillTool(),
]

export function registerTool(tool: BaseTool) {
  tools.push(tool)
}

export function listTools() {
  const builtIn = tools.map(t => t.getSchema())
  const mcpTools = mcpManager.getAllTools()
  return [...builtIn, ...mcpTools]
}

export function getTool(name: string): BaseTool | undefined {
  return tools.find(t => t.name === name)
}

export async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
  // Route MCP tools through the manager
  if (mcpManager.isMCPTool(name)) {
    return await mcpManager.callTool(name, args)
  }

  const tool = getTool(name)
  if (!tool) {
    throw new Error(`Tool ${name} not found`)
  }
  return await tool.execute(args)
}

