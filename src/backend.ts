import { access, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { tools } from "./contract.js";
import type { Config } from "./config.js";

export interface Backend {
  invoke(method: string, args: unknown[], input?: Record<string, unknown>): Promise<unknown>;
  diagnostics(): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

type API = Record<string, any>;
export const UPSTREAM_COMMIT = "5fb68ddc1acc3163e3ac3486133bde014c5fbed3";

export async function sdkDirectory(input: string): Promise<string> {
  for (const path of [input, join(input, "sdk/js")]) {
    try {
      const pkg = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
      if (pkg.name === "@layerfs/sdk") return path;
    } catch { /* Try the other supported checkout layout. */ }
  }
  throw Object.assign(new Error("LAYERFS_SDK_PATH must point to a LayerFS checkout or its sdk/js directory"), { code: "ConfigurationError" });
}

function methodHolder(client: API, operator: API, method: string): { holder: any; fn: any } {
  const parts = method.split(".");
  if (parts[0] === "operator") parts.shift();
  const name = parts.pop()!;
  let holder: any = method.startsWith("operator.") ? operator : client;
  for (const part of parts) holder = holder?.[part];
  return { holder, fn: holder?.[name] };
}

export function assertContract(client: API, operator: API): void {
  for (const definition of tools) {
    const { fn } = methodHolder(client, operator, definition.method);
    if (typeof fn !== "function") throw Object.assign(new Error(`Incompatible LayerFS SDK: missing ${definition.method}. Use upstream ${UPSTREAM_COMMIT}.`), { code: "IncompatibleSDK" });
  }
}

export class LayerFSBackend implements Backend {
  private loading?: Promise<{ client: API; operator: API }>;
  private loaded = false;
  private closing = false;
  constructor(readonly config: Config) {}

  private load(): Promise<{ client: API; operator: API }> {
    if (this.closing) throw Object.assign(new Error("Server is shutting down"), { code: "ServerClosing" });
    return this.loading ??= this.initialize().catch(error => { this.loading = undefined; throw error; });
  }

  private async initialize(): Promise<{ client: API; operator: API }> {
    if (!this.config.sdkPath) throw Object.assign(new Error("Set LAYERFS_SDK_PATH to the pinned LayerFS checkout (see README)"), { code: "ConfigurationError" });
    const directory = await sdkDirectory(this.config.sdkPath);
    const [sdk, ops] = await Promise.all([
      import(pathToFileURL(join(directory, "src/index.js")).href),
      import(pathToFileURL(join(directory, "operator/index.js")).href),
    ]);
    const client = new sdk.LayerFS(this.config.project, { storePath: this.config.storePath, storePolicy: this.config.storePolicy });
    const operator = new ops.LayerFSOperator(client);
    assertContract(client, operator);
    this.loaded = true;
    return { client, operator };
  }

  async invoke(method: string, args: unknown[]): Promise<unknown> {
    if (!tools.some(tool => tool.method === method)) throw Object.assign(new Error("Unknown LayerFS method"), { code: "UnknownMethod" });
    const { client, operator } = await this.load();
    const { holder, fn } = methodHolder(client, operator, method);
    return fn.apply(holder, args); // One invocation; never retry a mutation or an uncertain call.
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    const checks: Record<string, unknown> = {};
    if (this.config.sdkPath) {
      try {
        const directory = await sdkDirectory(this.config.sdkPath);
        checks.sdk = directory;
        const addon = process.env.LAYERFS_NATIVE || join(directory, "native/layerfs.node");
        try { await access(addon); checks.nativeAddon = { path: addon, exists: true }; }
        catch { checks.nativeAddon = { path: addon, exists: false }; }
      } catch (error) { checks.sdkError = error instanceof Error ? error.message : String(error); }
    }
    if (this.config.storePath) {
      try { checks.storeExists = (await stat(this.config.storePath)).isFile(); }
      catch { checks.storeExists = false; }
    }
    const envValue = (key: string) => process.env[`LAYERFS_${key}`] || process.env[`DSH_LAYERFS_${key}`];
    const missing = [
      ...(!this.config.sdkPath ? ["LAYERFS_SDK_PATH"] : []),
      ...(!this.config.storePath ? ["LAYERFS_STORE_PATH"] : []),
      ...["HOME", "IMAGE", "VOLUME", "DAEMON"].filter(key => !envValue(key)).map(key => `LAYERFS_${key}`),
    ];
    return {
      server: "LayerFS-MCP", project: this.config.project, platform: process.platform,
      upstreamCommit: UPSTREAM_COMMIT, sdkLoaded: this.loaded,
      hostRuntime: process.env.LAYERFS_MCP_HOST_RUNTIME || "native",
      executionEngine: process.env.LAYERFS_ENGINE || "docker",
      storePlatformSupported: process.platform === "linux", missing,
      checks, note: "Configuration checks only; run the real integration tests to verify the native Store. Full workspaces need the selected Linux OCI engine and /dev/fuse. Apple Container hosts one project and its Sandboxes in the same Linux VM.",
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    const state = await this.loading?.catch(() => undefined);
    await state?.client.close(); // Does not discard Workspaces or cancel background processes.
  }
}

/** Explicit native loading for doctor only, without opening a Store or mutating a project. */
export async function checkNative(config: Config): Promise<Record<string, unknown>> {
  if (!config.sdkPath) return { ok: false, error: "LAYERFS_SDK_PATH is missing" };
  try {
    const directory = await sdkDirectory(config.sdkPath);
    const addon = process.env.LAYERFS_NATIVE || join(directory, "native/layerfs.node");
    createRequire(pathToFileURL(join(directory, "package.json")))(addon);
    return { ok: true, path: addon };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
