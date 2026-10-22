#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { UPSTREAM_COMMIT } from "../../dist/backend.js";

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const cli = join(root, "dist", "cli.js");
const update = process.argv.includes("--update");
const unsupported = process.argv.slice(2).filter(argument => argument !== "--update");
if (unsupported.length) {
  console.error("usage: node test/golden/replay.mjs [--update]");
  process.exit(1);
}
if (!existsSync(cli)) {
  console.error("missing dist/cli.js; run npm run build first");
  process.exit(1);
}

const bins = { container: join(directory, "fake-container.mjs"), docker: join(directory, "fake-docker.mjs") };
const project = "golden";
// Pinned host-name formula: a change to name derivation must fail the replay, not silently follow it.
const name = `lfm-${project}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}`;
const source = await realpath(join(directory, "fixtures", "source"));
const archive = await realpath(join(directory, "fixtures", "sandbox.oci.tar"));
const appleImage = "docker.io/library/layerfs-mcp-apple:local";
const dockerImage = "example/runtime:local";
const sandboxImage = "example/sandbox:local";
const sandboxId = `sha256:${"a".repeat(64)}`;
const stateVolume = `${name}-state`;

const out = (stdout = "") => ({ stdout });
const json = value => out(JSON.stringify(value));
const failed = (stderr, code = 1) => ({ stderr, code });
const listed = json([{ id: name }]);
const inspected = vm => json([vm]);

const appleVm = (state = "running", mutate) => {
  const vm = {
    id: name,
    status: { state },
    configuration: {
      id: name,
      labels: {
        "io.layerfs-mcp.owner": "layerfs-mcp.apple.v1",
        "io.layerfs-mcp.project": project,
        "io.layerfs-mcp.upstream": UPSTREAM_COMMIT,
      },
      mounts: [{ destination: "/state", type: { volume: { name: stateVolume } } }],
      image: { reference: appleImage },
      initProcess: { environment: [] },
      resources: { cpus: 2, memoryInBytes: 2 * 1024 ** 3 },
    },
  };
  mutate?.(vm);
  return vm;
};

const dockerRecord = mutate => {
  const record = {
    Name: `/${name}`,
    Config: {
      Image: dockerImage,
      Labels: {
        "io.layerfs-mcp.owner": "layerfs-mcp.docker.v1",
        "io.layerfs-mcp.project": project,
        "io.layerfs-mcp.upstream": UPSTREAM_COMMIT,
      },
    },
    Mounts: [
      { Type: "volume", Name: `${name}-home`, Destination: "/layerfs-home" },
      { Type: "volume", Name: `${name}-store`, Destination: "/layerfs-store" },
      { Type: "bind", Name: "", Destination: "/var/run/docker.sock" },
    ],
    HostConfig: { Mounts: [] },
    State: { Running: true, Status: "running" },
  };
  mutate?.(record);
  return record;
};

const appleDiagnostics = json({ ok: true, storePlatformSupported: true, missing: [] });
const dockerDiagnostics = json({ ok: true, platform: "linux", missing: [], checks: {} });

const dockerVolumeAndRun = () => [
  out("\n"), out(), out("\n"), out(), out("Docker Desktop 4.35.0\n"), out(),
  out("abc123\n"), json([dockerRecord()]), out(),
];

