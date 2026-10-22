import { execFile, spawn } from "node:child_process";
import { promisify, parseArgs } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { UPSTREAM_COMMIT } from "./backend.js";
import { APPLE_FLAG } from "./driver-flags.js";
import type { RuntimeDriver } from "./driver.js";
import { run } from "./host-exec.js";
import { assertOwned, decideAdopt, findOwned, LABEL, type OwnedRuntime, type OwnershipPolicy, type VolumeLabels } from "./ownership.js";
import { isolatedEntry } from "./process.js";
import { parseSelection, type RuntimeSelection } from "./selection.js";

const exec = promisify(execFile);
const OWNER = "layerfs-mcp.apple.v1";
const LEGACY_APPLE_IMAGE = "docker.io/library/layerfs-mcp-apple:local";
const containerBin = () => process.env.LAYERFS_CONTAINER_BIN || "container";
const bin = containerBin();

export const appleDriver: RuntimeDriver = {
  backend: "apple",
  engine: () => ({
    bin: containerBin(),
    ensure: async signal => { await run(containerBin(), ["system", "start"], signal); },
    imageBuildArgs: image => ["build", "--target", "apple-runtime", "-t", image, "--cpus", "2", "--memory", "2G"],
  }),
};

export function appleOptions(input: Record<string, unknown>): RuntimeSelection {
  return parseSelection(input, LEGACY_APPLE_IMAGE);
}

function applePolicy(options: Pick<RuntimeSelection, "name" | "project">): OwnershipPolicy {
  return {
    expectedName: options.name,
    expectedProject: options.project,
    owner: OWNER,
    upstream: UPSTREAM_COMMIT,
    requiredVolumes: [{ destination: "/state", name: `${options.name}-state` }],
    allowedDestinations: ["/state", "/source", "/input/sandbox.oci.tar"],
    messages: {
      notOwned: "Refusing to use a VM not owned by this LayerFS-MCP project",
      wrongVolume: "VM has the wrong state volume",
      unexpectedMount: "VM has unexpected host mounts",
    },
  };
}

function readAppleRuntime(vm: any): OwnedRuntime {
  const cfg = vm?.configuration;
  const mounts: any[] = cfg?.mounts ?? [];
  return {
    name: vm?.id,
    labels: { owner: cfg?.labels?.[LABEL.owner], project: cfg?.labels?.[LABEL.project], upstream: cfg?.labels?.[LABEL.upstream] },
    destinations: mounts.map(mount => mount.destination),
    volumes: mounts.filter(mount => mount.type?.volume?.name).map(mount => ({ destination: mount.destination, name: mount.type.volume.name })),
  };
}

export function assertAppleOwnership(vm: unknown, options: { name: string; project: string }): void {
  assertOwned(readAppleRuntime(vm), applePolicy(options));
}

async function command(args: string[]): Promise<string> {
  const result = await exec(bin, args, { maxBuffer: 8 * 1024 * 1024 });
  return result.stdout;
}

async function findVM(options: RuntimeSelection): Promise<any | undefined> {
  return findOwned({
    listed: async () => {
      const all = JSON.parse(await command(["list", "--all", "--format", "json"]));
      return all.find((vm: any) => vm.id === options.name || vm.configuration?.id === options.name) !== undefined;
    },
    inspect: async () => {
      const [vm] = JSON.parse(await command(["inspect", options.name]));
      return vm;
    },
    read: readAppleRuntime,
    policy: applePolicy(options),
  });
}

async function ready(options: RuntimeSelection): Promise<void> {
  let last = "";
  const until = Date.now() + 300_000;
  while (Date.now() < until) {
    try { await command(["exec", options.name, "node", "/opt/layerfs/apple/run.mjs", "ready"]); return; }
    catch (error) { last = error instanceof Error ? error.message : String(error); }
    const vm = await findVM(options);
    if (vm?.status?.state !== "running") throw new Error(`Apple VM stopped during initialization. Inspect: container logs ${options.name}`);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Readiness observation only; no SDK call is replayed.
  }
  throw new Error(`Apple VM initialization timed out. Inspect container logs ${options.name}. ${last}`);
}

