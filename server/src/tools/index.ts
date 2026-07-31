import { BaseTool } from "./base";
import { WebSearchTool } from "./web-search";
import { ReadURLTool } from "./read-url";
import { PythonTool, CodeEditTool } from "./python";
import { TerminalTool } from "./terminal";
import { ListSkillsTool, ReadSkillTool, MakeSkillTool } from "./skill-tools";
import { ImageGenerationTool } from "./image-generation";
import { MemoryTool } from "./memory";
import { mcpManager } from "../mcp/mcp-manager";

/**
 * Host-execution tools (python / terminal) are powerful and not sandboxed.
 * Disable with ENABLE_TERMINAL_TOOL=false / ENABLE_PYTHON_TOOL=false.
 * Default is enabled for local laptop use; pair with HOST=127.0.0.1.
 */
function envEnabled(name: string, defaultValue = true): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return defaultValue;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

const tools: BaseTool[] = [
  new WebSearchTool(),
  new ReadURLTool(),
  new ImageGenerationTool(),
  new MemoryTool(),
  new ListSkillsTool(),
  new ReadSkillTool(),
  new MakeSkillTool(),
];

if (envEnabled("ENABLE_PYTHON_TOOL", true)) {
  tools.push(new PythonTool(), new CodeEditTool());
} else {
  console.log("[tools] Python/code_edit tools disabled (ENABLE_PYTHON_TOOL=false)");
}

if (envEnabled("ENABLE_TERMINAL_TOOL", true)) {
  tools.push(new TerminalTool());
} else {
  console.log("[tools] Terminal tool disabled (ENABLE_TERMINAL_TOOL=false)");
}

export function registerTool(tool: BaseTool) {
  tools.push(tool);
}

export function listTools() {
  const builtIn = tools.map((t) => t.getSchema());
  return builtIn;
}

export function getTool(name: string): BaseTool | undefined {
  return tools.find((t) => t.name === name);
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  // Route MCP tools through the manager
  if (mcpManager.isMCPTool(name)) {
    return await mcpManager.callTool(name, args);
  }

  const tool = getTool(name);
  if (!tool) {
    throw new Error(`Tool ${name} not found`);
  }
  return await tool.execute(args);
}
