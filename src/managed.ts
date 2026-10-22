import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Backend } from "./backend.js";
import { UPSTREAM_COMMIT } from "./backend.js";
import { tools } from "./contract.js";
import { helperArguments, prepareRuntime, runtimeError, type RuntimeProfile } from "./runtime.js";
import { VERSION } from "./package-info.js";

export class ManagedBackend implements Backend {
  private client?: Client;
  private preparing?: Promise<void>;
  private controller = new AbortController();
  private state: "preparing" | "ready" | "failed" | "closed" = "preparing";
  private stage = "waiting-to-start";
  private error?: string;

  constructor(readonly profile: RuntimeProfile,
    private readonly prepare = prepareRuntime,
    private readonly connect = async (profile: RuntimeProfile, signal: AbortSignal): Promise<Client> => {
      const client = new Client({ name: "layerfs-runtime-bridge", version: VERSION });
      const transport = new StdioClientTransport({ command: process.execPath, args: helperArguments(profile, "serve"),
        env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)), stderr: "inherit" });
      try {
        const abortPromise = new Promise<never>((_, reject) => {
          if (signal.aborted) reject(signal.reason);
          else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
        await Promise.race([client.connect(transport), abortPromise]);
        return client;
      } catch (error) { await client.close(); throw error; }
    }) {}

  start(): void {
    this.preparing ??= this.initialize().catch(error => {
      if (this.state !== "closed") {
        this.state = "failed";
        this.error = error instanceof Error ? error.message : String(error);
        console.error(`LayerFS-MCP runtime preparation failed: ${this.error}`);
      }
    });
  }

  private async initialize(): Promise<void> {
    await this.prepare(this.profile, this.controller.signal, stage => { this.stage = stage; });
    this.controller.signal.throwIfAborted();
    this.stage = "connecting";
    const signal = this.controller.signal;
    const arriving = this.connect(this.profile, signal);
    // The rejection surfaces through the race below and lands in start()'s failure
    // handler; this arm only closes a client that arrives after close().
    arriving.then(client => { if (this.state === "closed") void client.close().catch(() => {}); }, () => {});
    const abortPromise = new Promise<never>((_, reject) => {
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
    const client = await Promise.race([arriving, abortPromise]);
    if (this.state === "closed") { await client.close(); return; }
    client.onclose = () => {
      if (this.state === "ready") { this.state = "failed"; this.error = "Runtime connection closed; reconnect the MCP server. No operation is replayed."; }
    };
    this.client = client;
    this.state = "ready";
    this.stage = "ready";
  }

  async waitReady(): Promise<void> {
    this.start();
    await this.preparing;
    this.assertReady();
  }

  private assertReady(): Client {
    if (this.state === "ready" && this.client) return this.client;
    if (this.state === "preparing") throw runtimeError("RuntimePreparing", "Runtime is being prepared. No LayerFS operation was started. Check layerfs_status and call again after runtimeState becomes ready.", { stage: this.stage });
    throw runtimeError("RuntimeUnavailable", this.error || "Runtime connection is closed", { stage: this.stage });
  }

  async invoke(method: string, args: unknown[], input?: Record<string, unknown>): Promise<unknown> {
    const client = this.assertReady();
    const definition = tools.find(tool => tool.method === method);
    if (!definition) throw runtimeError("UnknownMethod", method);
    // Resources use the same verified method, without an external tool input.
    const arguments_ = input ?? (method === "project.list_branches" ? { pageSize: args[0], pagePos: args[1] } : undefined);
    if (!arguments_) throw runtimeError("BridgeError", "Missing validated tool arguments");
    const result = await client.callTool({ name: definition.name, arguments: arguments_ }, undefined, { timeout: 120_000 });
    const structured = result.structuredContent as { result?: unknown; error?: { code: string; message: string; detail?: unknown } } | undefined;
    if (result.isError) throw runtimeError(structured?.error?.code || "RuntimeError", structured?.error?.message || "Runtime tool failed", structured?.error?.detail);
    if (!structured || !("result" in structured)) throw runtimeError("BridgeError", "Runtime returned no structured result");
    return structured.result;
  }

  async diagnostics(): Promise<Record<string, unknown>> {
    let inner: Record<string, unknown> = {};
    if (this.state === "ready") {
      const result = await this.assertReady().callTool({ name: "layerfs_status", arguments: {} });
      if (result.isError) throw runtimeError("RuntimeError", "Runtime diagnostics failed", result.structuredContent);
      inner = (result.structuredContent as { result: Record<string, unknown> }).result;
    }
    return { ...inner, server: "LayerFS-MCP", project: this.profile.project, backend: this.profile.backend,
      upstreamCommit: UPSTREAM_COMMIT, runtimeState: this.state, stage: this.stage,
      ...(this.error ? { error: this.error } : {}),
      ...(this.state !== "ready" ? { note: "Automatic preparation is in progress or failed. Project data is never imported automatically." } : {}) };
  }

  async close(): Promise<void> {
    this.state = "closed";
    this.controller.abort();
    await this.client?.close();
    await this.preparing;
  }
}
