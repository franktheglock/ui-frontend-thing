import { BaseTool } from "./base";
import { getDb } from "../db";
import { appendMemory, readMemory, replaceMemory } from "../memory";

export class MemoryTool extends BaseTool {
  id = "memory";
  name = "memory";
  description =
    "Read or update the durable user memory markdown file. Use this sparingly for stable facts about the user, such as their name, preferences, hobbies, long-term projects, or current life context. Do not save transient chat details, secrets, API keys, passwords, or sensitive personal data unless the user explicitly asks you to remember it.";
  parameters = {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["read", "add", "replace"],
        description:
          "read returns the memory file. add appends one durable memory under a category. replace rewrites the memory file after careful cleanup or deletion.",
      },
      scope: {
        type: "string",
        enum: ["auto", "global", "project"],
        description:
          "Where to read or save memory. Use project for facts specific to the current project, global for stable user-wide facts, and auto when unsure.",
      },
      category: {
        type: "string",
        description:
          "Category for add, for example Profile, Preferences, Interests and hobbies, Current life context, Projects, or Communication style.",
      },
      memory: {
        type: "string",
        description:
          'One concise memory to add. Write it as a user fact/preference, for example "The user likes dark sci-fi interfaces."',
      },
      content: {
        type: "string",
        description:
          "Full replacement markdown content for replace. Preserve useful existing memories unless the user asked to remove or change them.",
      },
    },
    required: ["action"],
  };

  async execute(args: Record<string, unknown>): Promise<string> {
    const db = await getDb();
    const settingsRow = (await db.get(
      "SELECT value FROM app_settings WHERE id = ?",
      "global",
    )) as any;
    const appSettings = settingsRow?.value
      ? JSON.parse(settingsRow.value || "{}")
      : {};
    if (appSettings.memoryEnabled === false) {
      throw new Error("Memory is disabled in settings");
    }

    const action = String(args.action || "")
      .trim()
      .toLowerCase();
    const requestedScope = String(args.scope || "auto").trim().toLowerCase();
    const sessionId = typeof args.sessionId === "string" ? args.sessionId : "";
    const project = sessionId
      ? await db.get(
          `SELECT p.id, p.name, p.memory
           FROM sessions s
           JOIN projects p ON p.id = s.project_id
           WHERE s.id = ?`,
          sessionId,
        ) as any
      : null;
    const useProjectMemory = !!project && requestedScope !== "global";

    if (action === "read") {
      if (useProjectMemory) {
        return project.memory || "# Project Memory\n\n- _No project memories saved yet._";
      }
      return readMemory();
    }

    if (action === "add") {
      if (useProjectMemory) {
        const result = appendProjectMemory(
          project.memory || "# Project Memory\n",
          String(args.category || "General"),
          String(args.memory || ""),
        );
        if (!result.memory.trim()) throw new Error("Memory text is required");
        await db.run(
          "UPDATE projects SET memory = ?, updated_at = ? WHERE id = ?",
          result.content,
          Date.now(),
          project.id,
        );
        return result.changed
          ? `Saved project memory to ${project.name}.\n\n${result.content}`
          : `Project memory was already saved in ${project.name}.\n\n${result.content}`;
      }
      const result = appendMemory(
        String(args.category || "General"),
        String(args.memory || ""),
      );
      return result.changed
        ? `Saved memory to ${result.filePath}.\n\n${result.content}`
        : `Memory was already saved in ${result.filePath}.\n\n${result.content}`;
    }

    if (action === "replace") {
      const content = String(args.content || "").trim();
      if (!content) throw new Error("content is required for replace");
      if (useProjectMemory) {
        await db.run(
          "UPDATE projects SET memory = ?, updated_at = ? WHERE id = ?",
          content,
          Date.now(),
          project.id,
        );
        return `Updated project memory for ${project.name}.\n\n${content}`;
      }
      const result = replaceMemory(content);
      return `Updated memory file at ${result.filePath}.\n\n${result.content}`;
    }

    throw new Error("Invalid memory action. Use read, add, or replace.");
  }
}

function appendProjectMemory(current: string, category: string, memory: string) {
  const normalizedCategory = category.trim() || "General";
  const normalizedMemory = memory.trim().replace(/\s+/g, " ");
  if (!normalizedMemory) return { content: current, changed: false, memory: "" };

  const heading = `## ${normalizedCategory}`;
  const line = `- ${normalizedMemory}`;
  const base = current.trim() || "# Project Memory";

  if (base.toLowerCase().includes(line.toLowerCase())) {
    return { content: base, changed: false, memory: normalizedMemory };
  }

  const headingRegex = new RegExp(`(^##\\s+${escapeRegExp(normalizedCategory)}\\s*$)`, "im");
  const match = base.match(headingRegex);
  let next: string;

  if (match?.index !== undefined) {
    const insertAt = findEndOfSection(base, match.index + match[0].length);
    const section = base.slice(match.index, insertAt);
    const cleanedSection = section.replace(/\n- _No project memories saved yet\._/i, "");
    next = base.slice(0, match.index) + cleanedSection.trimEnd() + `\n${line}\n` + base.slice(insertAt);
  } else {
    next = `${base.trimEnd()}\n\n${heading}\n\n${line}`;
  }

  return { content: `${next.trim()}\n`, changed: true, memory: normalizedMemory };
}

function findEndOfSection(markdown: string, start: number) {
  const rest = markdown.slice(start);
  const nextHeading = rest.search(/^##\s+/m);
  return nextHeading === -1 ? markdown.length : start + nextHeading;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
