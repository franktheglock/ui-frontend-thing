export interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
}

export interface ToolSchema {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, ToolParameter>
    required?: string[]
  }
}

export abstract class BaseTool {
  abstract id: string
  abstract name: string
  abstract description: string
  abstract parameters: {
    type: string
    properties: Record<string, ToolParameter>
    required?: string[]
  }

  abstract execute(args: Record<string, unknown>): Promise<string>

  getSchema(): ToolSchema {
    return {
      name: this.name,
      description: this.description,
      parameters: this.parameters,
    }
  }
}
