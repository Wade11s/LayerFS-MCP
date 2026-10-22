import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const suffix = randomUUID().slice(0, 8);
const volume = `layerfs-mcp-test-${suffix}`;
const prefix = `${volume}-`;
const image = process.env.LAYERFS_MCP_TEST_IMAGE || "layerfs-mcp:local";
function docker(args, capture = false) {
  const result = spawnSync("docker", args, { cwd: root, stdio: capture ? "pipe" : "inherit", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`docker ${args[0]} failed (${result.status}): ${result.stderr || "see output"}`);
  return result.stdout?.trim();
}
const digest = docker(["image", "inspect", "--format", "{{.Id}}", image], true);
docker(["volume", "create", volume]);
try {
  const network = process.platform === "linux" ? ["--network", "host", "-e", "LAYERFS_DAEMON_HOST=127.0.0.1"] : ["-e", "LAYERFS_DAEMON_HOST=host.docker.internal"];
  docker(["run", "--rm", "--init", ...network,
    "--mount", `type=volume,source=${volume},target=/layerfs-store`,
    "--mount", "type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock",
    "--mount", `type=bind,source=${root}/test,target=/app/test,readonly`,
    "-e", "LAYERFS_REAL_TESTS=1", "-e", "LAYERFS_REAL_WORKSPACES=1",
    "-e", `LAYERFS_IMAGE=${digest}`, "-e", `LAYERFS_VOLUME=${volume}`,
    "-e", `LAYERFS_CONTAINER_PREFIX=${prefix}`, "--entrypoint", "node", image,
    "--test", "/app/test/real/native.test.mjs"]);
} finally {
  const ids = docker(["ps", "-aq", "--filter", `name=^/${prefix}`], true);
  if (ids) docker(["rm", "-f", ...ids.split(/\s+/)]);
  docker(["volume", "rm", volume]);
}
