import { readFile } from "node:fs/promises";
import http from "node:http";

const record = JSON.parse(await readFile("/state/runtime.json", "utf8"));
const boot = (await readFile("/proc/sys/kernel/random/boot_id", "utf8")).trim();
if (record.bootId !== boot) throw new Error("Stale Apple runtime state; wait for VM initialization");
await new Promise((resolve, reject) => {
  const req = http.get({ socketPath: record.env.LAYERFS_DOCKER, path: "/_ping", timeout: 1000 }, res => { res.resume(); res.once("end", () => res.statusCode === 200 ? resolve() : reject(new Error("OCI engine is not ready"))); });
  req.once("error", reject); req.once("timeout", () => req.destroy(new Error("OCI engine readiness timeout")));
});
const args = process.argv.slice(2);
if (args[0] === "ready") process.exit(0);
Object.assign(process.env, record.env);
if (args[0] === "init") {
  const { LayerFS } = await import("/opt/layerfs/sdk/js/src/index.js");
  const client = new LayerFS(record.env.LAYERFS_MCP_PROJECT);
  try { console.log(JSON.stringify(await client.project.init(args[1] || "/example-seed"), null, 2)); }
  finally { await client.close(); }
} else {
  process.argv = [process.execPath, "/app/dist/cli.js", ...args];
  await import("/app/dist/cli.js");
}
