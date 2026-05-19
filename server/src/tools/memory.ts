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

    if (action === "read") {
      return readMemory();
    }

    if (action === "add") {
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
      const result = replaceMemory(content);
      return `Updated memory file at ${result.filePath}.\n\n${result.content}`;
    }

    throw new Error("Invalid memory action. Use read, add, or replace.");
  }
}
