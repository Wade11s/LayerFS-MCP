import assert from "node:assert/strict";

export async function exerciseLayerFS(client, { source, project, workspaces = true }) {
  const covered = new Set();
  const call = async (name, args = {}) => {
    const value = await client.callTool({ name: `layerfs_${name}`, arguments: args }, undefined, { timeout: 120_000 });
    assert(!value.isError, `${name}: ${JSON.stringify(value)}`);
    covered.add(name);
    return value.structuredContent.result;
  };
  await call("project_init", { sourcePath: source });
  await call("branch_fork", { name: "alpha" });
  await call("branch_fork", { name: "beta" });
  await call("fs_write", { branch: "alpha", path: "/a.txt", content: "alpha\n" });
  await call("fs_edit", { branch: "alpha", path: "/a.txt", oldText: "alpha", newText: "alpha-edited" });
  await call("fs_mkdir", { branch: "alpha", path: "/scratch" });
  await call("fs_cp", { branch: "alpha", from: "/a.txt", to: "/scratch/copied" });
  await call("fs_mv", { branch: "alpha", from: "/scratch/copied", to: "/scratch/moved" });
  await call("fs_rm", { branch: "alpha", path: "/scratch/moved" });
  await call("fs_apply", { branch: "beta", changes: [{ op: "mkdir", path: "/data" }, { op: "write", path: "/data/b.txt", content: "beta\n" }, { op: "write", path: "/data/raw", content: "AP8=", encoding: "base64" }] });
  assert.match(JSON.stringify(await call("fs_read", { ref: "alpha", path: "/a.txt" })), /alpha/);
  await call("project_list_branches");
  await call("fs_list", { ref: "alpha", path: "/" });
  await call("fs_stat", { ref: "alpha", path: "/a.txt" });
  await call("fs_grep", { ref: "alpha", pattern: "alpha", path: "/" });
  await call("fs_glob", { ref: "alpha", pattern: "*.txt", path: "/" });
  await call("fs_blame", { ref: "alpha", path: "/a.txt" });
  await call("fs_diff_files", { leftRef: "alpha", leftPath: "/a.txt", rightRef: "beta", rightPath: "/data/b.txt" });
  const history = await call("branch_list_commits", { branch: "alpha" });
  assert(history.items.length > 1);
  // Commit records expose `id` in the pinned SDK.
  const commit = history.items[0].id;
  const previous = history.items[1].id;
  assert.equal(typeof commit, "string", JSON.stringify(history));
  await call("branch_diff_commits", { from: previous, to: commit, hunks: false });
  await call("branch_diff_branches", { from: "alpha", to: "beta", hunks: false });
  await call("branch_merge", { a: "alpha", b: "beta", name: "merged" });
  const published = await call("branch_publish", { branch: "merged" });
  assert.match(JSON.stringify(await call("fs_read", { ref: "main", path: "/data/b.txt" })), /beta/);
  await call("operator_store_stats");
  await call("operator_store_commits", { branch: "merged" });
  assert.equal(typeof published.publishedLayer?.id, "string", JSON.stringify(published));
  await call("operator_store_overwritten", { layer: published.publishedLayer.id });
  await call("operator_files_stats", { ref: "main", path: "/a.txt" });
  await call("operator_files_history", { ref: "main", path: "/a.txt" });
  assert.equal(await call("operator_project_progress"), null);
  await call("operator_inspect_snapshot");
  await call("operator_sandbox_list");
  await call("operator_process_list");
  await call("branch_fork", { name: "conflict-a" });
  await call("branch_fork", { name: "conflict-b" });
  await call("fs_write", { branch: "conflict-a", path: "/README.md", content: "a\n" });
  await call("fs_write", { branch: "conflict-b", path: "/README.md", content: "b\n" });
  const conflict = await client.callTool({ name: "layerfs_branch_merge", arguments: { a: "conflict-a", b: "conflict-b", name: "conflicted" } });
  assert.equal(conflict.isError, true);
  assert.equal(conflict.structuredContent.error.code, "Conflict");
  if (workspaces) {
    const ws = await call("workspace_mount", { branch: "merged" });
    try {
      const exec = await call("workspace_exec", { ws, command: "printf 'from-command\\n' > command.txt && cat command.txt" });
      assert.equal(exec.exitCode, 0);
      assert.match(exec.stdout, /from-command/);
      const identity = await call("workspace_exec", { ws, command: "id -u; grep '^CapEff:' /proc/self/status; if unshare -Ur true >/dev/null 2>&1; then exit 90; fi" });
      assert.equal(identity.exitCode, 0, "A command must not be able to create a user namespace");
      assert.match(identity.stdout, /^501\n/);
      assert.match(identity.stdout, /CapEff:\s+0+\n/);
      await call("workspace_status", { ws: { sandbox: ws.sandbox, path: ws.path } });
      await call("operator_workspace_overlay", { ws: { sandbox: ws.sandbox, path: ws.path } });
      await call("operator_workspace_changes", { ws: { sandbox: ws.sandbox, path: ws.path } });
      const process = await call("operator_process_start", { ws: { sandbox: ws.sandbox, path: ws.path }, command: "sleep 120" });
      assert.equal(typeof process.process, "string", JSON.stringify(process));
      await call("operator_process_list");
      await call("operator_process_cancel", { process: process.process });
      await call("workspace_commit", { ws: { sandbox: ws.sandbox, path: ws.path }, message: "checkpoint command" });
    } finally { await call("workspace_unmount", { ws: { sandbox: ws.sandbox, path: ws.path }, discard: true }); }
  }
  if (workspaces) assert.equal(covered.size, 40, [...covered].join(", "));
  console.log(`Real LayerFS verified, ${covered.size} methods, project=${project}, workspaces=${workspaces}`);
}
