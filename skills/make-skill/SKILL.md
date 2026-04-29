---
name: Make Skill
description: A skill that teaches the model how to create effective skills for the skills system. Use this when the user wants to create a new skill or when asked about skill authoring best practices.
---

# Skill Authoring Guide

## What is a Skill?

A skill is a markdown file (SKILL.md) stored in the `skills/` directory. Skills provide the LLM with specialized knowledge, workflows, and best practices for specific domains. When a skill is loaded, its content is injected into the conversation context.

## Skill Structure

Every skill must be a `SKILL.md` file in a directory under `skills/`:

```
skills/
  my-skill/
    SKILL.md
```

The SKILL.md should follow this format:

```markdown
---
name: Human-Readable Name
description: Brief description of what this skill provides
---

# Title

## Overview
Brief explanation of the skill's purpose.

## Guidelines
- Specific instructions
- Best practices
- Common patterns

## Examples
Example inputs and expected outputs.

## Tools
List any relevant tools that work well with this skill.
```

## Creating a Skill

Use the `make_skill` tool with:
- `name`: kebab-case skill name (e.g., "react-hooks", "api-design")
- `content`: The full SKILL.md content with YAML frontmatter

Example tool call:
```json
{
  "name": "make_skill",
  "arguments": {
    "name": "react-hooks",
    "content": "---\nname: React Hooks\ndescription: Best practices for React hooks including useState, useEffect, useMemo, and custom hooks\n---\n\n# React Hooks Guide\n\n## Rules\n1. Always use functional components\n2. Hooks must start with 'use'\n3. Call hooks at the top level only\n..."
  }
}
```

## Best Practices

1. **Be specific**: Skills should solve a specific problem, not be general knowledge
2. **Include examples**: Always provide concrete examples
3. **Reference tools**: Mention relevant tools (e.g., web_search, python) when applicable
4. **Keep it focused**: One skill = one domain. Don't combine unrelated topics
5. **Use YAML frontmatter**: Always include `name` and `description` in the frontmatter
6. **Structure clearly**: Use headers, lists, and code blocks for readability

## Good Skill Topics

- Framework-specific patterns (React hooks, Vue composition API)
- Domain expertise (SEO, accessibility, database design)
- Workflow automation (CI/CD, testing strategies)
- Code review guidelines (security checks, performance)
- API design patterns (REST, GraphQL, gRPC)

## Bad Skill Topics

- General programming knowledge (should be in system prompt)
- Language syntax basics (too broad)
- Information that changes frequently (version-specific details)
