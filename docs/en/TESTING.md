# Testing and verification

[中文](../TESTING.md) · **English** · [Docs index](README.md)

## Test entry points

| Command | Coverage | External dependency |
| --- | --- | --- |
| `npm test` | Protocol, tool schemas, argument conversion, pagination and error preservation, policy limits, stdio and HTTP | None (HTTP tests need local port binding) |
| `npm run check` | `tsc --noEmit` | None |
| `npm run verify:upstream` | Compares against the pinned upstream's actual exported methods | LayerFS checkout at the pinned commit |
| `npm run test:docker` | Real native addon, store and FUSE; calls all 40 upstream methods | Docker + `/dev/fuse` |
| `npm run test:apple` | Mac CLI -> Apple VM -> official MCP client; all 40 methods | Apple Container |
| `npm run test:managed` | Unified CLI: cold start, concurrent clients, all methods, settings reuse, restart | The chosen backend |
| `npm run golden` | Upstream result replay | None |

```sh
npm ci
npm run check
npm test
LAYERFS_SDK_PATH=/absolute/path/layerfs npm run verify:upstream

# after building the image, drive all 40 upstream methods on a throwaway volume
npm run test:docker

# macOS, after building the apple-runtime image
npm run test:apple

# unified CLI: no setup, checks concurrent access, all methods and restart
npm run test:managed
LAYERFS_TEST_BACKEND=docker npm run test:managed
```

Isolation rules:

- `test:docker` uses a real native addon, store and FUSE, then removes the containers and volumes it created. It never touches a deployment's real store.
- `test:apple` creates a temporary project VM and only cleans up VMs and volumes it created and that pass the ownership check.
- `test:managed` uses a random temporary project and deletes the runtime and volumes afterwards.
- `npm run test:real` is the low-level entry for an explicitly configured native environment; it only writes data when `LAYERFS_REAL_TESTS=1`.

CI lives in [.github/workflows/ci.yml](../../.github/workflows/ci.yml): every push and PR runs `check`, `npm test` and `npm pack --dry-run`; the native and Docker checks against a real store run only on manual `workflow_dispatch`.

## Reusing an upstream checkout when building the image

If a pinned upstream checkout already exists, avoid downloading it again:

```sh
docker build --build-context layerfs=/absolute/path/layerfs -t layerfs-mcp:local .
```

The checkout must be the pinned commit; after an upgrade, run the contract check and the real tests first.

## Local verification record

Verified 2026-10-22 on macOS 27.0.1 arm64, against both Docker Desktop and Apple Container 1.6.0. Upstream is pinned to `5fb68ddc1acc3163e3ac3486133bde014c5fbed3` (including the Podman compatibility patch recorded in the lock file); the MCP SDK is `1.32.1`.

| Check | Result |
| --- | --- |
| TypeScript compilation | Passed |
| `npm test` | 19/19 passed (snapshot from that day; the repository now runs 27, HTTP tests need local port binding) |
| Comparison with the actual upstream export set | Exactly 27 public + 13 operator methods |
| Linux addon / daemon release build | Rust 1.85.1 build succeeded |
| Native compatibility patch checks | `layerfs-sandbox` 28 external tests, rustfmt and Clippy `-D warnings` passed |
| `npm run test:docker` | All 40 methods called for real, workspaces not skipped |
| Standalone Apple build | `container build --target apple-runtime` succeeded without a Docker socket |
| Mac CLI -> Apple VM -> MCP | Official MCP client discovered 41 tools and called all 40 methods |
| Apple multi-client | A second independent stdio client read committed command output from the same store |
| Apple execution identity | UID 501, zero effective capabilities, user namespace creation refused |
| Apple default boot and restart | Pinned-digest sandbox image pull, explicit seed import, CLI auto-start after VM stop and reading the original store |
| FUSE and command execution | Mount, exec, status, commit, unmount passed |
| Background processes | Start, list, cancel passed |
| Branches and storage | Import, atomic batch edits, history, diffs, merge, publish, conflicts, diagnostics passed |
| HTTP protocol | Official MCP client, concurrent clients, bearer, Host/Origin, invalid JSON passed |
| Compose HTTP example | Initialized the bundled seed, discovered 41 tools, no configuration gaps |
| Compose stdio example | A separate process discovered 41 tools and read the project initialized by the HTTP service |
| Unified CLI: Docker | No manual setup; all 40 methods, concurrent clients, settings reuse, access after stop |
| npm tarball -> npx -> Apple | The package built the runtime from its bundled sources; all 40 methods, concurrent clients and restart |
| npm tarball -> bunx -> Docker | Automatically built the default runtime image; all 40 methods, concurrent clients and restart |
| Managed Apple / Docker HTTP | Host-side unified CLI served HTTP; the official MCP client authenticated with bearer and read the same project |
| CLI temporary directory regression | Per-process directories, permissions, exit cleanup and argument parsing; PID reuse after a Docker restart does not collide on overlay directories |
| Release version check | Published versions skipped, new stable versions allowed, rollbacks and prereleases refused, missing package and registry errors distinguished; no remote publish executed |
| Backend name compatibility | `apple-container` reused the existing `apple` settings and running example project |
| npm packaging and local command | Image build sources and shrinkwrap included; locally `npm link`ed; not published |
| Compose Linux override parsing | Passed; the actual run used Docker Desktop networking |

Environment notes:

- The local example service runs under `docker compose` at `http://127.0.0.1:8787/mcp` as project `default`, with credentials in an untracked `.env`. Only `examples/seed` was imported, no user data. Stop it with `docker compose stop` and resume with `docker compose up -d --no-build`. Do not delete the volumes unless you really mean to clear the example data.
- A separate Apple example project `default` uses VM `lfm-default-37a8eec1` and only the same seed; its data is not shared with the Docker example. It is registered with the unified CLI as `layerfs-mcp serve --project default`; `layerfs-mcp stop --project default` stops the VM and keeps the ext4 volume. The legacy `apple ...` subcommands still work, and `node examples/apple-client.mjs` checks the path. Inside the VM: Podman 4.3.1, crun 1.8.1, Linux 6.18.35; the Mac needs no Docker Engine.
- Unified CLI tests use random temporary projects and delete their runtime and volumes afterwards, covering the native store, FUSE, branch merges, publishing, logs and background processes.

## Verification boundaries

This verifies interoperability with the official MCP client against the pinned upstream API. It does **not** test every third-party agent product, and the standalone native Linux host and Windows client were not run in that environment. The GitHub Actions workflow exists, but local verification does not mean remote CI has run. Architecture and compatibility limits are in [Apple Container backend](APPLE-CONTAINER.md).
