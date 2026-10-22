#!/usr/bin/env node
// Real-client verification drive for LayerFS-MCP. Usage and contract: ../SKILL.md
// Spawns an isolated `serve`, drives it through the official MCP SDK like a real
// client, writes evidence under <repo>/verify-evidence/, then tears down exactly
// what it created. Exit 0 = pass, 1 = fail. Evidence always survives.
import { randomUUID, createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const cli = join(repoRoot, "dist", "cli.js");
const seed = join(repoRoot, "examples", "seed");

// ---- args ----
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && i + 1 < args.length && !args[i + 1].startsWith("--") ? args[(i + 1)] : null;
};
const full = args.includes("--full");
const keep = args.includes("--keep");
const { version } = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
// prepareRuntime compares profile.image against this exact string to decide whether the
// upstream label is checked, so a short tag silently takes the custom-image path.
const defaultImage = backend => `docker.io/library/layerfs-mcp${backend === "apple" ? "-apple" : ""}:${version}`;
const normaliseImage = (value, backend) => {
  const short = `layerfs-mcp${backend === "apple" ? "-apple" : ""}:${version}`;
  return value === short ? defaultImage(backend) : value;
};
let backend = flag("backend");
const imageOverride = flag("image");
if (!backend) {
  const probe = spawnSync("docker", ["image", "inspect", defaultImage("docker"), "--format", "{{.Id}}"], { encoding: "utf8" });
  backend = probe.status === 0 ? "docker" : (process.platform === "darwin" ? "apple-container" : "docker");
}
const image = imageOverride ? normaliseImage(imageOverride, backend) : defaultImage(backend);
if (image !== defaultImage(backend)) {
  console.error(`[drive] NOTE: ${image} is not the default image (${defaultImage(backend)}); the stale-image rebuild branch is not exercised`);
}
if (!existsSync(cli)) {
  console.error(`[drive] missing ${cli} — run npm run build first (see SKILL.md Launch)`);
  process.exit(1);
}

