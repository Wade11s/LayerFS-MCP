import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const client = new Client({ name: "layerfs-apple-example", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath,
  args: [fileURLToPath(new URL("../dist/cli.js", import.meta.url)), "apple", "serve", "--project", process.argv[2] || "default"],
  stderr: "inherit" }));
try {
  const status = await client.callTool({ name: "layerfs_status", arguments: {} });
  const read = await client.callTool({ name: "layerfs_fs_read", arguments: { ref: "main", path: "/README.md" } });
  for (const result of [status, read]) if (result.isError) throw new Error(JSON.stringify(result.structuredContent || result.content));
  const { project, hostRuntime, executionEngine, missing } = status.structuredContent.result;
  console.log(JSON.stringify({ transport: "stdio", tools: (await client.listTools()).tools.length,
    status: { project, hostRuntime, executionEngine, missing }, file: read.structuredContent.result }, null, 2));
} finally { await client.close(); }
