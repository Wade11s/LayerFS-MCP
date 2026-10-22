import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// This reads key=value data; it never evaluates shell input or logs the token.
const local = {};
try {
  const file = await readFile(new URL("../.env", import.meta.url), "utf8");
  for (const line of file.split("\n")) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line);
    if (match) local[match[1]] = match[2];
  }
} catch (error) { if (error.code !== "ENOENT") throw error; }
const token = process.env.LAYERFS_MCP_TOKEN || local.LAYERFS_MCP_TOKEN;
const url = process.env.LAYERFS_MCP_URL || "http://127.0.0.1:8787/mcp";
const client = new Client({ name: "layerfs-example", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: token ? { Authorization: `Bearer ${token}` } : {} } }));
try {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== "--init" || args.length !== 2)) throw new Error("Usage: node examples/client.mjs [--init /absolute/server/source/path]");
  const result = args[0] === "--init"
    ? await client.callTool({ name: "layerfs_project_init", arguments: { sourcePath: args[1] } }, undefined, { timeout: 120_000 })
    : await client.callTool({ name: "layerfs_status", arguments: {} });
  if (result.isError) { console.error(JSON.stringify(result.structuredContent || result.content, null, 2)); process.exitCode = 1; }
  else if (args[0] === "--init") console.log(JSON.stringify(result.structuredContent, null, 2));
  else {
    const value = result.structuredContent.result;
    console.log(JSON.stringify({ server: value.server, project: value.project, tools: (await client.listTools()).tools.length, platform: value.platform, missing: value.missing, upstream: value.upstreamCommit }, null, 2));
  }
} finally { await client.close(); }
