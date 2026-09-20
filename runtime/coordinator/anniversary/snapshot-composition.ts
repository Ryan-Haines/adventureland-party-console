import { createAnniversarySnapshot } from "./snapshot.ts";
import type { AnniversaryState, AnniversarySnapshotPorts } from "./contracts.ts";

interface CoordinatorState {
  anniversary: AnniversaryState;
  statuses: ReturnType<AnniversarySnapshotPorts["statuses"]>;
  leader: string | null;
  merchantCharacter: string | null;
  followers: Record<string, unknown>;
}
type CompositionPorts = Pick<
  AnniversarySnapshotPorts,
  "now" | "counts" | "log" | "persist"
> & {
  enabled: (name: string, event: string) => boolean;
  owned: (name: string) => unknown;
};

/** Build anniversary projections from current roster/status state and the existing anniversary record. */
export function createCoordinatorAnniversarySnapshot(
  state: CoordinatorState,
  workers: Record<string, { realm?: string }>,
  ports: CompositionPorts,
) {
  return createAnniversarySnapshot(state.anniversary, {
    now: () => ports.now(),
    counts: () => ports.counts(),
    statuses: () => state.statuses,
    leader: () => state.leader,
    merchant: () => state.merchantCharacter,
    follower: (name) => !!state.followers[name],
    enabled: (name) => ports.enabled(name, "anniversary"),
    owned: (name) => !!ports.owned(name),
    realm: (name) => workers[name] && workers[name].realm,
    log: (message, level) => ports.log(message, level),
    persist: () => ports.persist(),
  });
}
