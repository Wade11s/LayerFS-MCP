import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { exerciseLayerFS } from "./workflow.mjs";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("real LayerFS: import, isolated edits, atomic apply, history, merge, publish, diagnostics and FUSE execution", { skip: process.env.LAYERFS_REAL_TESTS !== "1", timeout: 180_000 }, async t => {
  assert.equal(process.platform, "linux", "The upstream Store requires Linux");
  const project = `mcp-test-${randomUUID().slice(0, 8)}`;
  const source = await mkdtemp(join(tmpdir(), "layerfs-mcp-source-"));
  const home = await mkdtemp(join(tmpdir(), "layerfs-mcp-home-"));
  await writeFile(join(source, "README.md"), "original\n");
  await mkdir(dirname(process.env.LAYERFS_STORE_PATH), { recursive: true, mode: 0o700 });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../../dist/cli.js", import.meta.url))], env: { ...process.env, LAYERFS_MCP_PROJECT: project, LAYERFS_HOME: home }, stderr: "inherit" });
  const client = new Client({ name: "real-layerfs-test", version: "1.0.0" });
  await client.connect(transport);
  t.after(() => client.close());
  await exerciseLayerFS(client, { source, project, workspaces: process.env.LAYERFS_REAL_WORKSPACES === "1" });
});
