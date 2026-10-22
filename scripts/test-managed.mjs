import { spawnSync } from "node:child_process";
const result = spawnSync(process.execPath, ["--test", "test/real/managed-host.test.mjs"], {
  stdio: "inherit", env: { ...process.env, LAYERFS_MANAGED_TESTS: "1" },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
