import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import fs from "fs";
import { getDb } from "../db";
import { getProvider } from "../providers";
import { executeTool, listTools } from "../tools";
import { mcpManager } from "../mcp/mcp-manager";
import { readMemory } from "../memory";
import { safeJsonParse } from "../utils/json";

const router = Router();

router.get("/sessions", async (_req, res) => {
  const db = await getDb();
  const sessions = await db.all(
    "SELECT * FROM sessions ORDER BY updated_at DESC",
  );
  res.json(
    sessions.map((s) => ({
      ...s,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
      systemPrompt: s.system_prompt,
      lastResponseId: s.last_response_id,
      messages: [],
    })),
  );
});

router.get("/sessions/:id", async (req, res) => {
  const db = await getDb();
  const session = await db.get(
    "SELECT * FROM sessions WHERE id = ?",
    req.params.id,
  );
  if (!session) return res.status(404).json({ error: "Session not found" });

  const messages = await db.all(
    "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp",
    req.params.id,
  );
  res.json({
    ...session,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
    systemPrompt: session.system_prompt,
    lastResponseId: session.last_response_id,
    messages: messages.map((m: any) => ({
      ...m,
      toolCalls: m.tool_calls ? JSON.parse(m.tool_calls) : undefined,
      toolResults: m.tool_results ? JSON.parse(m.tool_results) : undefined,
      attachments: m.attachments ? JSON.parse(m.attachments) : undefined,
      generationInfo: m.generation_info
        ? JSON.parse(m.generation_info)
        : undefined,
      timeline: m.timeline ? JSON.parse(m.timeline) : undefined,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
    })),
  });
});

router.post("/sessions", async (req, res) => {
  const db = await getDb();
  const id = req.body.id || uuidv4();
  const { title, model, provider, systemPrompt } = req.body;
  const now = Date.now();

  try {
    await db.run(
      "INSERT INTO sessions (id, title, model, provider, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id,
      title || "New Chat",
      model,
      provider,
      systemPrompt || null,
      now,
      now,
    );
    res.json({
      id,
      title: title || "New Chat",
      model,
      provider,
      systemPrompt,
      createdAt: now,
      updatedAt: now,
      messages: [],
    });
  } catch (error: any) {
    console.error("[api/chat] Failed to create session:", error);
    res.status(500).json({ error: "Failed to create session" });
  }
});

router.delete("/sessions/:id", async (req, res) => {
  const db = await getDb();
  await db.run("DELETE FROM sessions WHERE id = ?", req.params.id);
  res.json({ success: true });
});

