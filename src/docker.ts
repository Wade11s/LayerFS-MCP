import { spawn } from "node:child_process";
import { parseArgs } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { appleOptions } from "./apple.js";
import { UPSTREAM_COMMIT } from "./backend.js";
import { capture, defaultImage } from "./runtime.js";
import { isolatedEntry } from "./process.js";

const OWNER = "layerfs-mcp.docker.v1";
const bin = process.env.LAYERFS_DOCKER_BIN || "docker";
type Options = ReturnType<typeof appleOptions>;
const command = (args: string[]) => capture(bin, args);

export function assertDockerOwnership(record: any, options: Pick<Options, "name" | "project">): void {
  const labels = record.Config?.Labels;
  if (record.Name !== `/${options.name}` || labels?.["io.layerfs-mcp.owner"] !== OWNER
    || labels?.["io.layerfs-mcp.project"] !== options.project || labels?.["io.layerfs-mcp.upstream"] !== UPSTREAM_COMMIT) throw new Error("Refusing to adopt an unrelated Docker runtime");
  for (const [destination, suffix] of [["/layerfs-store", "store"], ["/layerfs-home", "home"]]) {
    if (!record.Mounts?.some((mount: any) => mount.Destination === destination && mount.Type === "volume" && mount.Name === `${options.name}-${suffix}`)) throw new Error("Docker runtime has the wrong project volume");
  }
  if (record.Mounts.some((mount: any) => !["/layerfs-store", "/layerfs-home", "/var/run/docker.sock", "/source"].includes(mount.Destination))) throw new Error("Docker runtime has unexpected host mounts");
}

async function find(options: Options): Promise<any | undefined> {
  const ids = (await command(["ps", "-aq", "--filter", `name=^/${options.name}$`])).trim();
  if (!ids) return;
  const [record] = JSON.parse(await command(["inspect", options.name]));
  assertDockerOwnership(record, options);
  return record;
}

async function start(options: Options): Promise<any> {
  const record = await find(options);
  if (!record) throw new Error("Docker runtime is not configured");
  if (!record.State.Running) await command(["start", options.name]);
  await command(["exec", options.name, "node", "-e", "const fs=require('node:fs'); for(const p of ['/layerfs-home','/layerfs-store/global']) { fs.mkdirSync(p,{recursive:true,mode:0o700}); fs.chmodSync(p,0o700); }"]);
  return record;
}

