import { appendFileSync, existsSync, readFileSync } from "node:fs";

export function replayCanned(scriptPath, logPath, label) {
  const script = JSON.parse(readFileSync(scriptPath, "utf8"));
  const calls = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n").filter(Boolean) : [];
  appendFileSync(logPath, JSON.stringify({ bin: label, args: process.argv.slice(2) }) + "\n");
  const step = script[calls.length];
  if (!step) {
    process.stderr.write(`golden: ${label} call ${calls.length} has no canned step\n`);
    process.exit(97);
  }
  process.stdout.write(step.stdout ?? "");
  process.stderr.write(step.stderr ?? "");
  process.exitCode = step.code ?? 0;
}
