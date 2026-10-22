import type { HostBackend } from "./runtime.js";

export interface HostEngine {
  readonly bin: string;
  ensure(signal: AbortSignal): Promise<void>;
  imageBuildArgs(image: string): readonly string[];
}

export interface RuntimeDriver {
  readonly backend: HostBackend;
  engine(): HostEngine;
}

interface HostModule {
  driver: RuntimeDriver;
  legacyCli: (args: string[]) => Promise<void>;
}

const hostModules = {
  apple: async (): Promise<HostModule> => {
    const mod = await import("./apple.js");
    return { driver: mod.appleDriver, legacyCli: mod.appleCli };
  },
  docker: async (): Promise<HostModule> => {
    const mod = await import("./docker.js");
    return { driver: mod.dockerDriver, legacyCli: mod.dockerCli };
  },
} satisfies Record<HostBackend, () => Promise<HostModule>>;

export function isHostCommand(command: string | undefined): command is HostBackend {
  return command !== undefined && Object.prototype.hasOwnProperty.call(hostModules, command);
}

export async function runLegacyCommand(command: HostBackend, args: string[]): Promise<void> {
  const loaded = await hostModules[command]();
  await loaded.legacyCli(args);
}

export async function loadDriver(backend: HostBackend): Promise<RuntimeDriver> {
  return (await hostModules[backend]()).driver;
}
