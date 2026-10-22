import express from "express";
import type { Server } from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { localhostHostValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Backend } from "./backend.js";
import { type Config, loopback } from "./config.js";
import { createServer } from "./server.js";

const digest = (value: string) => createHash("sha256").update(value).digest();

export async function serveHttp(config: Config, backend: Backend): Promise<Server> {
  if (!loopback(config.host) && !config.token) throw new Error("Non-loopback HTTP requires LAYERFS_MCP_TOKEN");
  const app = express();
  app.disable("x-powered-by");
  if (loopback(config.host)) app.use(localhostHostValidation());
  app.use((req, res, next) => {
    const origin = req.get("origin");
    if (origin) {
      try {
        const parsed = new URL(origin);
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== req.get("host")) {
          res.status(403).json({ error: "Origin is not allowed" }); return;
        }
      } catch { res.status(403).json({ error: "Invalid Origin" }); return; }
    }
    if (config.token) {
      const provided = req.get("authorization") || "";
      if (!timingSafeEqual(digest(provided), digest(`Bearer ${config.token}`))) {
        res.set("WWW-Authenticate", 'Bearer realm="LayerFS-MCP"').status(401).json({ error: "Unauthorized" }); return;
      }
    }
    next();
  });
  app.use(express.json({ limit: process.env.LAYERFS_MCP_BODY_LIMIT || "64mb" }));
  app.get("/health", (_req, res) => { res.json({ server: "LayerFS-MCP", project: config.project, status: "listening" }); });
  app.post("/mcp", async (req, res) => {
    const server = createServer(config, backend);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.once("close", () => { void server.close().catch(error => console.error("MCP connection cleanup failed:", error)); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("MCP HTTP request failed:", error);
      if (!res.headersSent) res.status(500).json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Internal server error" } });
      await server.close();
    }
  });
  app.all("/mcp", (_req, res) => {
    res.set("Allow", "POST").status(405).json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Stateless MCP endpoint supports POST only" } });
  });
  app.use((error: { type?: string; status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const malformed = error.type === "entity.parse.failed";
    const oversized = error.type === "entity.too.large";
    res.status(oversized ? 413 : malformed ? 400 : 500).json({
      jsonrpc: "2.0", id: null,
      error: { code: malformed ? -32700 : -32000, message: oversized ? "Request body too large" : malformed ? "Invalid JSON" : "Internal server error" },
    });
  });
  return new Promise((resolve, reject) => {
    const listener = app.listen(config.port, config.host, (error?: Error) => error ? reject(error) : resolve(listener));
    listener.once("error", reject);
    listener.requestTimeout = 0; // Commands may run longer than a normal HTTP request.
  });
}
