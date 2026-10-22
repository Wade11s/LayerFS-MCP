import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { appleOptions, assertAppleOwnership } from "../dist/apple.js";
import { UPSTREAM_COMMIT } from "../dist/backend.js";

test("Apple project selection is deterministic, collision resistant and rejects unsafe names", () => {
  assert.deepEqual(appleOptions({ project: "project-a" }), appleOptions({ project: "project-a" }));
  assert.notEqual(appleOptions({ project: "a" }).name, appleOptions({ project: "b" }).name);
  assert(appleOptions({ project: "a".repeat(63) }).name.length <= 63);
  for (const input of [{ project: "../other" }, { name: "wrong/name" }, { image: "--privileged" }, { memory: "0G" }, { cpus: "0" }]) assert.throws(() => appleOptions(input));
});

test("Apple CLI cannot adopt unrelated VMs, projects, Store volumes or host mounts", () => {
  const options = appleOptions({ project: "a" });
  const vm = { id: options.name, configuration: { labels: {
    "io.layerfs-mcp.owner": "layerfs-mcp.apple.v1", "io.layerfs-mcp.project": "a", "io.layerfs-mcp.upstream": UPSTREAM_COMMIT,
  }, mounts: [{ destination: "/state", type: { volume: { name: `${options.name}-state` } } }] } };
  assert.doesNotThrow(() => assertAppleOwnership(vm, options));
  const otherProject = structuredClone(vm); otherProject.configuration.labels["io.layerfs-mcp.project"] = "b";
  assert.throws(() => assertAppleOwnership(otherProject, options), /not owned/);
  const wrongVolume = structuredClone(vm); wrongVolume.configuration.mounts[0].type.volume.name = "unrelated";
  assert.throws(() => assertAppleOwnership(wrongVolume, options), /wrong state volume/);
  const dockerSocket = structuredClone(vm); dockerSocket.configuration.mounts.push({ destination: "/var/run/docker.sock" });
  assert.throws(() => assertAppleOwnership(dockerSocket, options), /unexpected host mounts/);
});

test("Apple seccomp policy preserves the upstream user-namespace denial and clone3 fallback", async () => {
  const policy = JSON.parse(await readFile(new URL("../apple/seccomp.json", import.meta.url), "utf8"));
  assert.deepEqual(policy, {
    defaultAction: "SCMP_ACT_ALLOW",
    syscalls: [{ names: ["unshare", "clone"], action: "SCMP_ACT_ERRNO", errnoRet: 1, args: [{ index: 0, value: 268435456, valueTwo: 268435456, op: "SCMP_CMP_MASKED_EQ" }] },
      { names: ["clone3"], action: "SCMP_ACT_ERRNO", errnoRet: 38 }],
  });
});