async function startExisting(options: RuntimeSelection): Promise<any> {
  const vm = await findVM(options);
  if (!vm) throw new Error("Apple VM is not configured. Run: layerfs-mcp apple setup");
  if (vm.status?.state !== "running") await command(["start", options.name]);
  await ready(options);
  return vm;
}

function drifted(existing: any, options: RuntimeSelection): boolean {
  const cfg = existing.configuration;
  const image = options.image.includes("/") ? options.image : `docker.io/library/${options.image}`;
  const source = cfg.mounts.find((mount: any) => mount.destination === "/source")?.source;
  const archive = cfg.mounts.find((mount: any) => mount.destination === "/input/sandbox.oci.tar")?.source;
  const sandboxImage = cfg.initProcess.environment.find((value: string) => value.startsWith("LAYERFS_APPLE_SANDBOX_IMAGE="))?.split("=").slice(1).join("=");
  const memory = /^(\d+)([KMGTP]?)$/i.exec(options.memory)!;
  const bytes = Number(memory[1]) * 1024 ** (memory[2] ? "KMGTP".indexOf(memory[2].toUpperCase()) + 1 : 0);
  return cfg.image.reference !== image || source !== options.source || archive !== options.archive
    || sandboxImage !== options.sandboxImage || cfg.resources.cpus !== Number(options.cpus) || cfg.resources.memoryInBytes !== bytes;
}

async function stateLabels(volume: string): Promise<VolumeLabels> {
  const [record] = JSON.parse(await command(["volume", "inspect", volume]));
  const labels = record.configuration?.labels;
  return { owner: labels?.[LABEL.owner], project: labels?.[LABEL.project] };
}

async function setup(options: RuntimeSelection): Promise<void> {
  if (options.source) {
    options.source = await realpath(options.source);
    if (!(await stat(options.source)).isDirectory()) throw new Error("--source must be a directory");
  }
  if (options.archive) {
    options.archive = await realpath(options.archive);
    if (!(await stat(options.archive)).isFile()) throw new Error("--sandbox-archive must be a file");
    if (!options.sandboxImage) throw new Error("--sandbox-archive requires --sandbox-image with the reference inside the archive");
  }
  const existing = await findVM(options);
  if (existing) {
    if (drifted(existing, options)) throw new Error(`Existing Apple VM has different creation settings (image=${existing.configuration.image.reference}). Match its settings or use a new project; setup never silently replaces a Store or ignores creation options.`);
    await startExisting(options); console.log(`Apple runtime ready: ${options.name}`); return;
  }
  await command(["image", "inspect", options.image]); // No implicit download of an unknown runtime image.
  const volume = `${options.name}-state`;
  const volumes = JSON.parse(await command(["volume", "list", "--format", "json"]));
  const found = volumes.find((item: any) => item.id === volume || item.configuration?.name === volume);
  const decision = decideAdopt(found ? await stateLabels(volume) : undefined,
    { owner: OWNER, project: options.project }, "Refusing to adopt an unrelated state volume");
  if (decision.kind === "refuse") throw new Error(decision.message);
  if (decision.kind === "create") {
    // Apple state volumes carry no upstream label; adoption above never checks one.
    await command(["volume", "create", "-s", "32G", "--label", `${LABEL.owner}=${OWNER}`, "--label", `${LABEL.project}=${options.project}`, volume]);
  }
  const args = ["run", "--detach", "--name", options.name, "--cpus", options.cpus, "--memory", options.memory,
    "--cap-add", "ALL", "--masked-path", "NONE", "--read-only-path", "NONE",
    "--label", `${LABEL.owner}=${OWNER}`, "--label", `${LABEL.project}=${options.project}`,
    "--label", `${LABEL.upstream}=${UPSTREAM_COMMIT}`,
    "--env", `LAYERFS_MCP_PROJECT=${options.project}`, "--volume", `${volume}:/state`];
  if (options.source) args.push("--volume", `${options.source}:/source:ro`);
  if (options.archive) args.push("--volume", `${options.archive}:/input/sandbox.oci.tar:ro`, "--env", "LAYERFS_APPLE_SANDBOX_ARCHIVE=/input/sandbox.oci.tar");
  if (options.sandboxImage) args.push("--env", `LAYERFS_APPLE_SANDBOX_IMAGE=${options.sandboxImage}`);
  args.push(options.image);
  console.error(`Preparing one Apple VM for project ${options.project}: ${options.name}`);
  await command(args);
  await ready(options);
  console.log(`Apple runtime ready: ${options.name}. Initialize explicitly with: layerfs-mcp apple init --project ${options.project}`);
}

