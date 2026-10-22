import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { exerciseLayerFS } from "./workflow.mjs";

test("Mac CLI -> Apple Container -> Podman/crun -> all 40 real LayerFS methods", { skip: process.env.LAYERFS_APPLE_TESTS !== "1", timeout: 180_000 }, async t => {
  assert.equal(process.platform, "darwin");
  const project = process.env.LAYERFS_APPLE_TEST_PROJECT;
  const name = process.env.LAYERFS_APPLE_TEST_NAME;
  assert(project && name, "Use scripts/test-apple.mjs to create an isolated VM first");
  async function connect(label) {
    const client = new Client({ name: label, version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath,
      args: [fileURLToPath(new URL("../../dist/cli.js", import.meta.url)), "apple", "serve", "--project", project, "--name", name],
      env: process.env, stderr: "inherit" }));
    t.after(() => client.close());
    return client;
  }
  const client = await connect("apple-real-test");
  assert.equal((await client.listTools()).tools.length, 41);
  const status = (await client.callTool({ name: "layerfs_status", arguments: {} })).structuredContent.result;
  assert.equal(status.hostRuntime, "apple-container");
  assert.equal(status.executionEngine, "podman");
  assert.deepEqual(status.missing, []);
  await exerciseLayerFS(client, { source: "/example-seed", project });
  const another = await connect("another-agent");
  const read = await another.callTool({ name: "layerfs_fs_read", arguments: { ref: "merged", path: "/command.txt" } });
  assert(!read.isError, JSON.stringify(read));
  assert.match(read.structuredContent.result.text, /from-command/);
});
