#!/usr/bin/env node
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { configuration } from "./config.js";
import { LayerFSBackend, checkNative, type Backend } from "./backend.js";
import { createServer } from "./server.js";
import { serveHttp } from "./http.js";
import { ManagedBackend } from "./managed.js";
import { isHostCommand, runLegacyCommand } from "./driver.js";
import { capture } from "./host-exec.js";
import { VERSION } from "./package-info.js";
import { resolveProfile, readProfile, helperArguments, withRuntimeLock } from "./runtime.js";

async function main(): Promise<void> {
  const command = process.argv[2];
  if (isHostCommand(command)) {
    await runLegacyCommand(command, process.argv.slice(3));
    return;
  }
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    help: { type: "boolean", short: "h" }, transport: { type: "string" },
    project: { type: "string" }, "sdk-path": { type: "string" }, "store-path": { type: "string" },
    host: { type: "string" }, port: { type: "string" },
    "read-only": { type: "boolean" }, "no-operator": { type: "boolean" }, "disable-exec": { type: "boolean" },
    backend: { type: "string" }, image: { type: "string" }, name: { type: "string" }, source: { type: "string" },
    cpus: { type: "string" }, memory: { type: "string" }, "sandbox-image": { type: "string" }, "sandbox-archive": { type: "string" },
  } });
  if (values.help) {
    console.log(`LayerFS-MCP ${VERSION}
Usage: layerfs-mcp [serve|setup|init|status|stop|doctor] [options]
  --backend apple-container|docker|native  apple alias accepted; saved per project; default Apple Container on Mac
  --source PATH                read-only import source; init is explicit
  --image REF                  runtime image; default is built automatically when absent
  --sandbox-image REF          custom Sandbox image
  --name NAME                  override the project runtime name
  --cpus N --memory 2G          Apple VM resources at first creation
  --sandbox-archive PATH        Apple: optional offline Sandbox OCI archive
  --transport stdio|http       default: stdio
  --project NAME               default: LAYERFS_MCP_PROJECT or default
  --sdk-path PATH              LayerFS checkout or sdk/js directory
  --store-path PATH            Linux-local installed Store path
  --host HOST --port PORT      HTTP default: 127.0.0.1:8787, endpoint /mcp
  --read-only                 expose only reads
  --no-operator               hide internal operator methods
  --disable-exec              hide command/process execution methods
HTTP authentication: set LAYERFS_MCP_TOKEN (required for non-loopback binds).
serve prepares the runtime automatically; setup is optional prewarming.
MCP connects immediately; layerfs_status reports preparing/ready/failed.
init imports the configured source (or example seed). serve never imports data.
Profiles: LAYERFS_MCP_CONFIG_DIR or ~/.config/layerfs-mcp.
Native mode uses an existing Linux SDK deployment; LAYERFS_SDK_PATH selects it by default.
Legacy apple subcommands remain available. See README.`);
    return;
  }
  const action = positionals[0] || "serve";
  if (positionals.length > 1 || !["serve", "setup", "init", "status", "stop", "doctor"].includes(action)) throw new Error("Unknown command; use --help");
  const env = { ...process.env };
  for (const [flag, variable] of Object.entries({ transport: "LAYERFS_MCP_TRANSPORT", project: "LAYERFS_MCP_PROJECT", "sdk-path": "LAYERFS_SDK_PATH", "store-path": "LAYERFS_STORE_PATH", host: "LAYERFS_MCP_HOST", port: "LAYERFS_MCP_PORT" })) {
    if (typeof values[flag as keyof typeof values] === "string") env[variable] = values[flag as keyof typeof values] as string;
  }
  if (values["read-only"]) env.LAYERFS_MCP_READ_ONLY = "1";
  if (values["no-operator"]) env.LAYERFS_MCP_OPERATOR = "0";
  if (values["disable-exec"]) env.LAYERFS_MCP_EXEC = "0";
  const config = configuration(env);
  const requestedBackend = values.backend || env.LAYERFS_MCP_BACKEND || (config.sdkPath ? "native" : undefined);
  const selected = requestedBackend === "apple-container" ? "apple" : requestedBackend;
  if (selected && !["apple", "docker", "native"].includes(selected)) throw new Error("Backend must be apple-container (alias: apple), docker or native");
  const controller = new AbortController();
  let backend: Backend;
  if (selected === "native") {
    backend = new LayerFSBackend(config);
    if (action === "setup" || action === "stop") throw new Error("Native mode uses an existing Linux deployment; manage its lifecycle externally");
    if (action === "init") {
      if (!values.source) throw new Error("Native init requires --source");
      try { console.log(JSON.stringify(await backend.invoke("project.init", [values.source]), null, 2)); }
      finally { await backend.close(); }
      return;
    }
  } else {
    if (values["sdk-path"] || values["store-path"]) throw new Error("--sdk-path and --store-path apply to --backend native only");
    if (["status", "doctor", "stop"].includes(action)) {
      const profile = await readProfile(config.project);
      if (!profile) { console.log(JSON.stringify({ project: config.project, state: "not-configured" })); return; }
      if (selected && selected !== profile.backend) throw new Error(`Project ${config.project} is configured for ${profile.backend}`);
      const args = helperArguments(profile, action === "doctor" ? "status" : action);
      const result = await withRuntimeLock(`runtime:${profile.backend}:${profile.name}`, controller.signal, () => capture(process.execPath, args));
      if (action === "stop") console.log(JSON.stringify({ project: profile.project, backend: profile.backend, state: "stopped", volumesRetained: true }));
      else process.stdout.write(result);
      return;
    }
    const profile = await resolveProfile({ ...values, backend: selected }, config.project, controller.signal);
    const managed = new ManagedBackend(profile);
    backend = managed;
    if (action === "setup" || action === "init") {
      const cancel = () => { void managed.close(); };
      process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
      try {
        await managed.waitReady();
        if (action === "init") {
          const sourcePath = profile.source ? "/source" : "/example-seed";
          console.log(JSON.stringify(await managed.invoke("project.init", [sourcePath], { sourcePath }), null, 2));
        } else console.log(JSON.stringify({ project: config.project, backend: profile.backend, state: "ready" }));
      } finally {
        await managed.close();
        process.off("SIGINT", cancel); process.off("SIGTERM", cancel);
      }
      return;
    }
  }
  if (action === "doctor" || action === "status") {
    const report = await backend.diagnostics();
    const native = await checkNative(config);
    console.log(JSON.stringify({ ...report, native }, null, 2));
    if (!native.ok || report.storePlatformSupported === false || (report.missing as string[]).length) process.exitCode = 1;
    return;
  }
  let closeTransport: () => Promise<void>;
  if (config.transport === "stdio") {
    const server = createServer(config, backend);
    await server.connect(new StdioServerTransport());
    closeTransport = () => server.close();
    server.server.onclose = () => { void backend.close().catch(error => console.error(error)); };
  } else {
    const listener = await serveHttp(config, backend);
    const address = listener.address();
    console.error(`LayerFS-MCP listening on ${typeof address === "object" ? address?.port : config.port} (/mcp), project=${config.project}`);
    closeTransport = () => new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  }
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await closeTransport();
    await backend.close();
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); });
  if (backend instanceof ManagedBackend) backend.start();
}

main().catch(error => { console.error(`LayerFS-MCP: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });
