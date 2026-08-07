import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import chatRoutes from "./api/chat";
import providerRoutes from "./api/providers";
import settingsRoutes from "./api/settings";
import toolRoutes from "./api/tools";
import uploadRoutes from "./api/upload";
import skillRoutes from "./api/skills";
import mcpRoutes from "./api/mcp";
import imageRoutes from "./api/images";
import memoryRoutes from './api/memory'
import projectRoutes from './api/projects'
import localImageServerRoutes, {
  maybeAutoStartLocalImageServer,
} from "./api/local-image-server";
import hermesRoutes from './api/hermes'
import networkRoutes from './api/network'
import authRoutes from './api/auth'
import modelAliasRoutes from './api/model-aliases'
import { getDb } from "./db";
import { mcpManager } from "./mcp/mcp-manager";
import { apiAuthMiddleware, buildCorsOptions } from "./middleware/security";
import { attachUser } from "./middleware/auth";
import { initListenControl } from "./listen-control";
import { loadNetworkSecurity } from "./network-security";

const envPaths = new Set([
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
  path.resolve(__dirname, "..", "..", ".env"),
]);

for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

async function main() {
  // Initialize database
  await getDb();

  const app = express();
  const PORT = parseInt(process.env.PORT || "3456", 10);
  // If HOST is set in env (e.g. Docker), lock it. Otherwise start on loopback and
  // rebind to 0.0.0.0 when LAN access is enabled in Settings.
  const hostLocked = process.env.HOST !== undefined && process.env.HOST !== "";
  let HOST = process.env.HOST || "127.0.0.1";

  // If LAN was already enabled in a previous session and HOST isn't locked, start open
  try {
    const net = await loadNetworkSecurity();
    if (!hostLocked && net.lanAccessEnabled) {
      HOST = "0.0.0.0";
    }
  } catch {
    // ignore
  }

  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: "50mb" }));
  // Attach user from cookie (if present) before any route logic
  app.use(attachUser as any);

  // Auth / remote-access guard for /api/* and sensitive static mounts
  // (/uploads, /workspace). Must run before express.static for those paths.
  app.use(apiAuthMiddleware);

  // Require cookie auth for all /api/* except bootstrap/public auth endpoints
  app.use((req: any, res, next) => {
    const p = req.path || '';
    const m = req.method || 'GET';
    // Public / bootstrap paths (same as security.isBootstrap + auth me for polling)
    const isPublic =
      p === '/api/health' || p === '/health' ||
      (p === '/api/network' && m === 'GET') ||
      (p === '/api/network/unlock' && m === 'POST') ||
      (p.startsWith('/api/auth/') ) ||
      p === '/api/model-aliases-public' ||
      (p === '/api/settings' && m === 'GET') ||
      false;
    if (isPublic) return next();
    if (p.startsWith('/api/')) {
      if (!req.user) {
        return res.status(401).json({ error: 'Not authenticated', code: 'LOGIN_REQUIRED' });
      }
      // Enforce approval status again (attachUser already filtered pending)
      if (req.user.status !== 'approved') {
        return res.status(403).json({ error: 'Account pending approval', code: 'PENDING_APPROVAL' });
      }
    }
    // Protect uploads/workspace statically - require auth too
    if ((p === '/uploads' || p.startsWith('/uploads/') || p === '/workspace' || p.startsWith('/workspace/')) ) {
      if (!req.user) return res.status(401).json({ error: 'Not authenticated', code: 'LOGIN_REQUIRED' });
    }
    next();
  });

  app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));
  app.use("/workspace", express.static(path.join(process.cwd(), "workspace")));

  // Ensure workspace directory exists
  const workspaceDir = path.join(process.cwd(), "workspace");
  if (!fs.existsSync(workspaceDir))
    fs.mkdirSync(workspaceDir, { recursive: true });

  app.use("/api/auth", authRoutes);
  // public aliases list (enabled) — also mounted under /api/model-aliases for admin; expose same path with auth gate inside file
  // For non-admin, GET is allowed with filtered view; POST/PATCH/DELETE require admin (handled in router)
  app.use("/api/model-aliases", modelAliasRoutes);

  // Public endpoint for model aliases (enabled only) — no admin needed
  app.get("/api/model-aliases-public", async (_req, res) => {
    const { listEnabledAliases } = await import("./api/model-aliases");
    res.json(await listEnabledAliases());
  });

  app.use("/api/chat", chatRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/providers", providerRoutes);
  app.use("/api/tools", toolRoutes);
  app.use("/api/upload", uploadRoutes);
  app.use("/api/skills", skillRoutes);
  app.use("/api/mcp", mcpRoutes);
  app.use("/api/images", imageRoutes);
  app.use("/api/memory", memoryRoutes);
  app.use("/api/projects", projectRoutes);
  app.use("/api/local-image-server", localImageServerRoutes);
  app.use("/api/hermes", hermesRoutes);
  app.use("/api/network", networkRoutes);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", version: "0.1.0" });
  });

  // Serve static frontend in production
  const frontendDist = path.join(__dirname, "..", "..", "frontend", "dist");
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  const server = app.listen(PORT, HOST, async () => {
    console.log(`[server] Running on http://${HOST}:${PORT}`);
    try {
      const net = await loadNetworkSecurity();
      if (net.lanAccessEnabled) {
        console.log(
          `[security] LAN access enabled (token ${net.requireToken ? "required" : "not required"})`,
        );
      } else {
        console.log("[security] LAN access disabled (localhost use)");
      }
    } catch {
      // ignore
    }

    // Initialize MCP servers after server is ready
    try {
      await maybeAutoStartLocalImageServer();
    } catch (err: any) {
      console.error("[local-image-server] Failed to auto-start:", err.message);
    }
    try {
      await mcpManager.loadFromDb();
    } catch (err: any) {
      console.error("[mcp] Failed to initialize:", err.message);
    }
  });

  initListenControl({
    server,
    host: HOST,
    port: PORT,
    hostLocked,
  });
}

main().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