const scenarios = [
  {
    backend: "apple",
    name: "apple-setup-create",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [out("[]"), out("[]"), out("[]"), out(), out(), out()],
  },
  {
    backend: "apple",
    name: "apple-setup-create-flags",
    args: ["apple", "setup", "--project", project, "--image", appleImage,
      "--source", source, "--sandbox-image", sandboxImage, "--sandbox-archive", archive, "--cpus", "4", "--memory", "8G"],
    script: [out("[]"), out("[]"), out("[]"), out(), out(), out()],
  },
  {
    backend: "apple",
    name: "apple-setup-reuse",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [listed, inspected(appleVm()), listed, inspected(appleVm()), out()],
  },
  {
    backend: "apple",
    name: "apple-setup-reuse-stopped",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [listed, inspected(appleVm("stopped")), listed, inspected(appleVm("stopped")), out(), out()],
  },
  {
    backend: "apple",
    name: "apple-setup-drift-owner",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [listed, inspected(appleVm("running", vm => { vm.configuration.labels["io.layerfs-mcp.owner"] = "layerfs-mcp.apple.v0"; }))],
  },
  {
    backend: "apple",
    name: "apple-setup-drift-project",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [listed, inspected(appleVm("running", vm => { vm.configuration.labels["io.layerfs-mcp.project"] = "someone-else"; }))],
  },
  {
    backend: "apple",
    name: "apple-setup-drift-upstream",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [listed, inspected(appleVm("running", vm => { vm.configuration.labels["io.layerfs-mcp.upstream"] = "0000000"; }))],
  },
  {
    backend: "apple",
    name: "apple-setup-volume-adopt",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [out("[]"), out("[]"), json([{ id: stateVolume }]),
      json([{ configuration: { labels: { "io.layerfs-mcp.owner": "layerfs-mcp.apple.v1", "io.layerfs-mcp.project": "someone-else" } } }])],
  },
  {
    backend: "apple",
    name: "apple-setup-volume-existing",
    args: ["apple", "setup", "--project", project, "--image", appleImage],
    script: [out("[]"), out("[]"), json([{ id: stateVolume }]),
      json([{ configuration: { labels: { "io.layerfs-mcp.owner": "layerfs-mcp.apple.v1", "io.layerfs-mcp.project": project } } }]), out(), out()],
  },
  {
    backend: "apple",
    name: "apple-status",
    args: ["apple", "status", "--project", project],
    script: [listed, inspected(appleVm()), appleDiagnostics],
  },
  {
    backend: "apple",
    name: "apple-status-not-configured",
    args: ["apple", "status", "--project", project],
    script: [out("[]")],
  },
  {
    backend: "apple",
    name: "apple-stop",
    args: ["apple", "stop", "--project", project],
    script: [listed, inspected(appleVm()), out()],
  },
  {
    backend: "apple",
    name: "apple-stop-unified",
    prepare: "apple",
    args: ["stop", "--project", project],
    script: [listed, inspected(appleVm()), out()],
  },
  {
    backend: "apple",
    name: "apple-setup-prepare",
    args: ["setup", "--project", project, "--backend", "apple", "--image", appleImage],
    script: [out(), out("[]"), listed,
      inspected(appleVm("running", vm => { vm.configuration.labels["io.layerfs-mcp.owner"] = "layerfs-mcp.apple.v0"; }))],
  },
  {
    backend: "apple",
    name: "apple-setup-prepare-build",
    args: ["setup", "--project", project, "--backend", "apple"],
    script: [out(), failed("Error: no such image\n"), failed("")],
  },
  {
    backend: "apple",
    name: "apple-serve",
    env: { LAYERFS_TRACE: "1", LAYERFS_TRACE_STEP: "3", LAYERFS_MCP_TOKEN: "golden-secret" },
    args: ["apple", "serve", "--project", project, "--read-only"],
    script: [listed, inspected(appleVm()), out(), out()],
  },
  {
    backend: "docker",
    name: "docker-setup-create",
    args: ["docker", "setup", "--project", project, "--image", dockerImage],
    script: [out("\n"), json([{ Id: sandboxId }]), ...dockerVolumeAndRun()],
  },
  {
    backend: "docker",
    name: "docker-setup-sandbox-image",
    args: ["docker", "setup", "--project", project, "--image", dockerImage, "--sandbox-image", sandboxImage],
    script: [out("\n"), json([{ Id: sandboxId }]), json([{ Id: sandboxId }]), ...dockerVolumeAndRun()],
  },
  {
    backend: "docker",
    name: "docker-setup-sandbox-pull",
    args: ["docker", "setup", "--project", project, "--image", dockerImage, "--sandbox-image", sandboxImage],
    script: [out("\n"), failed("Error: No such image: example/sandbox:local\n"), out(), json([{ Id: sandboxId }]), ...dockerVolumeAndRun()],
  },
  {
    backend: "docker",
    name: "docker-setup-drift-image",
    args: ["docker", "setup", "--project", project, "--image", dockerImage],
    script: [out("abc123\n"), json([dockerRecord(record => { record.Config.Image = "other/runtime:old"; })])],
  },
  {
    backend: "docker",
    name: "docker-setup-volume-adopt",
    args: ["docker", "setup", "--project", project, "--image", dockerImage],
    script: [out("\n"), json([{ Id: sandboxId }]), out("abc123\n"),
      json([{ Labels: { "io.layerfs-mcp.owner": "layerfs-mcp.docker.v1", "io.layerfs-mcp.project": "someone-else" } }])],
  },
  {
    backend: "docker",
    name: "docker-status",
    args: ["docker", "status", "--project", project],
    script: [out("abc123\n"), json([dockerRecord()]), dockerDiagnostics],
  },
  {
    backend: "docker",
    name: "docker-stop",
    args: ["docker", "stop", "--project", project],
    script: [out("abc123\n"), json([dockerRecord()]), out()],
  },
  {
    backend: "docker",
    name: "docker-stop-unified",
    prepare: "docker",
    args: ["stop", "--project", project],
    script: [out("abc123\n"), json([dockerRecord()]), out()],
  },
  {
    backend: "docker",
    name: "docker-setup-prepare",
    args: ["setup", "--project", project, "--backend", "docker", "--image", dockerImage],
    script: [out("linux\n"), json([{ Id: sandboxId }]), out("abc123\n"),
      json([dockerRecord(record => { record.Config.Image = "other/runtime:old"; })])],
  },
  {
    backend: "docker",
    name: "docker-setup-prepare-build",
    args: ["setup", "--project", project, "--backend", "docker"],
    script: [out("linux\n"), failed("Error: no such image\n"), failed("")],
  },
  {
    backend: "docker",
    name: "docker-serve",
    env: { LAYERFS_TRACE: "1", LAYERFS_TRACE_STEP: "3", LAYERFS_MCP_TOKEN: "golden-secret" },
    args: ["docker", "serve", "--project", project],
    script: [out("abc123\n"), json([dockerRecord()]), out(), out()],
  },
];

