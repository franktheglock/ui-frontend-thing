import { BaseTool } from './base'

export class SpawnSubagentTool extends BaseTool {
  id = 'spawn_subagent'
  name = 'spawn_subagent'
  description = 'Delegate a narrowly scoped research task to a subagent that can use the same tools and report back with a synthesized summary.'
  parameters = {
    type: 'object',
    properties: {
      scope: {
        type: 'string',
        description: 'The narrow area this subagent should investigate, such as pricing, benchmarks, API limits, or release notes.',
      },
      task: {
        type: 'string',
        description: 'The exact research task or question the subagent should answer within that scope.',
      },
    },
    required: ['scope', 'task'],
  }

  async execute(): Promise<string> {
    throw new Error('spawn_subagent must be handled by the chat API')
  }
}