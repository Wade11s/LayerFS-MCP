---
name: verify-layerfs-mcp
description: "Drive the LayerFS-MCP server like a real MCP client and prove behavior end to end: cold serve, status lifecycle, project init, fs edits, branch merge/publish, conflict errors, workspace exec, operator diagnostics, stdio and HTTP transports. Use when changes to src/, apple/, docker/, or the CLI need proof against the real running app, when npm test alone is not enough, or before shipping a release."
---

# Verify LayerFS-MCP

LayerFS-MCP is an MCP server (41 tools) bridging to LayerFS. The user surface is the MCP protocol itself over **stdio** (primary) and **Streamable HTTP**. Verification = a real MCP client (official `@modelcontextprotocol/sdk`, already a repo dependency) spawning `serve` and calling tools — never internal setters or unit-test shims. The repo's own `npm run test:managed` (`test/real/managed-host.test.mjs` + `test/real/workflow.mjs`) is the exhaustive reference; this skill is the on-demand, evidence-capturing drive.

## Launch

No server stays alive between drives. Build once, then every drive spawns its own isolated `serve`:

```sh
npm ci          # only if node_modules/ is missing
npm run build   # tsc -> dist/cli.js (required before any drive)
```

The repo's full behaviour pin is five commands, in this order. A drive alone is not the contract:

```sh
npm run build && npm run check && npm test && npm run golden \
  && node .agents/skills/verify-layerfs-mcp/helpers/drive.mjs
```

What each one actually covers, because the gaps matter:

- `npm test` runs only `test/*.test.mjs`. It excludes `test/real/` and the golden replay.
- `npm run golden` needs `dist/cli.js` built first, drives fake `container`/`docker` binaries, and never touches the user's engine. `--update` rewrites the baselines from the code under test, including any bug it currently has, so it can make a regression disappear. Only regenerate for an intended behaviour change.
- CI's `protocol` job runs `npm ci`, `check`, `test`, and `pack --dry-run` only, so golden and the live drive are local gates. The `native` job runs on `workflow_dispatch` alone and reads SKIPPED on pull requests.

The helper launches `node dist/cli.js serve --project <fresh-verify-uuid> --backend <b> --image <img> --source <repo>/examples/seed` per drive. Readiness contract:

- MCP handshake returns in **< 30 s** even while the runtime image is still building (assert this; a slow handshake is a bug).
- Poll `layerfs_status` (`callTool`, no args) every second: `runtimeState` goes `preparing` → `ready`. First-ever run per backend may build an image (minutes); subsequent runs are fast.
- `runtimeState: "failed"` returns `stage` + `error` — fix the environment and reconnect; do not blind-retry.
- Calls to LayerFS tools during `preparing` fail fast with `RuntimePreparing` — that is correct behavior, not a crash.
- stdout of the serve process belongs to MCP; build/runtime logs go to stderr.

Backend + image selection (the helper does this automatically unless overridden):

- **docker** with the default image ref `docker.io/library/layerfs-mcp:<package version>`, chosen when `docker image inspect` finds it (the usual case on this machine).
- Otherwise **apple-container** on macOS (needs the Apple `container` CLI; if system services are down: `container system start`), or docker with a cold build.
- The image default is the **full ref**, never the short `layerfs-mcp:<version>` form. `prepareRuntime` compares `profile.image` against the full default string to decide whether to verify the `io.layerfs-mcp.upstream` label, so the short form takes the custom-image path and the rebuild branch is never exercised. The helper normalises the short form to the full ref and prints a NOTE for any genuinely custom image.

## Doctor

Run first whenever anything looks off. Read-only, prints JSON.

```sh
node dist/cli.js doctor                 # CAREFUL: without --project this reads the user's saved `default` profile
node dist/cli.js doctor --project <p>   # saved-project runtime status
```

- Without `--project`, doctor resolves the default project name (`default`) — the user's real profile. A `--backend` flag conflicting with the saved profile errors out (`Project default is configured for apple`). For verification, prefer engine checks or `--project <verify-…>` while a `--keep` instance is up.
- Exit code 1 = environment gap: engine missing, `storePlatformSupported: false`, or non-empty `missing` list. Fix that before driving.
- `{"state":"not-configured"}` = project name has no saved profile (expected right after cleanup).
- Quick engine checks: `docker version`, `container system status` (Apple), `node --version` (needs >= 22).

## Drive

Primary harness — one command, full isolated journey with evidence:

```sh
node .agents/skills/verify-layerfs-mcp/helpers/drive.mjs \
  [--backend docker|apple-container] [--image REF] [--full] [--keep]
```

- Defaults: docker + the default image ref `docker.io/library/layerfs-mcp:<package version>` when it exists locally, else apple-container on macOS.
- Core journey: cold handshake → 41 tools → wait `ready` → `layerfs_project_init` from `/source` → fork `alpha`/`beta` → `fs_write`/`fs_edit`/`fs_apply` → `branch_merge` → `branch_publish` → read-back on `main` → assert `Conflict` error path → `operator_store_stats`/`operator_store_overwritten`.
- `--full` adds the workspace block: mount → `workspace_exec` (writes `/command.txt`) → identity asserts (uid 501, `CapEff: 0`, user-namespace creation fails) → background process start/cancel → `workspace_commit` → unmount. Requires FUSE in the backend kernel.
- `--keep` skips teardown (debugging only).
- Exit 0 = pass; non-zero = fail. Evidence is written either way.

