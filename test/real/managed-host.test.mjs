import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { assertAppleOwnership, appleOptions } from "../../dist/apple.js";
import { assertDockerOwnership } from "../../dist/docker.js";
import { exerciseLayerFS } from "./workflow.mjs";

test("unified CLI cold serve without setup, all 40 methods, saved backend, independent agents, HTTP and restart", {
  skip: process.env.LAYERFS_MANAGED_TESTS !== "1", timeout: 900_000,
}, async () => {
  const backend = process.env.LAYERFS_TEST_BACKEND || (process.platform === "darwin" ? "apple" : "docker");
  assert(["apple", "docker"].includes(backend));
  const project = `managed-test-${randomUUID().slice(0, 8)}`;
  const { name } = appleOptions({ project });
  const directory = await mkdtemp(join(tmpdir(), "layerfs-managed-config-"));
  const env = { ...process.env, LAYERFS_MCP_CONFIG_DIR: directory };
  delete env.LAYERFS_SDK_PATH; delete env.LAYERFS_MCP_BACKEND;
  const command = process.env.LAYERFS_TEST_COMMAND || process.execPath;
  const commandArgs = process.env.LAYERFS_TEST_COMMAND_ARGS ? JSON.parse(process.env.LAYERFS_TEST_COMMAND_ARGS)
    : [process.env.LAYERFS_TEST_CLI || fileURLToPath(new URL("../../dist/cli.js", import.meta.url))];
  const clients = [];
  let httpProcess;
  let httpExited;
  function run(bin, args, allowMissing = false) {
    const result = spawnSync(bin, args, { env, encoding: "utf8" });
    if (result.error) throw result.error;
    if (result.status !== 0) { if (allowMissing) return; throw new Error(`${bin} ${args[0]}: ${result.stderr}`); }
    return result.stdout;
  }
  async function connect(first = false) {
    const client = new Client({ name: "unified-runtime-test", version: "1" });
    clients.push(client);
    const args = [...commandArgs, "serve", "--project", project];
    if (first) {
      args.push("--backend", backend, "--source", fileURLToPath(new URL("../../examples/seed", import.meta.url)));
      if (process.env.LAYERFS_TEST_IMAGE) args.push("--image", process.env.LAYERFS_TEST_IMAGE);
    }
    const started = Date.now();
    await client.connect(new StdioClientTransport({ command, args, env, stderr: "inherit" }));
    assert(Date.now() - started < 30_000, "Handshake must not wait for the image build");
    assert.equal((await client.listTools()).tools.length, 41);
    return client;
  }
  async function ready(client) {
    const until = Date.now() + 780_000;
    while (Date.now() < until) {
      const result = await client.callTool({ name: "layerfs_status", arguments: {} });
      assert(!result.isError, JSON.stringify(result));
      const status = result.structuredContent.result;
      assert.notEqual(status.runtimeState, "failed", JSON.stringify({ stage: status.stage, error: status.error }));
      if (status.runtimeState === "ready") return status;
      await delay(1000);
    }
    assert.fail("Runtime preparation timed out");
  }
  try {
    const client = await connect(true); // No setup command is ever invoked by this test.
    const another = await connect(); // Concurrent first launch uses saved profile and preparation lock.
    const status = await ready(client);
    assert.equal(status.backend, backend);
    assert.equal(status.executionEngine, backend === "apple" ? "podman" : "docker");
    assert.deepEqual(status.missing, []);
    await ready(another);
    await exerciseLayerFS(client, { source: "/source", project });
    const read = await another.callTool({ name: "layerfs_fs_read", arguments: { ref: "merged", path: "/command.txt" } });
    assert(!read.isError, JSON.stringify(read));
    assert.match(read.structuredContent.result.text, /from-command/);
    // The same project is also reachable over the host's HTTP transport.
    const token = randomUUID();
    httpProcess = spawn(process.execPath, [fileURLToPath(new URL("../../dist/cli.js", import.meta.url)), "serve", "--project", project, "--transport", "http", "--port", "0"], {
      env: { ...env, LAYERFS_MCP_TOKEN: token }, stdio: ["ignore", "ignore", "pipe"],
    });
    httpExited = new Promise(resolve => httpProcess.once("exit", resolve));
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("HTTP listener timed out")), 30_000);
      let log = "";
      httpProcess.once("error", error => { clearTimeout(timer); reject(error); });
      httpProcess.stderr.on("data", data => {
        log = (log + data.toString()).slice(-16_384);
        const match = /listening on (\d+)/.exec(log);
        if (match) { clearTimeout(timer); resolve(Number(match[1])); }
      });
    });
    const httpClient = new Client({ name: "managed-http-test", version: "1" });
    clients.push(httpClient);
    await httpClient.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    await ready(httpClient);
    const httpRead = await httpClient.callTool({ name: "layerfs_fs_read", arguments: { ref: "merged", path: "/command.txt" } });
    assert(!httpRead.isError, JSON.stringify(httpRead));
    assert.match(httpRead.structuredContent.result.text, /from-command/);
    await httpClient.close();
    httpProcess.kill("SIGTERM"); await httpExited;
    await client.close(); await another.close();
    const saved = JSON.parse(await readFile(join(directory, "projects", `${project}.json`), "utf8"));
    assert.equal(saved.backend, backend);
    run(command, [...commandArgs, "stop", "--project", project]);
    const restarted = await connect();
    await ready(restarted);
    const persisted = await restarted.callTool({ name: "layerfs_fs_read", arguments: { ref: "merged", path: "/command.txt" } });
    assert(!persisted.isError, JSON.stringify(persisted));
    assert.match(persisted.structuredContent.result.text, /from-command/);
  } finally {
    for (const client of clients) await client.close();
    if (httpProcess && httpProcess.exitCode === null) { httpProcess.kill("SIGTERM"); await httpExited; }
    const bin = backend === "apple" ? "container" : "docker";
    const inspected = run(bin, ["inspect", name], true);
    if (inspected) {
      const [record] = JSON.parse(inspected);
      if (backend === "apple") {
        assertAppleOwnership(record, { name, project });
        if (record.status?.state === "running") run(bin, ["stop", name]);
        run(bin, ["delete", name]);
        run(bin, ["volume", "delete", `${name}-state`]);
      } else {
        assertDockerOwnership(record, { name, project });
        const sandboxes = run(bin, ["ps", "-aq", "--filter", `name=^/${name}-sandbox-`]).trim();
        if (sandboxes) run(bin, ["rm", "-f", ...sandboxes.split(/\s+/)]);
        run(bin, ["rm", "-f", name]);
        run(bin, ["volume", "rm", `${name}-home`, `${name}-store`]);
      }
    }
    await rm(directory, { recursive: true, force: true });
  }
});