// ---- run state ----
// Runtime resource names are deterministic per src/apple.ts appleOptions():
// lfm-<project[:35]>-<sha256(project)[:8]> — same formula for both backends.
const project = `verify-${randomUUID().slice(0, 8)}`;
const name = `lfm-${project.slice(0, 35)}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}`;
const isApple = backend.startsWith("apple");
const configDir = await mkdtemp(join(tmpdir(), "layerfs-verify-config-"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(repoRoot, "verify-evidence", `${stamp}-${project}`);
await mkdir(evidenceDir, { recursive: true });
const env = { ...process.env, LAYERFS_MCP_CONFIG_DIR: configDir };
delete env.LAYERFS_SDK_PATH;
delete env.LAYERFS_MCP_BACKEND;

const transcript = [];
const steps = [];
const statusStages = [];
const cleanupLog = [];
let client = null;
let failure = null;
const startedAt = new Date().toISOString();

class VerifyError extends Error {}
const note = (msg) => console.log(`[drive] ${msg}`);
const record = (tool, ok, ms, extra) => steps.push({ tool, ok, ms, ...extra });

async function call(tool, toolArgs = {}, { expectError = null } = {}) {
  const started = Date.now();
  const value = await client.callTool(
    { name: `layerfs_${tool}`, arguments: toolArgs },
    undefined,
    { timeout: 120_000 },
  );
  transcript.push({ ts: new Date().toISOString(), request: { tool, arguments: toolArgs }, response: value });
  const ms = Date.now() - started;
  if (expectError) {
    if (!value.isError || value.structuredContent?.error?.code !== expectError) {
      record(tool, false, ms, { expectedError: expectError });
      throw new VerifyError(`${tool}: expected isError with error.code ${expectError}, got ${JSON.stringify(value).slice(0, 800)}`);
    }
    record(tool, true, ms, { assertedError: expectError });
    return value.structuredContent.error;
  }
  if (value.isError) {
    record(tool, false, ms);
    throw new VerifyError(`${tool}: ${JSON.stringify(value).slice(0, 800)}`);
  }
  record(tool, true, ms);
  return value.structuredContent.result;
}

const runCli = (cliArgs) => {
  const r = spawnSync(process.execPath, [cli, ...cliArgs], { env, encoding: "utf8" });
  cleanupLog.push(`$ node dist/cli.js ${cliArgs.join(" ")} -> exit ${r.status}${r.stdout ? ` ${String(r.stdout).trim().slice(0, 200)}` : ""}`);
  return r;
};

async function cleanup() {
  if (keep) { cleanupLog.push("skipped (--keep)"); return; }
  try { if (client) await client.close(); } catch { /* already closed */ }
  runCli(["stop", "--project", project]);
  if (isApple) {
    const inspected = spawnSync("container", ["inspect", name], { encoding: "utf8" });
    if (inspected.status === 0) {
      const [vm] = JSON.parse(inspected.stdout);
      if (vm.status?.state === "running") spawnSync("container", ["stop", name], { encoding: "utf8" });
      spawnSync("container", ["delete", name], { encoding: "utf8" });
      spawnSync("container", ["volume", "delete", `${name}-state`], { encoding: "utf8" });
      cleanupLog.push(`container ${name} + volume ${name}-state removed`);
    } else {
      cleanupLog.push(`container ${name} already absent`);
    }
  } else {
    const sandboxes = spawnSync("docker", ["ps", "-aq", "--filter", `name=^/${name}-sandbox-`], { encoding: "utf8" });
    const ids = (sandboxes.stdout || "").trim();
    if (ids) spawnSync("docker", ["rm", "-f", ...ids.split(/\s+/)], { encoding: "utf8" });
    spawnSync("docker", ["rm", "-f", name], { encoding: "utf8" });
    spawnSync("docker", ["volume", "rm", `${name}-home`, `${name}-store`], { encoding: "utf8" });
    cleanupLog.push(`docker containers ${name}(+-sandbox-*) + volumes ${name}-home/${name}-store removed`);
  }
  await rm(configDir, { recursive: true, force: true });
  cleanupLog.push(`config dir ${configDir} removed`);
}

try {
  // 1. Cold connect: handshake must not wait for image work.
  client = new Client({ name: "verify-layerfs-mcp-drive", version: "1" });
  const serveArgs = ["serve", "--project", project, "--backend", backend];
  if (image) serveArgs.push("--image", image);
  serveArgs.push("--source", seed);
  const connectStarted = Date.now();
  await client.connect(new StdioClientTransport({
    command: process.execPath, args: [cli, ...serveArgs], env, stderr: "inherit",
  }));
  const handshakeMs = Date.now() - connectStarted;
  record("__handshake", true, handshakeMs, { backend, image: image || "(default/build)" });
  note(`handshake in ${handshakeMs}ms (must be < 30000)`);
  if (handshakeMs >= 30_000) throw new VerifyError(`handshake took ${handshakeMs}ms; must answer MCP before finishing preparation`);

  // 2. Tool list.
  const tools = (await client.listTools()).tools;
  record("__listTools", true, 0, { count: tools.length });
  if (tools.length !== 41) throw new VerifyError(`expected 41 tools, listed ${tools.length} — if intentional, update SKILL.md and features/`);
  note(`listed ${tools.length} tools`);

  // 3. Wait for ready.
  const until = Date.now() + 780_000;
  let status;
  while (Date.now() < until) {
    const result = await client.callTool({ name: "layerfs_status", arguments: {} });
    if (result.isError) throw new VerifyError(`layerfs_status errored: ${JSON.stringify(result).slice(0, 500)}`);
    status = result.structuredContent.result;
    if (!statusStages.includes(status.runtimeState)) { statusStages.push(status.runtimeState); note(`runtimeState=${status.runtimeState}`); }
    if (status.runtimeState === "failed") throw new VerifyError(`runtime failed at stage=${status.stage} error=${JSON.stringify(status.error)}`);
    if (status.runtimeState === "ready") break;
    await delay(1000);
  }
  if (status?.runtimeState !== "ready") throw new VerifyError("runtime preparation timed out (780s)");
  if (status.backend !== (isApple ? "apple" : "docker")) throw new VerifyError(`unexpected backend ${status.backend}`);
  if (status.missing?.length) throw new VerifyError(`doctor reports missing: ${status.missing.join(", ")}`);

  // 4. Core journey: files-and-branches (see features/files-and-branches.md).
  await call("project_init", { sourcePath: "/source" });
  await call("branch_fork", { name: "alpha" });
  await call("branch_fork", { name: "beta" });
  await call("fs_write", { branch: "alpha", path: "/a.txt", content: "alpha\n" });
  await call("fs_edit", { branch: "alpha", path: "/a.txt", oldText: "alpha", newText: "alpha-edited" });
  await call("fs_apply", { branch: "beta", changes: [
    { op: "mkdir", path: "/data" },
    { op: "write", path: "/data/b.txt", content: "beta\n" },
    { op: "write", path: "/data/raw", content: "AP8=", encoding: "base64" },
  ] });
  const readBack = await call("fs_read", { ref: "alpha", path: "/a.txt" });
  if (!/alpha-edited/.test(readBack.text)) throw new VerifyError(`read-back after edit mismatch: ${JSON.stringify(readBack)}`);
  const history = await call("branch_list_commits", { branch: "alpha" });
  if (!(history.items?.length > 1)) throw new VerifyError(`expected >1 commits on alpha, got ${history.items?.length}`);
  await call("branch_diff_branches", { from: "alpha", to: "beta", hunks: false });
  await call("branch_merge", { a: "alpha", b: "beta", name: "merged" });
  const published = await call("branch_publish", { branch: "merged" });
  if (typeof published.publishedLayer?.id !== "string") throw new VerifyError(`publish returned no layer id: ${JSON.stringify(published)}`);
  const onMain = await call("fs_read", { ref: "main", path: "/data/b.txt" });
  if (!/beta/.test(onMain.text)) throw new VerifyError(`published change not visible on main: ${JSON.stringify(onMain)}`);
  await call("branch_fork", { name: "conflict-a" });
  await call("branch_fork", { name: "conflict-b" });
  await call("fs_write", { branch: "conflict-a", path: "/README.md", content: "a\n" });
  await call("fs_write", { branch: "conflict-b", path: "/README.md", content: "b\n" });
  const conflict = await call("branch_merge", { a: "conflict-a", b: "conflict-b", name: "conflicted" }, { expectError: "Conflict" });
  note(`conflict path asserted: ${conflict.code}`);

  // 5. Operator spot checks (see features/operator-diagnostics.md).
  await call("operator_store_stats");
  await call("operator_store_overwritten", { layer: published.publishedLayer.id });
  const progress = await call("operator_project_progress");
  if (progress !== null) throw new VerifyError(`project_progress should be null after init, got ${JSON.stringify(progress)}`);
  await call("operator_sandbox_list");

  // 6. Optional workspace block (see features/workspace-exec.md).
  if (full) {
    const ws = await call("workspace_mount", { branch: "merged" });
    const handle = { sandbox: ws.sandbox, path: ws.path };
    try {
      const exec = await call("workspace_exec", { ws, command: "printf 'from-command\n' > command.txt && cat command.txt" });
      if (exec.exitCode !== 0 || !/from-command/.test(exec.stdout)) throw new VerifyError(`workspace_exec mismatch: ${JSON.stringify(exec)}`);
      const identity = await call("workspace_exec", { ws, command: "id -u; grep '^CapEff:' /proc/self/status; if unshare -Ur true >/dev/null 2>&1; then exit 90; fi" });
      if (identity.exitCode !== 0 || !/^501\n/.test(identity.stdout) || !/CapEff:\s+0+\n/.test(identity.stdout)) {
        throw new VerifyError(`sandbox identity mismatch (want uid 501, CapEff 0, no userns): ${JSON.stringify(identity)}`);
      }
      await call("workspace_status", { ws: handle });
      await call("operator_workspace_overlay", { ws: handle });
      await call("operator_workspace_changes", { ws: handle });
      const process = await call("operator_process_start", { ws: handle, command: "sleep 120" });
      if (typeof process.process !== "string") throw new VerifyError(`process_start returned no id: ${JSON.stringify(process)}`);
      await call("operator_process_list");
      await call("operator_process_cancel", { process: process.process });
      await call("workspace_commit", { ws: handle, message: "checkpoint command" });
      const committed = await call("fs_read", { ref: "merged", path: "/command.txt" });
      if (!/from-command/.test(committed.text)) throw new VerifyError(`checkpoint not visible on merged: ${JSON.stringify(committed)}`);
    } finally {
      await call("workspace_unmount", { ws: handle, discard: true });
    }
  }
  note(`journey complete: ${steps.filter((s) => s.ok).length} steps ok`);
} catch (error) {
  failure = error;
} finally {
  await cleanup();
  const evidence = {
    app: "layerfs-mcp",
    result: failure ? "fail" : "pass",
    error: failure ? { message: failure.message } : null,
    startedAt, finishedAt: new Date().toISOString(),
    backend, image: image || "(default/build)", fullWorkspace: full,
    project, containerName: name,
    statusStages, toolsListed: steps.find((s) => s.tool === "__listTools")?.count ?? null,
    handshakeMs: steps.find((s) => s.tool === "__handshake")?.ms ?? null,
    steps, cleanupLog,
    note: "Evidence survives cleanup. verify-evidence/ is gitignored.",
  };
  await writeFile(join(evidenceDir, "evidence.json"), JSON.stringify(evidence, null, 2));
  await writeFile(join(evidenceDir, "transcript.jsonl"), transcript.map((l) => JSON.stringify(l)).join("\n") + "\n");
  if (failure) {
    console.error(`\n[drive] FAIL: ${failure.message}`);
    console.error(`[drive] evidence: ${evidenceDir}`);
    process.exit(1);
  }
  console.log(`\n[drive] PASS — evidence: ${evidenceDir}`);
  process.exit(0);
}
