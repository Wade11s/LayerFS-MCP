import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const inspected = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", "layerfs-mcp:local"], { encoding: "utf8" });
if (inspected.status !== 0) throw new Error("Build layerfs-mcp:local first: docker build -t layerfs-mcp:local .");
const image = inspected.stdout.trim();
if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error("Docker returned an invalid image id");
const content = `LAYERFS_MCP_PROJECT=default\nLAYERFS_MCP_TOKEN=${randomBytes(32).toString("hex")}\nLAYERFS_IMAGE=${image}\nLAYERFS_SOURCE_DIR=./examples/seed\n`;
writeFileSync(join(root, ".env"), content, { flag: "wx", mode: 0o600 });
console.log("Created .env with a random bearer token and the local runtime image id. Existing files are never overwritten.");
