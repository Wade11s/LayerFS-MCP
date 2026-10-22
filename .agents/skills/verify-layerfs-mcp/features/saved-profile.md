# Saved profile: update and drift refusal

## Sub-features

- `layerfs-mcp update --project <p> [--image|--source|--cpus|--memory|--sandbox-image|--sandbox-archive]` rewrites the saved profile inside the `profile:<project>` lock and touches no runtime. Three stdout shapes, all exit 0: `{"project","state":"not-configured"}` when nothing is saved, `{"state":"unchanged"}` when no field differs, `{"state":"updated","changed":[...]}` with the changed field names sorted alphabetically.
- `update` refuses a backend change with `Project <p> already uses <b>; use a different project name for <b2>. Stores are not migrated automatically.` and refuses a rename with `Project <p> is already configured with a different name; use a new project or explicitly manage its existing runtime configuration.` Both exit 1.
- `--sandbox-archive` stays creation-gated for docker (`--sandbox-archive, --cpus and --memory currently apply to Apple VMs only`); `cpus` and `memory` are writable because they are stored fields that never reach a docker run.
- **Creation stickiness.** Once a profile exists, `name`, `image`, `source`, `cpus`, `memory`, `archive`, and `sandboxImage` are frozen for `serve`/`setup`: a different value raises `Project <p> is already configured with a different <key>; …` instead of rewriting. `update` is the explicit path for the writable subset; the runtime then refuses at the backend if the live VM/container disagrees.
- **Backend drift refusal at setup.** Docker compares image and source only (a Docker Desktop `/host_mnt…` source rewrite is not drift). Apple additionally compares archive, sandbox image, cpu count, and memory bytes, and never swaps a Store silently. Containers, VMs, and volumes without this project's ownership labels are refused, never adopted.
- Host command output shapes: `status`/`doctor` print `{project,state:"not-configured"}` with no saved profile; otherwise they print the backend's status JSON (`{backend,project,name,state,diagnostics?}` plus `runtime:"apple-container"` on Apple, with `diagnostics` only while running). `stop` discards the helper's stdout and prints `{"project","backend","state":"stopped","volumesRetained":true}`. `setup` prints its readiness JSON; `init` prints the `project.init` result.

## How to get to it (user POV)

An operator who wants a different runtime image no longer edits `~/.config/layerfs-mcp/projects/<p>.json` by hand: they run `update`. If they instead change the flag on the next `serve`, they get a refusal that names the field, not a silent second environment.

## Driving it with MCP SDK / CLI

```sh
export LAYERFS_MCP_CONFIG_DIR=$(mktemp -d)
node dist/cli.js setup --project p --backend docker --image layerfs-mcp:0.1.0
node dist/cli.js update --project p --image example/x:1     # {"state":"updated","changed":["image"]}
node dist/cli.js update --project p --image example/x:1     # {"state":"unchanged"}
node dist/cli.js update --project other                     # {"state":"not-configured"}
node dist/cli.js update --project p --name renamed          # exit 1, name rejection
node dist/cli.js serve --project p --image example/y:2      # exit 1, different image refusal
```

## Gotchas

- `update` deliberately does not restart or recreate anything. A stale container keeps running until the next `setup`/`serve` refuses on drift.
- The `changed` list exposes profile keys (`archive`, `sandboxImage`), not flag spellings.
- An interrupted write can leave `<p>.json.<uuid>.tmp` behind; the profile itself stays either old or new, never half-written.
- `not-configured` short-circuits flag validation, so a bad flag on an unconfigured project is not reported.
