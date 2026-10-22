export const LABEL = {
  owner: "io.layerfs-mcp.owner",
  project: "io.layerfs-mcp.project",
  upstream: "io.layerfs-mcp.upstream",
} as const;

export interface OwnedRuntime {
  readonly name: string | undefined;
  readonly labels: { readonly owner?: string; readonly project?: string; readonly upstream?: string };
  readonly destinations: readonly (string | undefined)[];
  readonly volumes: readonly { readonly destination: string; readonly name: string }[];
}

export interface OwnershipPolicy {
  readonly expectedName: string;
  readonly expectedProject: string;
  readonly owner: string;
  readonly upstream: string;
  readonly requiredVolumes: readonly { readonly destination: string; readonly name: string }[];
  readonly allowedDestinations: readonly string[];
  readonly messages: {
    readonly notOwned: string;
    readonly wrongVolume: string;
    readonly unexpectedMount: string;
  };
}

export type VolumeLabels = { readonly owner?: string; readonly project?: string };

export type AdoptDecision =
  | { readonly kind: "create" }
  | { readonly kind: "keep" }
  | { readonly kind: "refuse"; readonly message: string };

export function assertOwned(record: OwnedRuntime, policy: OwnershipPolicy): void {
  const labels = record.labels;
  if (record.name !== policy.expectedName
    || labels.owner !== policy.owner
    || labels.project !== policy.expectedProject
    || labels.upstream !== policy.upstream) {
    throw new Error(policy.messages.notOwned);
  }
  const missing = policy.requiredVolumes.some(required =>
    !record.volumes.some(volume => volume.destination === required.destination && volume.name === required.name));
  if (missing) throw new Error(policy.messages.wrongVolume);
  if (record.destinations.some(destination => destination === undefined || !policy.allowedDestinations.includes(destination))) {
    throw new Error(policy.messages.unexpectedMount);
  }
}

export function decideAdopt(
  existing: VolumeLabels | undefined,
  expect: { owner: string; project: string },
  refuseMessage: string,
): AdoptDecision {
  if (!existing) return { kind: "create" };
  if (existing.owner === expect.owner && existing.project === expect.project) return { kind: "keep" };
  return { kind: "refuse", message: refuseMessage };
}

export async function findOwned<T>(steps: {
  listed: () => Promise<boolean>;
  inspect: () => Promise<T>;
  read: (raw: T) => OwnedRuntime;
  policy: OwnershipPolicy;
}): Promise<T | undefined> {
  if (!await steps.listed()) return undefined;
  const raw = await steps.inspect();
  assertOwned(steps.read(raw), steps.policy);
  return raw;
}
