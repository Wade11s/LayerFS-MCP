import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { sdkDirectory, assertContract, UPSTREAM_COMMIT } from "../dist/backend.js";
import { tools } from "../dist/contract.js";

if (!process.env.LAYERFS_SDK_PATH) throw new Error("Set LAYERFS_SDK_PATH to a pinned LayerFS checkout; run npm run build first");
const directory = await sdkDirectory(process.env.LAYERFS_SDK_PATH);
const { LayerFS } = await import(pathToFileURL(join(directory, "src/index.js")));
const { LayerFSOperator } = await import(pathToFileURL(join(directory, "operator/index.js")));
const client = new LayerFS("contract-check");
const operator = new LayerFSOperator(client);
assertContract(client, operator);
const actual = [];
for (const group of ["project", "fs", "branch", "workspace"]) {
  for (const name of Object.keys(client[group])) actual.push(`${group}.${name}`);
}
for (const [group, methods] of Object.entries(operator)) {
  for (const name of Object.keys(methods)) actual.push(`operator.${group}.${name}`);
}
assert.deepEqual(actual.sort(), tools.map(t => t.method).sort(), "Upstream added or removed methods; update the bridge contract before upgrading");
console.log(`Verified all ${actual.length} upstream methods (27 public + 13 operator), pinned commit ${UPSTREAM_COMMIT}. No native calls made.`);
