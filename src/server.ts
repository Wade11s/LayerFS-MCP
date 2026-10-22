import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { Backend } from "./backend.js";
import { UPSTREAM_COMMIT } from "./backend.js";
import type { Config } from "./config.js";
import { tools, type ToolDefinition } from "./contract.js";

export const INSTRUCTIONS = `LayerFS-MCP exposes real LayerFS; one server selects one project.
Use layerfs_status first. Fork from main before writing. fs mutations checkpoint automatically.
If runtimeState is preparing, wait and check layerfs_status again. RuntimePreparing means no LayerFS call was started.
If runtimeState is failed, report the error and resolve the environment before reconnecting. Project import is always explicit.
For commands: workspace_mount -> workspace_exec -> workspace_commit -> workspace_unmount.
Save the exact {sandbox,path} handle. Each agent should have its own branch and Workspace.
Workspace exec and background processes do not commit automatically. Checkpoint even after a command fails.
main is published history; use branch_publish to change it. .lww rules and storage deduplication are upstream semantics.
All successful tool results are in structuredContent.result and mirrored as JSON text for older clients.
Pages retain hasMore/nextCursor/nextLine/truncation flags. Never interpret an incomplete diagnostic as a clean merge.
Errors preserve code/message/detail and isError=true. No call is retried. Unknown, a disconnect or a client timeout
can leave effects in progress or uncertain: inspect state and history before attempting another operation.
The Store is Disposable: upstream provides no crash/power-loss durability. Keep original data elsewhere.
Full tool mode grants filesystem import, command execution and container-backed Workspace access to authorized clients.`;

export function enabledTools(config: Config): ToolDefinition[] {
  return tools.filter(tool => (config.operator || !tool.operator)
    && (!config.readOnly || tool.readOnly) && (config.exec || !tool.execution));
}

function wire(value: unknown): any {
  if (value === undefined || value === null) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return { encoding: "base64", data: Buffer.from(value).toString("base64") };
  if (Array.isArray(value)) return value.map(wire);
  if (typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, wire(v)]));
  return value;
}

export function success(value: unknown): CallToolResult {
  const output = { result: wire(value) };
  return { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

export function failure(error: unknown): CallToolResult {
  const caught = error as { code?: unknown; message?: unknown; detail?: unknown } | null;
  const output = { error: {
    code: typeof caught?.code === "string" ? caught.code : "BridgeError",
    message: typeof caught?.message === "string" ? caught.message : String(error),
    detail: wire(caught?.detail),
  } };
  return { isError: true, content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output };
}

export function createServer(config: Config, backend: Backend): McpServer {
  const server = new McpServer({ name: "LayerFS-MCP", version: "0.1.0" }, { instructions: INSTRUCTIONS });
  const enabled = enabledTools(config);
  const capabilities = {
    upstreamCommit: UPSTREAM_COMMIT, project: config.project,
    publicMethods: enabled.filter(t => !t.operator).length,
    operatorMethods: enabled.filter(t => t.operator).length,
    policy: { readOnly: config.readOnly, operator: config.operator, exec: config.exec },
    methods: enabled.map(({ name, method, description, readOnly }) => ({ name, method, description, readOnly })),
  };
  server.registerTool("layerfs_status", {
    description: "Check configuration, automatic runtime preparation progress, pinned upstream revision and exposed methods. This read does not initialize project data or trigger another preparation attempt.",
    inputSchema: z.object({}).strict(),
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try { return success({ ...await backend.diagnostics(), capabilities }); }
    catch (error) { return failure(error); }
  });
  for (const definition of enabled) {
    server.registerTool(definition.name, {
      description: definition.description,
      inputSchema: definition.schema,
      annotations: {
        readOnlyHint: definition.readOnly,
        destructiveHint: definition.destructive,
        idempotentHint: definition.readOnly,
        openWorldHint: !definition.readOnly,
      },
    }, async input => {
      try {
        const parsed = definition.schema.parse(input);
        return success(await backend.invoke(definition.method, definition.args(parsed), parsed));
      } catch (error) { return failure(error); }
    });
  }
  server.registerResource("guide", "layerfs://guide", { mimeType: "text/plain", description: "LayerFS workflow and error semantics" }, async uri => ({ contents: [{ uri: uri.href, text: INSTRUCTIONS }] }));
  server.registerResource("capabilities", "layerfs://capabilities", { mimeType: "application/json", description: "Exact SDK-to-tool mapping enabled on this server" }, async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify(capabilities) }] }));
  server.registerResource("branches", "layerfs://branches", { mimeType: "application/json", description: "First page of project branches; use the list tool for continuation" }, async uri => ({ contents: [{ uri: uri.href, text: JSON.stringify(wire(await backend.invoke("project.list_branches", [50, 0]))) }] }));
  if (!config.readOnly) server.registerPrompt("layerfs_workflow", {
    description: "Plan isolated agent work with checkpoints, merge and publication",
    argsSchema: { task: z.string(), branch: z.string().optional() },
  }, async ({ task, branch }) => ({ messages: [{ role: "user", content: { type: "text", text: `${INSTRUCTIONS}\n\nTask: ${task}\nSuggested branch: ${branch || "choose a fresh branch name"}. Inspect existing history, carry out the task, checkpoint changes, and report the branch and commit ids. Publish only when the user's task authorizes publication.` } }] }));
  return server;
}
