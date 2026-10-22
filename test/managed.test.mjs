import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ManagedBackend } from "../dist/managed.js";
import { createServer } from "../dist/server.js";
import { configuration } from "../dist/config.js";
import { resolveProfile, readProfile, withRuntimeLock } from "../dist/runtime.js";

const profile = { version: 1, backend: "docker", project: "example", name: "test-runtime", image: "example:local", cpus: "2", memory: "2G" };

test("cold bootstrap permits immediate MCP discovery; calls are not queued or replayed; ready proxy preserves inputs/errors", async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const calls = [];
  const remote = { close: async () => {}, callTool: async request => {
    calls.push(request);
    if (request.name === "layerfs_fs_edit") return { isError: true, structuredContent: { error: { code: "Conflict", message: "conflict", detail: { index: 2 } } } };
    return { structuredContent: { result: request.name === "layerfs_project_list_branches" ? { items: [], hasMore: false } : { accepted: true } } };
  } };
  const backend = new ManagedBackend(profile, async (_p, _s, stage) => { stage("building-image"); await gate; }, async () => remote);
  const server = createServer(configuration({ LAYERFS_MCP_PROJECT: profile.project }), backend);
  const client = new Client({ name: "bootstrap-test", version: "1" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a);
  backend.start();
  await client.connect(b);
  t.after(async () => { release(); await client.close(); await backend.close(); await server.close(); });
  assert.equal((await client.listTools()).tools.length, 41);
  assert.equal((await client.callTool({ name: "layerfs_status", arguments: {} })).structuredContent.result.runtimeState, "preparing");
  const blocked = await client.callTool({ name: "layerfs_fs_write", arguments: { branch: "a", path: "/binary", content: "AP8=", encoding: "base64" } });
  assert.equal(blocked.structuredContent.error.code, "RuntimePreparing");
  assert.equal(calls.length, 0);
  release(); await backend.waitReady();
  assert.equal(calls.length, 0, "Rejected writes must not execute later");
  const input = { branch: "a", changes: [{ op: "write", path: "/binary", content: "AP8=", encoding: "base64" }, { op: "mkdir", path: "/dir" }] };
  await client.callTool({ name: "layerfs_fs_apply", arguments: input });
  assert.deepEqual(calls[0], { name: "layerfs_fs_apply", arguments: input });
  const conflict = await client.callTool({ name: "layerfs_fs_edit", arguments: { branch: "a", path: "/text", oldText: "a", newText: "b" } });
  assert.equal(conflict.isError, true);
  assert.deepEqual(conflict.structuredContent.error, { code: "Conflict", message: "conflict", detail: { index: 2 } });
  assert.equal(calls.filter(c => c.name === "layerfs_fs_edit").length, 1);
  await client.readResource({ uri: "layerfs://branches" });
  assert.deepEqual(calls.at(-1), { name: "layerfs_project_list_branches", arguments: { pageSize: 50, pagePos: 0 } });
});

test("failed bootstrap remains inspectable and refuses methods without reconnecting implicitly", async () => {
  let attempts = 0;
  const backend = new ManagedBackend(profile, async () => { attempts++; throw Error("engine unavailable"); });
  await assert.rejects(backend.waitReady(), /engine unavailable/);
  assert.equal((await backend.diagnostics()).runtimeState, "failed");
  await assert.rejects(backend.invoke("fs.write", [], {}), { code: "RuntimeUnavailable" });
  assert.equal(attempts, 1);
  await backend.close();
});

test("profiles persist independently of package location and locks serialize provisioning while remaining cancellable", async () => {
  const directory = await mkdtemp(join(tmpdir(), "layerfs-profile-test-"));
  const previous = process.env.LAYERFS_MCP_CONFIG_DIR;
  process.env.LAYERFS_MCP_CONFIG_DIR = directory;
  const signal = new AbortController().signal;
  try {
    const [first, second] = await Promise.all([resolveProfile({ backend: "docker" }, "shared", signal), resolveProfile({ backend: "docker" }, "shared", signal)]);
    assert.deepEqual(first, second);
    assert.deepEqual(await resolveProfile({}, "shared", signal), first);
    assert.deepEqual(await readProfile("shared"), first);
    assert.equal(await readProfile("missing"), undefined);
    await assert.rejects(resolveProfile({ backend: "apple" }, "shared", signal));
    await assert.rejects(resolveProfile({ image: "unexpected:latest" }, "shared", signal), /different image/);
    await assert.rejects(readProfile("../unsafe"));
    let release;
    let entered;
    const inside = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const held = withRuntimeLock("same-project", signal, async () => { entered(); await gate; });
    await inside;
    const controller = new AbortController();
    const waiting = withRuntimeLock("same-project", controller.signal, async () => { assert.fail("Lock must not be acquired concurrently"); });
    controller.abort();
    await assert.rejects(waiting);
    release(); await held;
  } finally {
    if (previous === undefined) delete process.env.LAYERFS_MCP_CONFIG_DIR; else process.env.LAYERFS_MCP_CONFIG_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("close completes even when the runtime connection never does", async () => {
  let entered;
  const stuck = new Promise(resolve => { entered = resolve; });
  const backend = new ManagedBackend(profile, async () => {}, () => { entered(); return new Promise(() => {}); });
  backend.start();
  await stuck;
  const finished = await Promise.race([backend.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))]);
  assert.equal(finished, true, "close() must complete even if connect never settles");
  assert.equal((await backend.diagnostics()).runtimeState, "closed");
});

test("a client that arrives after close is closed exactly once and the bridge never becomes ready", async () => {
  let entered;
  let release;
  const inside = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  let closes = 0;
  const calls = [];
  const remote = {
    close: async () => { closes++; },
    callTool: async request => { calls.push(request); return { structuredContent: { result: {} } }; },
  };
  const backend = new ManagedBackend(profile, async () => {}, async () => { entered(); await gate; return remote; });
  backend.start();
  await inside;
  await backend.close();
  release();
  await gate;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closes, 1);
  assert.equal((await backend.diagnostics()).runtimeState, "closed");
  assert.equal(calls.length, 0);
});

test("close during prepare leaves the bridge closed and cancellable", async () => {
  let entered;
  const inside = new Promise(resolve => { entered = resolve; });
  const backend = new ManagedBackend(profile, async (_profile, signal) => {
    entered();
    signal.throwIfAborted();
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
  });
  backend.start();
  await inside;
  const finished = await Promise.race([backend.close().then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 1000))]);
  assert.equal(finished, true);
  assert.equal((await backend.diagnostics()).runtimeState, "closed");
});

test("a refused handshake becomes visible failure state, not an unhandled rejection", async () => {
  const rejections = [];
  const onRejection = reason => rejections.push(reason);
  process.on("unhandledRejection", onRejection);
  try {
    const backend = new ManagedBackend(profile, async () => {}, async () => { throw new Error("handshake refused"); });
    backend.start();
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.deepEqual(rejections, [], "the bridge must handle its own rejection");
    const status = await backend.diagnostics();
    assert.equal(status.runtimeState, "failed");
    assert.equal(status.error, "handshake refused");
  } finally {
    process.off("unhandledRejection", onRejection);
  }
});