Ad-hoc drive (no helper) — the real-client pattern for anything not scripted. Copy this whole shape, cleanup included: an ad-hoc probe that skips the `finally` leaves a running container behind, which is how `lfm-op-*` residue piled up. The resource name is deterministic (`src/apple.ts` `appleOptions`): `lfm-<project[:35]>-<sha256(project)[:8]>`.

```js
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const version = JSON.parse(await readFile("package.json", "utf8")).version;   // or hardcode the ref
const image = `docker.io/library/layerfs-mcp:${version}`;                       // full ref, not the short form
const project = `verify-${randomUUID().slice(0, 8)}`;
const name = `lfm-${project.slice(0, 35)}-${createHash("sha256").update(project).digest("hex").slice(0, 8)}`;
const configDir = await mkdtemp(join(tmpdir(), "verify-config-"));
const env = { ...process.env, LAYERFS_MCP_CONFIG_DIR: configDir };
const client = new Client({ name: "verify-adhoc", version: "1" });

try {
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: ["dist/cli.js", "serve", "--project", project, "--backend", "docker",
           "--image", image, "--source", resolve("examples/seed")],
    env, stderr: "ignore",
  }));
  const r = await client.callTool({ name: "layerfs_fs_read", arguments: { ref: "main", path: "/README.md" } });
  // success: r.isError falsy, payload at r.structuredContent.result
  // failure: r.isError true, code at r.structuredContent.error.code (e.g. "Conflict")
} finally {
  try { await client.close(); } catch {}
  try { execFileSync(process.execPath, ["dist/cli.js", "stop", "--project", project], { env, stdio: "ignore" }); } catch {}
  try { execFileSync("docker", ["rm", "-f", name], { stdio: "ignore" }); } catch {}
  try { execFileSync("docker", ["volume", "rm", `${name}-home`, `${name}-store`], { stdio: "ignore" }); } catch {}
  await rm(configDir, { recursive: true, force: true });
}
```

By hand, clean up with prefix filters rather than the exact name, since that is what catches a name you mis-derived: `docker ps -aq --filter name=^/lfm-<project>-` then `docker rm -f` those, plus `docker volume rm` for each.

Tool recipes per user-facing feature live in [`features/`](features/README.md) — the map is the source of truth; a proof that drives one convenient entry point is incomplete when the map lists others.

## Evidence

Every drive writes `<repo>/verify-evidence/<timestamp>-<project>/`:

- `evidence.json` — backend, image, container name, status stages seen, tool count, per-step timings, pass/fail + error.
- `transcript.jsonl` — every request/response pair, verbatim.

Proof standards:

- Drive the real user path: MCP tool calls against a fresh `serve`. There are no test-only endpoints; all 41 tools are the product.
- Capture the action **and** the resulting state: every write is followed by a read-back from the ref that should contain it (`alpha`, then `main` after publish).
- Verify side effects beyond the reply: `operator_store_stats` answers, `branch_list_commits` returns `> 1` items, published layer id is a string.
- Error paths are asserted, not avoided: the deliberate `branch_merge` conflict must return `isError: true` with `structuredContent.error.code === "Conflict"`.
- **Output text fidelity.** A harness that asserts structured fields and exit codes is blind to wording. When a change claims zero behaviour change, pin the user-visible text too: capture stderr sentences, CLI stdout, and error strings from before and after, and diff them verbatim. Interrogate found exactly this class of regression after six green drives: unpacking `JSON.parse(...)[0]` changed the stderr text for non-array engine payloads while every status assertion still passed.
- Evidence survives cleanup (see below); `verify-evidence/` is gitignored.

## Cleanup

The helper tears down in a `finally` block (unless `--keep`) — never kill by process name, only what the run created:

1. Close every MCP client, then `node dist/cli.js stop --project <p>` (`stop` **retains** data volumes by design).
2. Remove exactly this run's resources. Names are **deterministic, with a hash suffix** (same formula both backends, from `src/apple.ts` `appleOptions()`): `lfm-<project[:35]>-<sha256(project)[:8]>`. The helper computes it; by hand use prefix filters (`name=^/lfm-<p>-`), never a bare `lfm-<p>` guess:
   - docker: `docker ps -aq --filter name=^/lfm-<p>-` then `docker rm -f` those; `docker volume rm <name>-home <name>-store`.
   - apple-container: `container stop <name>` (if running) → `container delete <name>` → `container volume delete <name>-state`.
3. Delete the run's temp `LAYERFS_MCP_CONFIG_DIR` (so `~/.config/layerfs-mcp/projects/` is never touched anyway).

Isolation: each drive uses a unique project name (`verify-<uuid8>`) plus its own `LAYERFS_MCP_CONFIG_DIR`, so drives run side by side and never touch the user's `default` project. **Never drive `--project default`** — that is the user's real environment.

## Helpers

- `helpers/drive.mjs` (shown above) — executable Node script; run it from the repo root with a bash timeout of at least 600 s (warm docker run) / 900 s (cold builds, apple first run). It resolves the repo root from its own location, so cwd only matters for `npm run build`.
- Probe discipline for anything hand-written: send output to a file (`node probe.mjs > /tmp/probe.log 2>&1`), give it a hard stop, and never pipe the run through `head`. A pipeline reports the exit status of the last stage, so a probe that failed with 1 reads as `exit=0`, and buffered output hides where it stalled. macOS ships no `timeout`; use a background run plus `sleep` and `kill`, or a timer inside the script. Leave probes out of the repo root, and delete them when done.
