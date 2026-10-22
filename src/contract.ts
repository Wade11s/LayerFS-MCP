import { z } from "zod";

const text = z.string();
const nonempty = text.min(1);
const path = nonempty.startsWith("/").refine((v) => !v.includes("\0"), "NUL is not allowed");
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const line = integer.min(1);
const page = { pageSize: integer.min(1).max(1000).optional(), pagePos: integer.optional() };
const message = text.optional(); // UTF-8 byte/control checks belong to LayerFS.
const encoding = z.enum(["utf8", "base64"]).optional();
const ws = z.object({ sandbox: nonempty, path, image: text.optional() }).strict();
const branch = { branch: nonempty };
const refPath = { ref: nonempty, path };
const branchPath = { ...branch, path, message };
const diff = { from: nonempty, to: nonempty, ...page, cursor: path.optional(), hunks: z.boolean().optional() };

const changes = z.discriminatedUnion("op", [
  z.object({ op: z.literal("write"), path, content: text, encoding }).strict(),
  z.object({ op: z.literal("edit"), path, oldText: text, newText: text }).strict(),
  z.object({ op: z.literal("mkdir"), path }).strict(),
  z.object({ op: z.literal("rm"), path }).strict(),
  z.object({ op: z.literal("cp"), from: path, to: path }).strict(),
  z.object({ op: z.literal("mv"), from: path, to: path }).strict(),
]);

export interface ToolDefinition {
  name: string;
  method: string;
  description: string;
  schema: z.AnyZodObject;
  args: (input: Record<string, any>) => unknown[];
  readOnly: boolean;
  destructive: boolean;
  execution: boolean;
  operator: boolean;
}

function define(
  method: string,
  description: string,
  shape: z.ZodRawShape,
  args: ToolDefinition["args"],
  flags: { readOnly?: boolean; destructive?: boolean; execution?: boolean } = {},
): ToolDefinition {
  return {
    name: `layerfs_${method.replaceAll(".", "_")}`,
    method, description, schema: z.object(shape).strict(), args,
    readOnly: flags.readOnly ?? false,
    destructive: flags.destructive ?? false,
    execution: flags.execution ?? false,
    operator: method.startsWith("operator."),
  };
}

export function binary(content: string, format?: string): string | Buffer {
  if (format !== "base64") return content;
  const bytes = Buffer.from(content, "base64");
  if (bytes.toString("base64") !== content) {
    throw Object.assign(new Error("content must be canonical padded base64"), { code: "InvalidInput" });
  }
  return bytes;
}

