import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

export async function capture(bin: string, args: string[], signal?: AbortSignal): Promise<string> {
  return (await exec(bin, args, { signal, maxBuffer: 16 * 1024 * 1024 })).stdout;
}

/** External commands never write into the MCP stdout channel. */
export async function run(bin: string, args: string[], signal?: AbortSignal): Promise<void> {
  const child = spawn(bin, args, { stdio: ["ignore", 2, 2], signal });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, stopped) => code === 0 ? resolve() : reject(new Error(`${bin} ${args[0]} failed (${stopped || code})`)));
  });
}
