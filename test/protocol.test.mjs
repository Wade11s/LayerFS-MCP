import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createServer } from "../dist/server.js";
import { configuration } from "../dist/config.js";

async function connect(t, overrides = {}, implementation) {
  const calls = [];
  const backend = {
    diagnostics: async () => ({ testBackend: true }), close: async () => {},
    invoke: async (method, args) => { calls.push({ method, args }); return implementation ? implementation(method, args) : { method, args }; },
  };
  const server = createServer({ ...configuration({}), ...overrides }, backend);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  return { client, calls };
}

test("standard client discovers every public/operator method, resources and prompt", async t => {
  const { client } = await connect(t);
  const { tools } = await client.listTools();
  assert.equal(tools.length, 41);
  assert.equal(tools.filter(v => v.name.startsWith("layerfs_operator_")).length, 13);
  assert.equal(new Set(tools.map(v => v.name)).size, 41);
  for (const tool of tools) assert.equal(tool.inputSchema.type, "object");
  assert.equal(tools.find(v => v.name === "layerfs_fs_read").annotations.readOnlyHint, true);
  assert.equal(tools.find(v => v.name === "layerfs_fs_rm").annotations.destructiveHint, true);
  assert.equal((await client.listResources()).resources.length, 3);
  const resource = await client.readResource({ uri: "layerfs://capabilities" });
  assert.equal(JSON.parse(resource.contents[0].text).publicMethods, 27);
  assert.equal((await client.listPrompts()).prompts.length, 1);
  const prompt = await client.getPrompt({ name: "layerfs_workflow", arguments: { task: "Fix a bug", branch: "fix" } });
  assert.match(prompt.messages[0].content.text, /Fix a bug/);
});

test("binary write, ordered atomic apply and optional flags reach the SDK unchanged", async t => {
  const { client, calls } = await connect(t);
  const invoke = (name, args) => client.callTool({ name, arguments: args });
  assert.equal((await invoke("layerfs_fs_write", { branch: "a", path: "/file", content: "AP8=", encoding: "base64", message: "binary" })).isError, undefined);
  assert.deepEqual(calls[0], { method: "fs.write", args: ["a", "/file", Buffer.from([0, 255]), "binary"] });
  await invoke("layerfs_fs_apply", { branch: "a", changes: [{ op: "mkdir", path: "/d" }, { op: "write", path: "/d/file", content: "AP8=", encoding: "base64" }, { op: "mv", from: "/d/file", to: "/d/b" }] });
  assert.equal(calls[1].method, "fs.apply");
  assert.deepEqual(calls[1].args[1], [{ op: "mkdir", path: "/d" }, { op: "write", path: "/d/file", bytes: Buffer.from([0, 255]) }, { op: "mv", from: "/d/file", to: "/d/b" }]);
  await invoke("layerfs_branch_diff_commits", { from: "c1", to: "c2", cursor: "/a", hunks: false, pageSize: 2, pagePos: 0 });
  assert.deepEqual(calls[2].args, ["c1", "c2", 2, 0, { cursor: "/a", hunks: false }]);
  await invoke("layerfs_workspace_commit", { ws: { sandbox: "1", path: "/workspaces/1" }, force: false, message: "" });
  assert.deepEqual(calls[3].args, [{ sandbox: "1", path: "/workspaces/1" }, "", false]);
  await invoke("layerfs_branch_merge", { a: "a", b: "b", name: "merged", units: [{ name: "ui", patterns: ["/ui/**"] }] });
  assert.deepEqual(calls[4].args, ["a", "b", "merged", undefined, [{ name: "ui", patterns: ["/ui/**"] }]]);
});

test("refusals preserve conflict details and uncertain operations are invoked once", async t => {
  const detail = { conflicts: [{ path: "/a", hunksOmitted: true }], conflictsTruncated: true, head: "new-head" };
  const { client, calls } = await connect(t, {}, () => { throw Object.assign(new Error("inspect before retry"), { code: "Unknown", detail }); });
  const result = await client.callTool({ name: "layerfs_fs_write", arguments: { branch: "a", path: "/a", content: "x" } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent.error, { code: "Unknown", message: "inspect before retry", detail });
  assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
  assert.equal(calls.length, 1);
});

test("pagination, null metrics and full command output are retained", async t => {
  const value = { items: [{ id: "c1" }], hasMore: true, nextCursor: "/a", dedupe: null, stdout: "x".repeat(2 ** 20 + 3), truncated: false };
  const { client } = await connect(t, {}, () => value);
  const result = await client.callTool({ name: "layerfs_workspace_exec", arguments: { ws: { sandbox: "1", path: "/workspaces/1" }, command: "test" } });
  assert.deepEqual(result.structuredContent.result, value);
});

test("invalid input is refused before invoking the backend", async t => {
  const { client, calls } = await connect(t);
  for (const args of [{ ref: "main", path: "relative" }, { ref: "main", path: "/", pageSize: 0 }, { ref: "main", path: "/", pagePos: -1 }, { ref: "main", path: "/", typo: true }]) {
    assert.equal((await client.callTool({ name: "layerfs_fs_list", arguments: args })).isError, true);
  }
  assert.equal((await client.callTool({ name: "layerfs_fs_write", arguments: { branch: "a", path: "/a", content: "not base64", encoding: "base64" } })).isError, true);
  assert.equal(calls.length, 0);
});

test("read-only and disabled execution policies apply at tool discovery and invocation", async t => {
  const { client, calls } = await connect(t, { readOnly: true });
  const { tools } = await client.listTools();
  assert(tools.every(v => v.annotations.readOnlyHint === true));
  assert.equal((await client.callTool({ name: "layerfs_fs_write", arguments: { branch: "a", path: "/a", content: "x" } })).isError, true);
  assert.equal(calls.length, 0);
  const restricted = await connect(t, { operator: false, exec: false });
  const names = (await restricted.client.listTools()).tools.map(v => v.name);
  assert(!names.some(v => v.startsWith("layerfs_operator_")));
  assert(!names.includes("layerfs_workspace_exec"));
});

test("actual CLI works over stdio; missing SDK is a structured error, stdout stays protocol-only", async t => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ["dist/cli.js", "--backend", "native"], env: { PATH: process.env.PATH, LAYERFS_MCP_PROJECT: "test" }, stderr: "pipe" });
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  t.after(() => client.close());
  await client.connect(transport);
  assert.equal((await client.listTools()).tools.length, 41);
  const result = await client.callTool({ name: "layerfs_status", arguments: {} });
  assert.equal(result.structuredContent.result.project, "test");
  assert(result.structuredContent.result.missing.includes("LAYERFS_SDK_PATH"));
  const refused = await client.callTool({ name: "layerfs_project_list_branches", arguments: {} });
  assert.equal(refused.isError, true);
  assert.equal(refused.structuredContent.error.code, "ConfigurationError");
});
