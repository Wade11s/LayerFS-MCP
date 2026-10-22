import { isAbsolute, resolve } from "node:path";
import { z } from "zod";

const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const storePolicySchema = z.object({
  smallFileThreshold: integer.optional(),
  wholeFileDepth: integer.max(255).optional(),
  chunkDepth: integer.max(255).optional(),
  metadataDepth: integer.max(255).optional(),
}).strict();
export const PROJECT_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/;

export interface Config {
  project: string;
  sdkPath?: string;
  storePath?: string;
  storePolicy?: Record<string, number>;
  transport: "stdio" | "http";
  host: string;
  port: number;
  token?: string;
  operator: boolean;
  readOnly: boolean;
  exec: boolean;
}

export function configuration(env: NodeJS.ProcessEnv = process.env): Config {
  const project = env.LAYERFS_MCP_PROJECT || "default";
  if (!PROJECT_NAME_PATTERN.test(project)) throw new Error("Invalid LAYERFS_MCP_PROJECT");
  const transport = env.LAYERFS_MCP_TRANSPORT || "stdio";
  if (env.LAYERFS_ENGINE && !["docker", "podman"].includes(env.LAYERFS_ENGINE)) throw new Error("Unknown LAYERFS_ENGINE");
  if (transport !== "stdio" && transport !== "http") throw new Error("Transport must be stdio or http");
  const port = Number(env.LAYERFS_MCP_PORT || 8787);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Invalid port");
  const storePath = env.LAYERFS_STORE_PATH || env.DSH_LAYERFS_STORE_PATH;
  if (storePath && !isAbsolute(storePath)) throw new Error("LAYERFS_STORE_PATH must be absolute");
  return {
    project,
    sdkPath: env.LAYERFS_SDK_PATH ? resolve(env.LAYERFS_SDK_PATH) : undefined,
    storePath,
    storePolicy: env.LAYERFS_MCP_STORE_POLICY ? storePolicySchema.parse(JSON.parse(env.LAYERFS_MCP_STORE_POLICY)) as Record<string, number> : undefined,
    transport,
    host: env.LAYERFS_MCP_HOST || "127.0.0.1",
    port,
    token: env.LAYERFS_MCP_TOKEN || undefined,
    operator: env.LAYERFS_MCP_OPERATOR !== "0",
    readOnly: env.LAYERFS_MCP_READ_ONLY === "1",
    exec: env.LAYERFS_MCP_EXEC !== "0",
  };
}

export const loopback = (host: string): boolean => ["localhost", "127.0.0.1", "::1"].includes(host);