function execute(command, args, env) {
  return new Promise((accept, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60_000);
    child.once("error", reject);
    child.once("close", code => { clearTimeout(timer); accept({ exitCode: code, stdout, stderr }); });
  });
}

async function replay(scenario) {
  const work = await mkdtemp(join(tmpdir(), "layerfs-golden-"));
  try {
    const log = join(work, "calls.jsonl");
    const script = join(work, "script.json");
    await writeFile(script, JSON.stringify(scenario.script, null, 2));
    const env = { ...process.env, LAYERFS_MCP_CONFIG_DIR: join(work, "config"),
      LAYERFS_CONTAINER_BIN: bins.container, LAYERFS_DOCKER_BIN: bins.docker,
      LAYERFS_GOLDEN_LOG: log, LAYERFS_GOLDEN_SCRIPT: script, LAYERFS_GOLDEN_BIN: scenario.backend };
    for (const key of ["LAYERFS_MCP_PROJECT", "LAYERFS_MCP_BACKEND", "LAYERFS_MCP_TRANSPORT", "LAYERFS_SDK_PATH",
      "LAYERFS_MCP_TOKEN", "LAYERFS_TRACE", "LAYERFS_TRACE_STEP", "LAYERFS_TRACE_START", "LAYERFS_MCP_STORE_POLICY"]) delete env[key];
    Object.assign(env, scenario.env ?? {});
    if (scenario.prepare) {
      const seed = await execute(process.execPath, [join(directory, "seed-profile.mjs"), scenario.prepare, project], env);
      if (seed.exitCode !== 0) throw new Error(`profile seed failed: ${seed.stderr.trim()}`);
    }
    const result = await execute(process.execPath, ["dist/cli.js", ...scenario.args], env);
    const calls = existsSync(log)
      ? (await readFile(log, "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line))
      : [];
    const tokens = [[process.execPath, "<NODE>"], [work, "<WORK>"], [source, "<SOURCE>"], [archive, "<ARCHIVE>"], [root, "<ROOT>"]];
    const clean = value => tokens.reduce((text, [from, to]) => text.split(from).join(to), value);
    const profile = join(work, "config", "projects", `${project}.json`);
    return {
      argv: ["dist/cli.js", ...scenario.args].map(clean),
      exitCode: result.exitCode,
      stdout: clean(result.stdout),
      stderr: clean(result.stderr),
      calls: calls.map(call => ({ bin: call.bin, args: call.args.map(clean) })),
      profileJson: existsSync(profile) ? JSON.parse(clean(await readFile(profile, "utf8"))) : null,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function difference(actual, expected, path = "") {
  if (isDeepStrictEqual(actual, expected)) return null;
  if (Array.isArray(actual) && Array.isArray(expected)) {
    if (actual.length !== expected.length) return { path: `${path}.length`, actual: actual.length, expected: expected.length };
    for (let index = 0; index < actual.length; index++) {
      const found = difference(actual[index], expected[index], `${path}[${index}]`);
      if (found) return found;
    }
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object"
    && !Array.isArray(actual) && !Array.isArray(expected)) {
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      const found = difference(actual[key], expected[key], path ? `${path}.${key}` : key);
      if (found) return found;
    }
  }
  return { path, actual, expected };
}

const darwin = process.platform === "darwin";
let passed = 0;
let failedCount = 0;
const skipped = [];
for (const scenario of scenarios) {
  if (scenario.backend === "apple" && !darwin) {
    skipped.push(scenario.name);
    continue;
  }
  const actual = await replay(scenario);
  const baseline = join(directory, "baseline", `${scenario.name}.json`);
  if (update) {
    await writeFile(baseline, JSON.stringify(actual, null, 2) + "\n");
    console.log(`updated ${scenario.name}`);
    passed++;
    continue;
  }
  if (!existsSync(baseline)) {
    console.error(`FAIL ${scenario.name}: missing baseline; run: npm run golden -- --update`);
    failedCount++;
    continue;
  }
  const expected = JSON.parse(await readFile(baseline, "utf8"));
  const drift = difference(actual, expected);
  if (!drift) {
    passed++;
    continue;
  }
  failedCount++;
  console.error(`FAIL ${scenario.name} at ${drift.path || "<root>"}`);
  console.error(`  baseline: ${JSON.stringify(drift.expected)}`);
  console.error(`  actual:   ${JSON.stringify(drift.actual)}`);
}
if (skipped.length) console.log(`skipped ${skipped.length} apple scenarios (Apple host gate is macOS-only): ${skipped.join(", ")}`);
console.log(`golden: ${passed} ${update ? "written" : "passed"}, ${failedCount} failed, ${skipped.length} skipped`);
if (failedCount) {
  console.error("review the drift above; regenerate only for an intended behavior change: npm run golden -- --update");
  process.exitCode = 1;
}
