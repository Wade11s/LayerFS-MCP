import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { serveHttp } from "../dist/http.js";
import { configuration } from "../dist/config.js";

test("Streamable HTTP supports official MCP clients, concurrent clients and bearer auth", async t => {
  const calls = [];
  const backend = { diagnostics: async () => ({ configured: true }), close: async () => {}, invoke: async (method, args) => { calls.push({ method, args }); return { items: [], hasMore: false }; } };
  const server = await serveHttp({ ...configuration({}), transport: "http", token: "test-secret", port: 0 }, backend);
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = new URL(`http://127.0.0.1:${server.address().port}/mcp`);
  assert.equal((await fetch(url, { method: "POST" })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer test-secret", Origin: "https://evil.example" } })).status, 403);
  const invalidHost = await new Promise((resolve, reject) => {
    const req = request(url, { headers: { Authorization: "Bearer test-secret", Host: "evil.example" } }, res => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(invalidHost, 403);
  const malformed = await fetch(url, { method: "POST", headers: { Authorization: "Bearer test-secret", "Content-Type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, -32700);
  assert.equal((await fetch(url, { headers: { Authorization: "Bearer test-secret" } })).status, 405);
  await Promise.all([1, 2].map(async index => {
    const client = new Client({ name: `http-${index}`, version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers: { Authorization: "Bearer test-secret" } } });
    await client.connect(transport);
    try {
      assert.equal((await client.listTools()).tools.length, 41);
      const result = await client.callTool({ name: "layerfs_project_list_branches", arguments: { pageSize: 10 } });
      assert.deepEqual(result.structuredContent.result, { items: [], hasMore: false });
    } finally { await client.close(); }
  }));
  assert.equal(calls.length, 2);
});

test("binding to a network interface without authentication is refused", async () => {
  await assert.rejects(serveHttp({ ...configuration({}), host: "0.0.0.0", port: 0 }, {}), /requires LAYERFS_MCP_TOKEN/);
});
