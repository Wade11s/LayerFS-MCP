import { createHash } from "node:crypto";

export type RuntimeInput = Record<string, unknown>;

export interface RuntimeSelection {
  project: string;
  name: string;
  image: string;
  cpus: string;
  memory: string;
  source?: string;
  archive?: string;
  sandboxImage?: string;
}

export type RuntimeIdentity = Pick<RuntimeSelection, "project" | "name" | "image" | "source" | "sandboxImage">;

export function assertProjectName(project: string): void {
  if (!/^[a-z0-9](?:[a-z0-9_.-]{0,61}[a-z0-9])?$/.test(project)) throw new Error("Invalid project name");
}

/** Order is the contract: project, name, cpus/memory, image, then the optional extra paths. */
export function parseSelection(input: RuntimeInput, imageDefault: string): RuntimeSelection {
  const project = String(input.project || process.env.LAYERFS_MCP_PROJECT || "default");
  assertProjectName(project);
  const hash = createHash("sha256").update(project).digest("hex").slice(0, 8);
  const name = String(input.name || `lfm-${project.slice(0, 35)}-${hash}`);
  if (!/^[a-z0-9][a-z0-9_.-]{0,62}$/.test(name)) throw new Error("Invalid Apple VM name");
  const cpus = String(input.cpus || "2");
  const memory = String(input.memory || "2G");
  if (!/^[1-9][0-9]?$/.test(cpus) || !/^[1-9][0-9]*(?:[KMGTP])?$/i.test(memory)) throw new Error("Invalid VM resource selection");
  const image = String(input.image || imageDefault);
  if (!image || /\s/.test(image) || image.startsWith("-")) throw new Error("Invalid runtime image");
  return { project, name, image, cpus, memory,
    source: input.source ? String(input.source) : undefined,
    archive: input["sandbox-archive"] ? String(input["sandbox-archive"]) : undefined,
    sandboxImage: input["sandbox-image"] ? String(input["sandbox-image"]) : undefined };
}
