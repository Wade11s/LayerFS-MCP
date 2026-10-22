import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isolatedEntry } from "../dist/process.js";

test("isolated entries preserve CLI parsing, use unique private temp roots and clean up", async () => {
  const directory = await mkdtemp(join(tmpdir(), "layerfs-entry-test-"));
  const script = join(directory, "entry.mjs");
  try {
    await writeFile(script, `import { parseArgs } from 'node:util';
import { tmpdir } from 'node:os';
import { statSync } from 'node:fs';
const args=parseArgs({allowPositionals:true,options:{transport:{type:'string'}}});
console.log(JSON.stringify({args,temp:tmpdir(),mode:statSync(tmpdir()).mode & 0o777}));`);
    const runs = await Promise.all([1, 2].map(() => promisify(execFile)(process.execPath, ["-e", isolatedEntry(script, ["serve", "--transport", "stdio"])])));
    const records = runs.map(run => JSON.parse(run.stdout));
    assert.notEqual(records[0].temp, records[1].temp);
    for (const record of records) {
      assert.deepEqual(record.args, { values: { transport: "stdio" }, positionals: ["serve"] });
      assert.equal(record.mode, 0o700);
      await assert.rejects(access(record.temp), { code: "ENOENT" });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
