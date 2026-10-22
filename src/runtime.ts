import { readFile, mkdir, rename, writeFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import lockfile from "proper-lockfile";
import { z } from "zod";
import { loadDriver } from "./driver.js";
import { assertCreationFlags, assertHostForProfile, setupReentryFlags } from "./driver-flags.js";
import { capture, run } from "./host-exec.js";
import { CLI, PACKAGE_ROOT, defaultImage } from "./package-info.js";
import { assertProjectName, parseSelection, type RuntimeInput } from "./selection.js";

const profileSchema = z.object({
  version: z.literal(1), backend: z.enum(["apple", "docker"]), project: z.string(),
  name: z.string(), image: z.string(), source: z.string().optional(),
  cpus: z.string(), memory: z.string(), archive: z.string().optional(), sandboxImage: z.string().optional(),
}).strict();
export type RuntimeProfile = z.infer<typeof profileSchema>;
export type HostBackend = RuntimeProfile["backend"];
const configDirectory = () => resolve(process.env.LAYERFS_MCP_CONFIG_DIR || join(homedir(), ".config", "layerfs-mcp"));
export const runtimeError = (code: string, message: string, detail?: unknown) => Object.assign(new Error(message), { code, detail });

type CreationField = Exclude<keyof RuntimeProfile, "version" | "backend" | "project">;
const CREATION_FIELDS = ["name", "image", "source", "cpus", "memory", "archive", "sandboxImage"] as const satisfies readonly CreationField[];

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;
type CreationFieldsComplete = Assert<Equal<(typeof CREATION_FIELDS)[number], CreationField>>;

export async function withRuntimeLock<T>(key: string, signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const directory = join(configDirectory(), "locks");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, createHash("sha256").update(key).digest("hex"));
  let release: (() => Promise<void>) | undefined;
  let compromised: Error | undefined;
  const guard = new AbortController();
  const guardedSignal = AbortSignal.any([signal, guard.signal]);
  while (!release) {
    signal.throwIfAborted();
    try { release = await lockfile.lock(path, { realpath: false, stale: 60_000, update: 10_000, retries: 0,
      onCompromised: error => { compromised = error; guard.abort(error); } }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      await delay(250, undefined, { signal });
    }
  }
  try {
    signal.throwIfAborted();
    const result = await operation(guardedSignal);
    if (compromised) throw compromised;
    return result;
  } finally { if (!compromised) await release(); }
}

function profilePath(project: string): string {
  assertProjectName(project); // Validate before using the project in a filename.
  return join(configDirectory(), "projects", `${project}.json`);
}

export async function readProfile(project: string): Promise<RuntimeProfile | undefined> {
  let raw: string;
  try { raw = await readFile(profilePath(project), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  const profile = profileSchema.parse(JSON.parse(raw));
  if (profile.project !== project) throw new Error("Project configuration identity mismatch");
  parseSelection({ ...profile, "sandbox-archive": profile.archive, "sandbox-image": profile.sandboxImage }, defaultImage(profile.backend));
  return profile;
}

export async function resolveProfile(input: RuntimeInput, project: string, signal: AbortSignal): Promise<RuntimeProfile> {
  return withRuntimeLock(`profile:${project}`, signal, async () => {
    const previous = await readProfile(project);
    const backend = input.backend || previous?.backend || (process.platform === "darwin" ? "apple" : "docker");
    if (backend !== "apple" && backend !== "docker") throw new Error("Backend must be apple, docker or native");
    assertHostForProfile(backend);
    if (previous && backend !== previous.backend) throw new Error(`Project ${project} already uses ${previous.backend}; use a different project name for ${backend}. Stores are not migrated automatically.`);
    const selected: RuntimeInput = { ...(previous || {}), ...Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)), project,
      image: input.image || previous?.image || defaultImage(backend) };
    if (selected.source) selected.source = await realpath(String(selected.source));
    if (selected["sandbox-archive"]) selected["sandbox-archive"] = await realpath(String(selected["sandbox-archive"]));
    const options = parseSelection({ ...selected, "sandbox-archive": selected["sandbox-archive"] || previous?.archive,
      "sandbox-image": selected["sandbox-image"] || previous?.sandboxImage }, defaultImage(backend));
    const profile = profileSchema.parse(Object.fromEntries(Object.entries({ version: 1, backend, ...options }).filter(([, value]) => value !== undefined)));
    assertCreationFlags(backend, input, profile);
    if (previous) {
      for (const key of CREATION_FIELDS) {
        if (previous[key] !== profile[key]) throw new Error(`Project ${project} is already configured with a different ${key}; use a new project or explicitly manage its existing runtime configuration.`);
      }
      return previous;
    }
    const path = profilePath(project);
    await mkdir(join(configDirectory(), "projects"), { recursive: true, mode: 0o700 });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(profile, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    return profile;
  });
}

export function helperArguments(profile: RuntimeProfile, action: string): string[] {
  const args = [CLI, profile.backend, action, "--project", profile.project, "--name", profile.name, "--image", profile.image];
  if (action === "setup") {
    if (profile.source) args.push("--source", profile.source);
    if (profile.sandboxImage) args.push("--sandbox-image", profile.sandboxImage);
    args.push(...setupReentryFlags(profile));
  }
  return args;
}

export async function prepareRuntime(profile: RuntimeProfile, signal: AbortSignal, stage: (text: string) => void): Promise<void> {
  stage("waiting-for-runtime");
  const driver = await loadDriver(profile.backend);
  await withRuntimeLock(`runtime:${profile.backend}:${profile.name}`, signal, async signal => {
    stage("checking-engine");
    const engine = driver.engine();
    await engine.ensure(signal);
    stage("preparing-image");
    // Serialize shared image preparation across projects as well as clients.
    await withRuntimeLock(`image:${profile.backend}:${profile.image}`, signal, async signal => {
      try { await capture(engine.bin, ["image", "inspect", profile.image], signal); return; }
      catch { signal.throwIfAborted(); }
      if (profile.image !== defaultImage(profile.backend)) {
        await run(engine.bin, ["image", "pull", profile.image], signal);
      } else {
        stage("building-image");
        await run(engine.bin, [...engine.imageBuildArgs(profile.image), PACKAGE_ROOT], signal);
      }
    });
    stage("starting-runtime");
    await run(process.execPath, helperArguments(profile, "setup"), signal);
  });
}
