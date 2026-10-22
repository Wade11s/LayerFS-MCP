import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const args = ["compose", "--project-directory", root];
if (process.platform === "linux") args.push("-f", `${root}/compose.yaml`, "-f", `${root}/compose.linux.yaml`);
args.push("run", "--rm", "--no-deps", "-T", "layerfs-mcp", "--transport", "stdio");
const client = new Client({ name: "layerfs-stdio-example", version: "1.0.0" });
await client.connect(new StdioClientTransport({ command: "docker", args, stderr: "inherit" }));
try {
  const result = await client.callTool({ name: "layerfs_fs_read", arguments: { ref: "main", path: "/README.md" } });
  if (result.isError) throw new Error(JSON.stringify(result.structuredContent || result.content));
  console.log(JSON.stringify({ transport: "stdio", tools: (await client.listTools()).tools.length, file: result.structuredContent.result }, null, 2));
} finally { await client.close(); }
