import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { assertAppleOwnership } from "../dist/apple.js";

if (process.platform !== "darwin") throw new Error("Apple Container tests require a macOS host");
const root = fileURLToPath(new URL("../", import.meta.url));
const project = `apple-test-${randomUUID().slice(0, 8)}`;
const name = `lfm-${project}`;
function run(command, args, capture = false, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, stdio: capture ? "pipe" : "inherit", encoding: "utf8", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed: ${result.stderr || result.status}`);
  return result.stdout?.trim();
}
const args = ["dist/cli.js", "apple", "setup", "--project", project, "--name", name];
if (process.env.LAYERFS_APPLE_TEST_IMAGE) args.push("--image", process.env.LAYERFS_APPLE_TEST_IMAGE);
if (process.env.LAYERFS_APPLE_TEST_ARCHIVE) args.push("--sandbox-archive", process.env.LAYERFS_APPLE_TEST_ARCHIVE, "--sandbox-image", process.env.LAYERFS_APPLE_TEST_SANDBOX || "docker.io/library/layerfs-mcp:local");
try {
  run(process.execPath, args);
  run(process.execPath, ["--test", "test/real/apple-host.test.mjs"], false,
    { ...process.env, LAYERFS_APPLE_TESTS: "1", LAYERFS_APPLE_TEST_PROJECT: project, LAYERFS_APPLE_TEST_NAME: name });
} finally {
  const inspected = spawnSync("container", ["inspect", name], { encoding: "utf8" });
  if (inspected.status === 0) {
    const [vm] = JSON.parse(inspected.stdout);
    assertAppleOwnership(vm, { name, project });
    if (vm.status?.state === "running") run("container", ["stop", name]);
    run("container", ["delete", name]);
    run("container", ["volume", "delete", `${name}-state`]);
  }
}
