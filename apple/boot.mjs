import { mkdir, chmod, writeFile, rename, readFile, statfs, unlink } from "node:fs/promises";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import http from "node:http";

const exec = promisify(execFile);
const socket = "/run/layerfs-engine.sock";
const state = "/state/runtime.json";
const project = process.env.LAYERFS_MCP_PROJECT || "default";
if (!/^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/.test(project)) throw new Error("Invalid project name");
if ((await statfs("/state")).type !== 0xef53) throw new Error("Apple runtime needs an ext4 named volume at /state");
for (const path of ["/state/home", "/state/engine", "/run/layerfs-engine"]) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}
await unlink(state).catch(e => { if (e.code !== "ENOENT") throw e; });
try { await exec("test", ["-c", "/dev/fuse"]); }
catch { await exec("mknod", ["/dev/fuse", "c", "10", "229"]); }

const engine = spawn("podman", ["system", "service", "--time", "0", `unix://${socket}`], { stdio: ["ignore", "ignore", "inherit"] });
const ended = new Promise(resolve => { engine.once("exit", (code, signal) => resolve({ code, signal })); engine.once("error", error => resolve({ error })); });
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => engine.kill(signal));
function ping() {
  return new Promise((resolve, reject) => {
    const req = http.get({ socketPath: socket, path: "/_ping", timeout: 1000 }, res => { res.resume(); res.once("end", () => res.statusCode === 200 ? resolve() : reject(new Error(`Engine HTTP ${res.statusCode}`))); });
    req.once("error", reject); req.once("timeout", () => req.destroy(new Error("Engine readiness timeout")));
  });
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (engine.exitCode !== null) throw new Error("OCI engine exited during startup");
    try { await ping(); ready = true; break; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  if (!ready) throw new Error("OCI engine did not become ready");
  const image = process.env.LAYERFS_APPLE_SANDBOX_IMAGE || "docker.io/library/node:22-bookworm@sha256:63538dfe497cc29dfafdda25ada09b46db68a3f4cc205abf1f5d6bf0913f3384";
  let present = false;
  try { await exec("podman", ["image", "exists", image]); present = true; } catch (e) { if (e.code !== 1) throw e; }
  if (!present) {
    console.error(`Preparing Sandbox image ${image}`);
    if (process.env.LAYERFS_APPLE_SANDBOX_ARCHIVE) await exec("podman", ["load", "--input", process.env.LAYERFS_APPLE_SANDBOX_ARCHIVE], { maxBuffer: 4 * 1024 * 1024 });
    else await exec("podman", ["pull", image], { maxBuffer: 4 * 1024 * 1024 });
  }
  const { stdout: rawId } = await exec("podman", ["image", "inspect", image, "--format", "{{.Id}}"]);
  const id = rawId.trim().replace(/^sha256:/, "");
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("OCI engine returned an invalid immutable image id");
  let volumeExists = false;
  try { await exec("podman", ["volume", "exists", "layerfs-store"]); volumeExists = true; } catch (e) { if (e.code !== 1) throw e; }
  if (!volumeExists) await exec("podman", ["volume", "create", "layerfs-store"]);
  const { stdout: mount } = await exec("podman", ["volume", "inspect", "layerfs-store", "--format", "{{.Mountpoint}}"]);
  const directory = `${mount.trim()}/global`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const bootId = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
  const record = { bootId, enginePid: engine.pid, env: {
    LAYERFS_MCP_PROJECT: project,
    LAYERFS_HOME: "/state/home",
    LAYERFS_STORE_PATH: `${directory}/store.sqlite`,
    LAYERFS_DOCKER: socket,
    LAYERFS_IMAGE: `sha256:${id}`,
    LAYERFS_VOLUME: "layerfs-store",
    LAYERFS_DAEMON_HOST: "127.0.0.1",
    LAYERFS_CONTAINER_PREFIX: "layerfs-apple-",
    LAYERFS_ENGINE: "podman",
    LAYERFS_MCP_HOST_RUNTIME: "apple-container",
  } };
  await writeFile(`${state}.new`, JSON.stringify(record), { mode: 0o600 });
  await rename(`${state}.new`, state);
  console.error(`Apple Container runtime ready: project=${project}, Linux kernel shared by Store and Sandboxes`);
  const result = await ended;
  if (result.error) throw result.error;
  process.exitCode = result.code || 0;
} catch (error) {
  console.error(error);
  engine.kill("SIGTERM");
  await ended;
  process.exitCode = 1;
} finally { await unlink(state).catch(() => {}); }
