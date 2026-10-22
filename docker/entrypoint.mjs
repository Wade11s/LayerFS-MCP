import { mkdirSync, chmodSync } from "node:fs";

// Only container-owned directories. Never create a project or import data on startup.
mkdirSync(process.env.LAYERFS_HOME, { recursive: true, mode: 0o700 });
chmodSync(process.env.LAYERFS_HOME, 0o700);
mkdirSync("/layerfs-store/global", { recursive: true, mode: 0o700 });
chmodSync("/layerfs-store/global", 0o700);
await import("/app/dist/cli.js");
