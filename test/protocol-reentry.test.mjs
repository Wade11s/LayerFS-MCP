import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { appleOptions } from "../dist/apple.js";
import { helperArguments } from "../dist/runtime.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const BOOLEAN = new Set(["help", "read-only", "no-operator", "disable-exec"]);
const ACCEPTED = {
  apple: ["help", "project", "name", "image", "source", "cpus", "memory", "sandbox-archive", "sandbox-image", "read-only", "no-operator", "disable-exec"],
  docker: ["project", "name", "image", "source", "sandbox-image"],
};
const sample = { project: "alpha", name: "alpha-runtime", image: "example/runtime:local", source: "/tmp/source", cpus: "2", memory: "2G", "sandbox-archive": "/tmp/archive", "sandbox-image": "example/sandbox:local" };
const reentry = (backend, args) => parseArgs({ args, allowPositionals: true,
  options: Object.fromEntries(ACCEPTED[backend].map(name => [name, { type: BOOLEAN.has(name) ? "boolean" : "string" }])) });
const emitted = args => args.slice(3).filter(argument => argument.startsWith("--")).map(argument => argument.slice(2));

test("apple setup argv replays every profile field without a second flag list", () => {
  const profile = { version: 1, backend: "apple", project: "alpha", name: "lfm-alpha-0e34b6c6",
    image: "docker.io/library/layerfs-mcp-apple:local", source: "/tmp/source", cpus: "4", memory: "8G",
    archive: "/tmp/archive", sandboxImage: "example/sandbox:local" };
  const args = helperArguments(profile, "setup");
  assert.deepEqual(args, [cli, "apple", "setup", "--project", "alpha", "--name", "lfm-alpha-0e34b6c6",
    "--image", profile.image, "--source", "/tmp/source", "--sandbox-image", "example/sandbox:local",
    "--cpus", "4", "--memory", "8G", "--sandbox-archive", "/tmp/archive"]);
  for (const flag of emitted(args)) assert(ACCEPTED.apple.includes(flag), `apple CLI does not accept --${flag}`);
  const { positionals, values } = reentry("apple", [args[2], ...args.slice(3)]);
  assert.deepEqual(positionals, ["setup"]);
  assert.deepEqual(appleOptions(values), { project: "alpha", name: "lfm-alpha-0e34b6c6", image: profile.image,
    cpus: "4", memory: "8G", source: "/tmp/source", archive: "/tmp/archive", sandboxImage: "example/sandbox:local" });
});

test("docker setup argv carries identity and source but never VM-only flags", () => {
  const profile = { version: 1, backend: "docker", project: "beta", name: "beta-runtime",
    image: "example/runtime:local", source: "/tmp/source", cpus: "2", memory: "2G" };
  const args = helperArguments(profile, "setup");
  assert.deepEqual(args, [cli, "docker", "setup", "--project", "beta", "--name", "beta-runtime",
    "--image", "example/runtime:local", "--source", "/tmp/source"]);
  for (const flag of ["--cpus", "--memory", "--sandbox-archive"]) assert.equal(args.includes(flag), false, `docker setup must not emit ${flag}`);
  for (const flag of emitted(args)) assert(ACCEPTED.docker.includes(flag), `docker CLI does not accept --${flag}`);
  const { positionals, values } = reentry("docker", [args[2], ...args.slice(3)]);
  assert.deepEqual(positionals, ["setup"]);
  const replayed = appleOptions(values);
  assert.equal(replayed.project, "beta");
  assert.equal(replayed.name, "beta-runtime");
  assert.equal(replayed.image, "example/runtime:local");
  assert.equal(replayed.source, "/tmp/source");
  assert.equal(replayed.cpus, "2");
  assert.equal(replayed.memory, "2G");
});

test("serve argv is the same identity prefix for both backends and carries no creation flags", () => {
  for (const backend of ["apple", "docker"]) {
    const profile = { version: 1, backend, project: "gamma", name: "gamma-runtime", image: "example/runtime:local",
      source: "/tmp/source", cpus: "4", memory: "8G", archive: "/tmp/archive", sandboxImage: "example/sandbox:local" };
    const args = helperArguments(profile, "serve");
    assert.deepEqual(args, [cli, backend, "serve", "--project", "gamma", "--name", "gamma-runtime", "--image", "example/runtime:local"]);
    for (const flag of emitted(args)) assert(ACCEPTED[backend].includes(flag), `${backend} CLI does not accept --${flag}`);
    const { values } = reentry(backend, [args[2], ...args.slice(3)]);
    assert.deepEqual([values.project, values.name, values.image], ["gamma", "gamma-runtime", "example/runtime:local"]);
    assert.deepEqual([values.source, values.cpus, values.memory, values["sandbox-image"], values["sandbox-archive"]],
      [undefined, undefined, undefined, undefined, undefined]);
  }
});

test("both legacy CLIs accept every flag the reentry protocol can emit", async t => {
  const directory = await mkdtemp(join(tmpdir(), "layerfs-reentry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const backend of ["apple", "docker"]) {
    const tail = ACCEPTED[backend].filter(name => name !== "help").flatMap(name => BOOLEAN.has(name) ? [`--${name}`] : [`--${name}`, sample[name]]);
    const result = spawnSync(process.execPath, [cli, backend, "status", ...tail], { encoding: "utf8",
      env: { ...process.env, LAYERFS_MCP_CONFIG_DIR: directory,
        LAYERFS_CONTAINER_BIN: join(directory, "absent-container"), LAYERFS_DOCKER_BIN: join(directory, "absent-docker") } });
    assert.doesNotMatch(result.stderr, /Unknown option|ERR_PARSE_ARGS/);
    const unknown = spawnSync(process.execPath, [cli, backend, "status", "--not-a-reentry-flag", "x"], { encoding: "utf8",
      env: { ...process.env, LAYERFS_MCP_CONFIG_DIR: directory } });
    assert.match(unknown.stderr, /Unknown option/);
  }
  assert.throws(() => reentry("docker", ["setup", "--cpus", "2"]), /Unknown option/);
  assert.throws(() => reentry("docker", ["setup", "--memory", "2G"]), /Unknown option/);
});