async function setup(options: Options): Promise<void> {
  if (options.source) {
    options.source = await realpath(options.source);
    if (!(await stat(options.source)).isDirectory() || options.source.includes(",")) throw new Error("--source must be a directory without commas");
  }
  const existing = await find(options);
  if (existing) {
    // Docker Desktop rewrites bind paths, including HostConfig, under /host_mnt.
    const source = existing.HostConfig.Mounts?.find((mount: any) => mount.Target === "/source")?.Source;
    const desktopPath = options.source && source === `/host_mnt${options.source}`
      && /docker desktop/i.test(await command(["info", "--format", "{{.OperatingSystem}}"]));
    if (existing.Config.Image !== options.image || (source !== options.source && !desktopPath)) throw new Error(`Existing Docker runtime has different image/source settings: ${JSON.stringify({ existing: { image: existing.Config.Image, source }, requested: { image: options.image, source: options.source } })}; use matching settings or a new project`);
    await start(options); return;
  }
  const image = options.sandboxImage || options.image;
  if (options.sandboxImage) {
    try { await command(["image", "inspect", image]); }
    catch { await command(["pull", image]); }
  }
  const [sandbox] = JSON.parse(await command(["image", "inspect", image]));
  if (!/^sha256:[a-f0-9]{64}$/.test(sandbox.Id)) throw new Error("Invalid immutable Sandbox image ID");
  const labels = ["--label", `io.layerfs-mcp.owner=${OWNER}`, "--label", `io.layerfs-mcp.project=${options.project}`, "--label", `io.layerfs-mcp.upstream=${UPSTREAM_COMMIT}`];
  for (const suffix of ["home", "store"]) {
    const volume = `${options.name}-${suffix}`;
    const listed = (await command(["volume", "ls", "-q", "--filter", `name=^${volume}$`])).trim();
    if (listed) {
      const [record] = JSON.parse(await command(["volume", "inspect", volume]));
      if (record.Labels?.["io.layerfs-mcp.owner"] !== OWNER || record.Labels?.["io.layerfs-mcp.project"] !== options.project) throw new Error("Refusing to adopt an unrelated Docker volume");
    } else await command(["volume", "create", ...labels, volume]);
  }
  const os = (await command(["info", "--format", "{{.OperatingSystem}}"])).trim();
  const desktop = /docker desktop/i.test(os) || process.platform !== "linux";
  const args = ["run", "-d", "--init", "--name", options.name, ...labels,
    "--mount", `type=volume,source=${options.name}-home,target=/layerfs-home`,
    "--mount", `type=volume,source=${options.name}-store,target=/layerfs-store`,
    "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
    "--env", `LAYERFS_MCP_PROJECT=${options.project}`, "--env", `LAYERFS_VOLUME=${options.name}-store`,
    "--env", `LAYERFS_IMAGE=${sandbox.Id}`, "--env", `LAYERFS_CONTAINER_PREFIX=${options.name}-sandbox-`,
    "--env", "LAYERFS_MCP_HOST_RUNTIME=docker", "--env", `LAYERFS_DAEMON_HOST=${desktop ? "host.docker.internal" : "127.0.0.1"}`];
  if (desktop) args.push("--add-host", "host.docker.internal:host-gateway");
  else args.push("--network", "host");
  if (options.source) args.push("--mount", `type=bind,source=${options.source},target=/source,readonly`);
  args.push("--entrypoint", "node", options.image, "-e", "setInterval(() => {}, 2147483647)");
  await command(args);
  await start(options);
}

export async function dockerCli(args: string[]): Promise<void> {
  const { positionals, values } = parseArgs({ args, allowPositionals: true, options: {
    project: { type: "string" }, name: { type: "string" }, image: { type: "string" }, source: { type: "string" }, "sandbox-image": { type: "string" },
  } });
  const action = positionals[0];
  if (positionals.length !== 1 || !["setup", "serve", "status", "stop"].includes(action!)) throw new Error("Use the unified setup, serve, status or stop command with --backend docker");
  const options = appleOptions({ ...values, image: values.image || defaultImage("docker") });
  if (action === "setup") { await setup(options); console.error(`Docker runtime ready: ${options.name}`); return; }
  if (action === "status") {
    const record = await find(options);
    const diagnostics = record?.State.Running ? JSON.parse(await command(["exec", options.name, "node", "/app/dist/cli.js", "doctor"])) : undefined;
    console.log(JSON.stringify({ backend: "docker", project: options.project, name: options.name, state: record?.State?.Status || "not-configured", diagnostics }, null, 2));
    return;
  }
  if (action === "stop") {
    const record = await find(options);
    if (record?.State.Running) await command(["stop", options.name]);
    console.error(`Docker runtime stopped; project volumes retained: ${options.name}`);
    return;
  }
  await start(options);
  const envFlags: string[] = [];
  for (const key of ["LAYERFS_MCP_STORE_POLICY", "LAYERFS_TRACE", "LAYERFS_TRACE_STEP", "LAYERFS_TRACE_START"]) {
    if (process.env[key]) envFlags.push("--env", `${key}=${process.env[key]}`);
  }
  const child = spawn(bin, ["exec", "-i", ...envFlags, options.name, "node", "-e", isolatedEntry("/app/dist/cli.js", ["--transport", "stdio"])], { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => child.kill(signal));
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Docker connection closed (${signal || code})`)));
  });
}
