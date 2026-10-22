import type { HostBackend, RuntimeProfile } from "./runtime.js";
import type { RuntimeInput } from "./selection.js";

export const APPLE_FLAG = { cpus: "--cpus", memory: "--memory", archive: "--sandbox-archive" } as const;

function assertNever(value: never): never {
  throw new Error(`Unsupported backend: ${String(value)}`);
}

export function assertHostForProfile(backend: HostBackend): void {
  switch (backend) {
    case "apple":
      if (process.platform !== "darwin") throw new Error("Apple Container requires a macOS host");
      return;
    case "docker":
      return;
    default:
      return assertNever(backend);
  }
}

export function assertCreationFlags(backend: HostBackend, raw: RuntimeInput, parsed: RuntimeProfile): void {
  switch (backend) {
    case "docker":
      if (parsed.archive || raw.cpus || raw.memory) {
        throw new Error("--sandbox-archive, --cpus and --memory currently apply to Apple VMs only");
      }
      return;
    case "apple":
      return;
    default:
      return assertNever(backend);
  }
}

export function setupReentryFlags(profile: RuntimeProfile): readonly string[] {
  switch (profile.backend) {
    case "apple": {
      const flags = [APPLE_FLAG.cpus, profile.cpus, APPLE_FLAG.memory, profile.memory];
      if (profile.archive) flags.push(APPLE_FLAG.archive, profile.archive);
      return flags;
    }
    case "docker":
      return [];
    default:
      return assertNever(profile.backend);
  }
}