const readonly = { readOnly: true };
const paged = (a: Record<string, any>) => [a.pageSize, a.pagePos];
export const tools: ToolDefinition[] = [
  define("project.init", "Initialize this server's project from a host directory. Explicit, one-time import; requires Linux and an installed native addon. Never called automatically.", { sourcePath: path }, a => [a.sourcePath]),
  define("project.list_branches", "List project branches. Follow hasMore with pagePos + items.length.", page, paged, readonly),
  define("fs.read", "Read UTF-8 lines from a branch, commit or layer. Lines are 1-based and inclusive. Follow nextLine and inspect truncated/lineTruncated; binary files are refused.", { ...refPath, startLine: line.optional(), endLine: line.optional() }, a => [a.ref, a.path, a.startLine, a.endLine], readonly),
  define("fs.list", "List a saved directory, with pagination.", { ref: nonempty, path: path.optional(), ...page }, a => [a.ref, a.path, ...paged(a)], readonly),
  define("fs.stat", "Read saved file or directory metadata.", refPath, a => [a.ref, a.path], readonly),
  ...["grep", "glob"].map(method => define(`fs.${method}`, method === "grep" ? "Search saved text using LayerFS pattern semantics, with pagination." : "Find saved paths using a glob pattern, with pagination.", { ref: nonempty, pattern: text, path: path.optional(), ...page }, a => [a.ref, a.pattern, a.path, ...paged(a)], readonly)),
  define("fs.diff_files", "Compare two saved file versions, including versions at different paths.", { leftRef: nonempty, leftPath: path, rightRef: nonempty, rightPath: path }, a => [a.leftRef, a.leftPath, a.rightRef, a.rightPath], readonly),
  define("fs.blame", "Read line attribution from a saved file. Inspect comparisonCoarse and continuation fields.", { ...refPath, fromLine: line.optional() }, a => [a.ref, a.path, a.fromLine], readonly),
  define("fs.write", "Write UTF-8 or base64-decoded binary content on a writable branch, creating a deduplicated checkpoint. main changes only through publish.", { ...branchPath, content: text, encoding }, a => [a.branch, a.path, binary(a.content, a.encoding), a.message], { destructive: true }),
  define("fs.edit", "Replace exactly one occurrence on a branch and checkpoint. Zero or multiple matches are refused.", { ...branchPath, oldText: text, newText: text }, a => [a.branch, a.path, a.oldText, a.newText, a.message], { destructive: true }),
  define("fs.apply", "Apply ordered write/edit/mkdir/rm/cp/mv changes atomically as one checkpoint. Refusals retain detail.index. Binary writes use encoding=base64.", { ...branch, changes: z.array(changes), message }, a => [a.branch, a.changes.map((c: Record<string, any>) => {
    if (c.op !== "write") return c;
    const body = binary(c.content, c.encoding);
    return typeof body === "string" ? { op: "write", path: c.path, content: body } : { op: "write", path: c.path, bytes: body };
  }), a.message], { destructive: true }),
  define("fs.mkdir", "Create a directory and its parents on a branch, then checkpoint. An existing directory is a no-op.", branchPath, a => [a.branch, a.path, a.message]),
  define("fs.rm", "Remove a saved path on a branch, then checkpoint.", branchPath, a => [a.branch, a.path, a.message], { destructive: true }),
  ...["cp", "mv"].map(method => define(`fs.${method}`, `${method === "cp" ? "Copy" : "Move"} a path on a branch and checkpoint. Destination is exact and must not exist.`, { ...branch, from: path, to: path, message }, a => [a.branch, a.from, a.to, a.message], { destructive: method === "mv" })),
  define("branch.fork", "Fork a writable branch from main, any branch, commit or layer. Forking an earlier ref provides rewind without rewriting history.", { name: nonempty, fromRef: nonempty.optional() }, a => [a.name, a.fromRef]),
  define("branch.list_commits", "Page a branch's checkpoint history, newest first along first parents.", { ...branch, ...page }, a => [a.branch, ...paged(a)], readonly),
  ...["diff_commits", "diff_branches"].map(method => define(`branch.${method}`, "Page changed paths between two saved refs. Pass nextCursor as cursor for continuation; hunks=false omits line hunks.", diff, a => [a.from, a.to, ...paged(a), { cursor: a.cursor, hunks: a.hunks }], readonly)),
  define("branch.merge", "Merge two branches into a new named branch. Preserve Conflict.detail and truncation flags. Optional merge units group related path patterns; .lww rules are handled by LayerFS.", { a: nonempty, b: nonempty, name: nonempty, message, units: z.array(z.union([text, z.object({ name: nonempty, patterns: z.array(text) }).strict()])).optional() }, a => [a.a, a.b, a.name, a.message, a.units]),
  define("branch.publish", "Publish a branch (optionally a specific commit) to main as a new immutable layer.", { ...branch, commit: nonempty.optional() }, a => [a.branch, a.commit], { destructive: true }),
  define("workspace.mount", "Mount a branch as an isolated writable FUSE Workspace. LayerFS chooses or creates its Sandbox. Save the returned {sandbox,path} handle; optional image is a local immutable sha256 digest.", { ...branch, image: text.regex(/^sha256:[a-f0-9]{64}$/).optional() }, a => [a.branch, a.image === undefined ? undefined : { image: a.image }]),
  define("workspace.exec", "Run a command in a mounted Workspace; returns complete stdout/stderr and exitCode. Does not checkpoint: call workspace.commit afterward, including after a failing command. A client timeout does not establish that the command stopped; inspect before retrying.", { ws, command: nonempty, message }, a => [a.ws, a.command, a.message], { destructive: true, execution: true }),
  define("workspace.status", "Read a mounted Workspace's pending state and branch head.", { ws }, a => [a.ws], readonly),
  define("workspace.commit", "Checkpoint Workspace changes and merge against its current branch head once. Conflicts preserve the Workspace for inspection. force is passed unchanged to LayerFS.", { ws, message, force: z.boolean().optional() }, a => [a.ws, a.message, a.force], { destructive: true }),
  define("workspace.unmount", "End a Workspace. Dirty state is refused unless discard=true. History is retained; idle Sandboxes are reclaimed by LayerFS.", { ws, discard: z.boolean().optional() }, a => [a.ws, a.discard], { destructive: true }),
  define("operator.store.stats", "Read physical/logical storage and deduplication statistics. Null measurements remain null.", {}, () => [], readonly),
  define("operator.store.commits", "Read checkpoint records with storage diagnostics.", { ...branch, ...page }, a => [a.branch, ...paged(a)], readonly),
  define("operator.store.overwritten", "Page layers overwritten by a publication, newest first.", { layer: nonempty, ...page }, a => [a.layer, ...paged(a)], readonly),
  define("operator.files.stats", "Read file storage diagnostics; physical attribution can be null.", refPath, a => [a.ref, a.path], readonly),
  define("operator.files.history", "Page a saved file's revision diagnostics.", { ...refPath, ...page }, a => [a.ref, a.path, ...paged(a)], readonly),
  define("operator.workspace.overlay", "Read a mounted Workspace's overlay statistics.", { ws }, a => [a.ws], readonly),
  define("operator.workspace.changes", "Page pending Workspace changes.", { ws, ...page }, a => [a.ws, ...paged(a)], readonly),
  define("operator.inspect.snapshot", "Read project history and all live Workspaces. Pass the previous version as since to receive kind=unchanged when applicable. Upstream discovery may reclaim stopped Sandbox records.", { since: text.optional() }, a => [a.since]),
  define("operator.sandbox.list", "Discover the project's Sandboxes and their images. Upstream may reclaim stopped Sandbox records during discovery.", {}, () => []),
  define("operator.project.progress", "Read same-process project initialization progress, or null if no Init is running. Counts are progress, not totals.", {}, () => [], readonly),
  define("operator.process.start", "Start a supervised background command in a Workspace. Keep the returned process id; commit filesystem changes explicitly.", { ws, command: nonempty }, a => [a.ws, a.command], { destructive: true, execution: true }),
  define("operator.process.list", "List the project's background processes, including their Sandbox ids.", {}, () => [], readonly),
  define("operator.process.cancel", "Cancel a background process by its persisted process id.", { process: nonempty }, a => [a.process], { destructive: true, execution: true }),
];

export const storePolicySchema = z.object({
  smallFileThreshold: integer.optional(),
  wholeFileDepth: integer.max(255).optional(),
  chunkDepth: integer.max(255).optional(),
  metadataDepth: integer.max(255).optional(),
}).strict();
