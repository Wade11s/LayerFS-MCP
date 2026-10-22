import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { HostBackend } from "./runtime.js";

export const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
export const VERSION: string = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")).version;
export const CLI = join(PACKAGE_ROOT, "dist/cli.js");

export function defaultImage(backend: HostBackend): string {
  return `docker.io/library/layerfs-mcp${backend === "apple" ? "-apple" : ""}:${VERSION}`;
}