router.post("/sessions/:id/branch", async (req, res) => {
  const db = await getDb();
  const { messageId } = req.body;
  const sourceSessionId = req.params.id;

  try {
    const session = await db.get("SELECT * FROM sessions WHERE id = ?", sourceSessionId);
    if (!session) {
      return res.status(404).json({ error: "Source session not found" });
    }

    const messages = await db.all(
      "SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC",
      sourceSessionId
    );

    const targetIndex = messages.findIndex((m) => m.id === messageId);
    if (targetIndex === -1) {
      return res.status(400).json({ error: "Target message not found in this session" });
    }

    const messagesToClone = messages.slice(0, targetIndex + 1);

    const newSessionId = uuidv4();
    const now = Date.now();
    const newTitle = `Branch: ${session.title}`;

    await db.run(
      "INSERT INTO sessions (id, title, model, provider, system_prompt, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      newSessionId,
      newTitle,
      session.model,
      session.provider,
      session.system_prompt || null,
      now,
      now
    );

    for (const msg of messagesToClone) {
      const newMsgId = uuidv4();
      await db.run(
        `INSERT INTO messages (id, session_id, role, content, thinking, tool_calls, tool_results, attachments, generation_info, timeline, metadata, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        newMsgId,
        newSessionId,
        msg.role,
        msg.content,
        msg.thinking || null,
        msg.tool_calls || null,
        msg.tool_results || null,
        msg.attachments || null,
        msg.generation_info || null,
        msg.timeline || null,
        msg.metadata || null,
        msg.timestamp
      );
    }

    res.json({ id: newSessionId, title: newTitle });
  } catch (error: any) {
    console.error("[api/chat] Failed to branch session:", error);
    res.status(500).json({ error: error.message || "Failed to branch session" });
  }
});

router.patch("/sessions/:id", async (req, res) => {
  const db = await getDb();
  const { title, lastResponseId, model, provider } = req.body;
  const updates: string[] = [];
  const values: any[] = [];

  if (title !== undefined) {
    updates.push("title = ?");
    values.push(title);
  }
  if (lastResponseId !== undefined) {
    updates.push("last_response_id = ?");
    values.push(lastResponseId);
  }
  if (model !== undefined) {
    updates.push("model = ?");
    values.push(model);
  }
  if (provider !== undefined) {
    updates.push("provider = ?");
    values.push(provider);
  }
  if (updates.length === 0) {
    return res.json({ success: true });
  }

  updates.push("updated_at = ?");
  values.push(Date.now());
  values.push(req.params.id);

  await db.run(
    `UPDATE sessions SET ${updates.join(", ")} WHERE id = ?`,
    values,
  );
  res.json({ success: true });
});

router.post("/sessions/:id/messages", async (req, res) => {
  const db = await getDb();
  const {
    id: msgId,
    role,
    content,
    thinking,
    toolCalls,
    toolResults,
    attachments,
    generationInfo,
    timeline,
    metadata,
  } = req.body;
  const id = msgId || uuidv4();
  const timestamp = Date.now();

  try {
    await db.run(
      `INSERT INTO messages (id, session_id, role, content, thinking, tool_calls, tool_results, attachments, generation_info, timeline, metadata, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      req.params.id,
      role,
      content,
      thinking || null,
      toolCalls ? JSON.stringify(toolCalls) : null,
      toolResults ? JSON.stringify(toolResults) : null,
      attachments ? JSON.stringify(attachments) : null,
      generationInfo ? JSON.stringify(generationInfo) : null,
      timeline ? JSON.stringify(timeline) : null,
      metadata ? JSON.stringify(metadata) : null,
      timestamp,
    );
    await db.run(
      "UPDATE sessions SET updated_at = ? WHERE id = ?",
      Date.now(),
      req.params.id,
    );
    res.json({
      id,
      role,
      content,
      thinking,
      toolCalls,
      toolResults,
      attachments,
      generationInfo,
      timeline,
      metadata,
      timestamp,
    });
  } catch (error: any) {
    console.error("[api/chat] Failed to save message:", error);
    res.status(500).json({ error: error.message || "Failed to save message" });
  }
});

router.patch("/sessions/:sessionId/messages/:messageId", async (req, res) => {
  const db = await getDb();
  const {
    thinking,
    toolCalls,
    toolResults,
    attachments,
    generationInfo,
    content,
    timeline,
    metadata,
  } = req.body;
  const updates: string[] = [];
  const values: any[] = [];

  if (content !== undefined) {
    updates.push("content = ?");
    values.push(content);
  }
  if (thinking !== undefined) {
    updates.push("thinking = ?");
    values.push(thinking);
  }
  if (toolCalls !== undefined) {
    updates.push("tool_calls = ?");
    values.push(JSON.stringify(toolCalls));
  }
  if (toolResults !== undefined) {
    updates.push("tool_results = ?");
    values.push(JSON.stringify(toolResults));
  }
  if (attachments !== undefined) {
    updates.push("attachments = ?");
    values.push(JSON.stringify(attachments));
  }
  if (generationInfo !== undefined) {
    updates.push("generation_info = ?");
    values.push(JSON.stringify(generationInfo));
  }
  if (timeline !== undefined) {
    updates.push("timeline = ?");
    values.push(JSON.stringify(timeline));
  }
  if (metadata !== undefined) {
    updates.push("metadata = ?");
    values.push(JSON.stringify(metadata));
  }
  if (updates.length === 0) {
    return res.json({ success: true });
  }

  values.push(req.params.messageId);
  await db.run(
    `UPDATE messages SET ${updates.join(", ")} WHERE id = ?`,
    values,
  );
  res.json({ success: true });
});

router.get("/messages/:id/poll-cost", async (req, res) => {
  const db = await getDb();
  const { provider, responseId } = req.query;
  const { id } = req.params;

  if (!provider || !responseId) {
    return res.status(400).json({ error: "Missing provider or responseId" });
  }

  try {
    const providerInstance = await getProvider(provider as string);
    if (!providerInstance || provider !== "openrouter") {
      return res
        .status(400)
        .json({ error: "Invalid provider for cost polling" });
    }

    const apiKey = providerInstance.apiKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res
        .status(500)
        .json({ error: "Missing OpenRouter API key for cost polling" });
    }

    // Single poll attempt
    const statsRes = await fetch(
      `https://openrouter.ai/api/v1/generation?id=${responseId}`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
      },
    );

    if (statsRes.ok) {
      const stats = (await statsRes.json()) as any;
      const rawCost =
        stats.data?.total_cost ??
        stats.total_cost ??
        stats.data?.cost ??
        stats.cost;
      const foundCost = typeof rawCost === "string" ? Number(rawCost) : rawCost;
      if (typeof foundCost === "number" && Number.isFinite(foundCost)) {
        // Update DB
        const msg = await db.get(
          "SELECT generation_info FROM messages WHERE id = ?",
          id,
        );
        if (msg) {
          const info = JSON.parse(msg.generation_info || "{}");
          info.totalCost = foundCost;
          info.isGatheringCost = false;
          await db.run(
            "UPDATE messages SET generation_info = ? WHERE id = ?",
            JSON.stringify(info),
            id,
          );
        }
        return res.json({ cost: foundCost });
      }
    }
    res.json({ cost: null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function getErrorStatusCode(errorMessage: string): number {
  const msg = errorMessage.toLowerCase();
  if (
    msg.includes("api key") ||
    msg.includes("unauthorized") ||
    msg.includes("authentication") ||
    msg.includes("invalid_key")
  ) {
    return 401;
  }
  if (
    msg.includes("not found") ||
    (msg.includes("model") && msg.includes("does not exist"))
  ) {
    return 404;
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return 429;
  }
  if (msg.includes("bad request") || msg.includes("invalid")) {
    return 400;
  }
  return 500;
}

function getCleanErrorMessage(error: any, provider: string): string {
  let message = error.message || "Unknown error";

  // Try to parse nested JSON error messages
  try {
    if (message.includes("{")) {
      const jsonStart = message.indexOf("{");
      const jsonStr = message.substring(jsonStart);
      const parsed = JSON.parse(jsonStr);
      const rawNested = parsed.error?.metadata?.raw;
      if (typeof rawNested === "string") {
        try {
          const nestedParsed = JSON.parse(rawNested);
          if (nestedParsed.error?.message) {
            message = nestedParsed.error.message;
          }
        } catch {}
      }
      if (parsed.error?.message) {
        message = parsed.error.message;
      }
    }
  } catch {}

  // Add provider context
  if (!message.toLowerCase().includes(provider.toLowerCase())) {
    message = `${provider}: ${message}`;
  }

  return message;
}

router.post("/completions", async (req, res) => {
  const {
    messages,
    model,
    provider,
    systemPrompt,
    temperature,
    maxTokens,
    topP,
    reasoningEffort,
    disabledTools,
    lastResponseId,
    sessionId,
  } = req.body;

  console.log(
    `[chat] /completions - Request: { model: "${model}", provider: "${provider}", sessionId: "${sessionId}" }`,
  );

  try {
    const providerInstance = await getProvider(provider);
    if (!providerInstance) {
      console.error(
        `[chat] Provider "${provider}" not found or disabled in DB`,
      );
      return res
        .status(404)
        .json({ error: `Provider "${provider}" not found or disabled` });
    }

    console.log(
      `[chat] Using provider instance: ${providerInstance.name} (${providerInstance.type})`,
    );

    const db = await getDb();
    const settingsRow = (await db.get(
      "SELECT value FROM app_settings WHERE id = ?",
      "global",
    )) as any;
    const appSettings = settingsRow?.value
      ? JSON.parse(settingsRow.value || "{}")
      : {};
    const memoryEnabled = appSettings.memoryEnabled !== false;

    const disabledToolNames = Array.isArray(disabledTools)
      ? (disabledTools as string[])
      : [];
    if (!memoryEnabled && !disabledToolNames.includes("memory")) {
      disabledToolNames.push("memory");
    }
    const allTools = listTools().filter(
      (t) => !disabledToolNames.includes(t.name),
    );
    // Add MCP tools from enabled servers
    for (const mcpTool of mcpManager.getAllTools()) {
      if (!disabledToolNames.includes(mcpTool.name)) {
        allTools.push(mcpTool);
      }
    }

    const dateStr = `Today is ${new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;
    const memoryInstructions = memoryEnabled
      ? `\n\n## Memory\nThe following markdown file contains durable memories about the user. Use it to personalize responses when relevant.\n\n${readMemory()}\n\nMemory policy:\n- Use the memory tool sparingly for stable, useful user facts and preferences: name, likes/dislikes, hobbies, long-term projects, communication preferences, and current life context.\n- Do not save ordinary one-off requests, temporary facts, secrets, passwords, API keys, financial/medical/legal details, or sensitive personal data unless the user explicitly asks you to remember it.\n- If the user says to remember, update, correct, or forget something, use the memory tool.\n- If a new stable preference or profile fact is clearly useful for future conversations, you may save one concise memory.\n- Prefer concise memories; avoid duplicating existing memories.`
      : "";
    const mermaidInstructions = `\n\n## Rich Flowcharts & Diagrams (Mermaid)\nYou can render flowcharts, sequence diagrams, state diagrams, class diagrams, pie charts, and gantt charts using Mermaid syntax.\nTo display a diagram to the user, write it as a code block of type "mermaid" or wrap it in a markdown artifact. The frontend will automatically detect it and render an interactive preview.\nExample:\n\`\`\`mermaid\ngraph TD\n    A[Start] --> B(Process)\n    B --> C{Decision}\n    C -->|Yes| D[Result 1]\n    C -->|No| E[Result 2]\n\`\`\`\nUse Mermaid blocks whenever visualizing processes, system architectures, workflows, state transitions, or relationships.`;

    const enhancedSystemPrompt = systemPrompt
      ? `${dateStr}\n${systemPrompt}${memoryInstructions}${mermaidInstructions}`
      : `${dateStr}${memoryInstructions}${mermaidInstructions}`;

    // Process attachments: Read text files and append to message content.
    // Also expose image attachment URLs as plain text so tool-calling models can pass
    // the exact local URL to generate_image.sourceImageUrl when the user asks to edit
    // an uploaded image. The vision payload still remains attached for providers that
    // can see images directly.
    const processedMessages = await Promise.all(
      (messages || []).map(async (m: any) => {
        if (m.attachments && m.attachments.length > 0) {
          let content = m.content || "";
          const attachmentsToKeep = [];
          const imageAttachments = m.attachments.filter(
            (a: any) =>
              a?.type === "image" ||
              String(a?.mimeType || "").startsWith("image/"),
          );

          if (imageAttachments.length > 0) {
            const imageLines = imageAttachments.map((a: any, index: number) => {
              const label = a.name ? `${a.name}` : `image ${index + 1}`;
              return `- ${label}: image_url=${a.url}`;
            });
            const isVisualContextOnly = content.includes("VISUAL CONTEXT ONLY");
            const imageInstruction = isVisualContextOnly
              ? "These image_url values are visual context from a completed image tool call, not a new user request. Do not edit them again unless the user explicitly asks for another change."
              : "When editing an uploaded image with the generate_image tool, pass the exact image_url value as sourceImageUrl.";
            content += `\n\n[Image Attachments]\n${imageLines.join("\n")}\n${imageInstruction}`;
          }

          for (const a of m.attachments) {
            // Resolve file path correctly relative to the uploads directory
            const filename = path.basename(a.url);

            // Check multiple potential locations for the uploads folder
            const possiblePaths = [
              path.resolve(process.cwd(), "uploads", filename),
              path.resolve(process.cwd(), "server", "uploads", filename),
              path.resolve(__dirname, "../../uploads", filename),
              path.resolve(__dirname, "../../../uploads", filename),
            ];

            let filePath = possiblePaths.find((p) => fs.existsSync(p));

            // List of text-based extensions to read
            const textExtensions = [
              ".txt",
              ".md",
              ".json",
              ".js",
              ".ts",
              ".tsx",
              ".css",
              ".html",
              ".py",
              ".c",
              ".cpp",
              ".rs",
              ".go",
              ".sh",
              ".yaml",
              ".yml",
            ];
            const ext = path.extname(a.name).toLowerCase();

            if (textExtensions.includes(ext) && filePath) {
              try {
                console.log(
                  `[chat] Extracting text from ${a.name} (Path: ${filePath})`,
                );
                const textContent = fs.readFileSync(filePath, "utf-8");
                content += `\n\n[File Attachment: ${a.name}]\n\`\`\`${ext.slice(1) || "text"}\n${textContent}\n\`\`\``;
              } catch (err) {
                console.error(
                  `[chat] Failed to read text file ${a.name}:`,
                  err,
                );
                attachmentsToKeep.push(a);
              }
            } else {
              if (textExtensions.includes(ext)) {
                console.warn(
                  `[chat] Text file ${a.name} found but path could not be resolved. Tried:`,
                  possiblePaths,
                );
              }
              attachmentsToKeep.push(a);
            }
          }
          return { ...m, content, attachments: attachmentsToKeep };
        }
        return m;
      }),
    );

    const stream = providerInstance.chatCompletion({
      model,
      messages: [
        { role: "system", content: enhancedSystemPrompt },
        ...processedMessages,
      ],
      temperature,
      maxTokens,
      topP,
      reasoningEffort,
      tools:
        allTools.length > 0
          ? allTools.map((t) => ({ ...t, id: t.name }))
          : undefined,
      stream: true,
      lastResponseId,
      sessionId,
    });

    if (req.body.stream === false) {
      let fullContent = "";
      let fullThinking = "";
      let lastResponseId = "";
      let lastGenInfo = undefined;

      for await (const chunk of stream) {
        if (chunk.content) fullContent += chunk.content;
        if (chunk.thinking) fullThinking += chunk.thinking;
        if (chunk.responseId) lastResponseId = chunk.responseId;
        if (chunk.generationInfo) lastGenInfo = chunk.generationInfo;
      }
      return res.json({
        content: fullContent,
        thinking: fullThinking,
        responseId: lastResponseId,
        generationInfo: lastGenInfo,
      });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    let headersSent = false;
    for await (const chunk of stream) {
      if (!headersSent) {
        headersSent = true;
      }
      try {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      } catch {
        break;
      }
    }

    if (headersSent && !res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }
  } catch (error: any) {
    console.error(`[chat] ${provider} error:`, error.message);
    if (!res.headersSent) {
      const cleanMessage = getCleanErrorMessage(error, provider);
      const statusCode = getErrorStatusCode(cleanMessage);
      res.status(statusCode).json({ error: cleanMessage });
    } else {
      // Stream already started, send error as SSE event
      try {
        res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } catch {}
    }
  }
});

router.post("/tool-call", async (req, res) => {
  const { name, arguments: args } = req.body;
  try {
    const parsedArgs = typeof args === "string" ? safeJsonParse(args) : args;
    const result = await executeTool(name, parsedArgs);
    res.json({ result });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