async function attached(args: string[]): Promise<void> {
  const child = spawn(bin, args, { stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM"] as const;
  const handlers = signals.map(signal => () => child.kill(signal));
  signals.forEach((signal, index) => process.once(signal, handlers[index]!));
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Apple runtime connection ended (${signal || code})`)));
    });
  } finally { signals.forEach((signal, index) => process.off(signal, handlers[index]!)); }
}

export async function appleCli(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: "boolean", short: "h" }, project: { type: "string" }, name: { type: "string" }, image: { type: "string" },
    source: { type: "string" },
    [APPLE_FLAG.cpus.slice(2)]: { type: "string" },
    [APPLE_FLAG.memory.slice(2)]: { type: "string" },
    [APPLE_FLAG.archive.slice(2)]: { type: "string" },
    "sandbox-image": { type: "string" },
    "read-only": { type: "boolean" }, "no-operator": { type: "boolean" }, "disable-exec": { type: "boolean" },
  } });
  if (values.help) {
    console.log(`LayerFS-MCP Apple Container runtime
Usage: layerfs-mcp apple setup|init|serve|status|stop [options]
  --project NAME          project and VM selection (default: default)
  --name NAME             override the deterministic VM name
  --image REF             prepared Apple runtime image
  --source PATH           setup: mount this import source read-only
  --cpus N --memory 2G    setup: VM resource limits
  --sandbox-image REF     setup: OCI image used by Sandboxes
  --sandbox-archive PATH  setup: optional offline OCI image archive
  --read-only --no-operator --disable-exec   serve: tool restrictions
Build first: container build --target apple-runtime -t layerfs-mcp-apple:local .
serve uses stdio. stop preserves the project's ext4 state volume.`);
    return;
  }
  if (process.platform !== "darwin") throw new Error("Apple Container host commands require macOS");
  const action = positionals[0] || "serve";
  if (positionals.length > 1 || !["setup", "init", "serve", "status", "stop"].includes(action)) throw new Error("Unknown apple subcommand; use --help");
  const options = appleOptions(values);
  if (action === "setup") { await setup(options); return; }
  if (action === "status") {
    const vm = await findVM(options);
    const diagnostics = vm?.status?.state === "running" ? JSON.parse(await command(["exec", options.name, "node", "/opt/layerfs/apple/run.mjs", "doctor"])) : undefined;
    console.log(JSON.stringify({ backend: "apple", runtime: "apple-container", project: options.project, name: options.name, state: vm?.status?.state || "not-configured", diagnostics }, null, 2));
    return;
  }
  if (action === "stop") {
    const vm = await findVM(options);
    if (vm?.status?.state === "running") await command(["stop", options.name]);
    console.log(`Apple runtime stopped; state volume retained: ${options.name}-state`);
    return;
  }
  const vm = await startExisting(options);
  if (action === "init") {
    const source = vm.configuration.mounts.some((mount: any) => mount.destination === "/source") ? "/source" : "/example-seed";
    await attached(["exec", options.name, "node", "-e", isolatedEntry("/opt/layerfs/apple/run.mjs", ["init", source])]);
  } else {
    const flags = ["--transport", "stdio"];
    for (const flag of ["read-only", "no-operator", "disable-exec"] as const) if (values[flag]) flags.push(`--${flag}`);
    const envFlags: string[] = [];
    for (const key of ["LAYERFS_MCP_STORE_POLICY", "LAYERFS_TRACE", "LAYERFS_TRACE_STEP", "LAYERFS_TRACE_START"]) {
      if (process.env[key]) envFlags.push("--env", `${key}=${process.env[key]}`);
    }
    await attached(["exec", "--interactive", ...envFlags, options.name, "node", "-e", isolatedEntry("/opt/layerfs/apple/run.mjs", flags)]);
  }
}
