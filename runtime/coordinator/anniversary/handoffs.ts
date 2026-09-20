import {
  anniversarySlices,
  sliceQuantity,
  type AnniversarySnapshotPorts,
  type AnniversaryState,
  type AnniversaryStatus,
} from "./contracts.ts";

function target(name: string, round: string, slice: string, status: AnniversaryStatus) {
  return {
    name,
    round,
    slice,
    map: status.map,
    x: status.x,
    y: status.y,
    server: status.server,
    event: status.joinedEvent || null,
    seenAt: status.seenAt,
    ctype: status.ctype,
  };
}

function eligibleStatus(name: string, ports: AnniversarySnapshotPorts) {
  const status = ports.statuses()[name];
  if (name === ports.merchant() || !ports.owned(name) || !ports.enabled(name)) return;
  if (!status || status.ctype === "merchant" || status.rip || status.seenAt < ports.now() - 10_000) return;
  return status;
}

export function anniversaryHandoffs(state: AnniversaryState, ports: AnniversarySnapshotPorts) {
  const targets: ReturnType<typeof target>[] = [];
  for (const [round, entry] of Object.entries(state.rounds)) {
    for (const [name, claim] of Object.entries(entry?.claims || {})) {
      if (!claim?.slice || claim.handedOff) continue;
      const status = eligibleStatus(name, ports);
      if (status && sliceQuantity(status.items, claim.slice) > 0) targets.push(target(name, round, claim.slice, status));
    }
  }
  recoverUnreported(targets, state, ports);
  return targets;
}

function alreadyHandedOff(state: AnniversaryState, name: string, slice: string): boolean {
  return Object.values(state.rounds).some((round) => {
    const claim = round?.claims?.[name];
    return claim?.slice === slice && claim.handedOff;
  });
}

/** Inventory is authoritative when a kiss callback was missed during coordinator reload. */
function recoverUnreported(
  targets: ReturnType<typeof target>[],
  state: AnniversaryState,
  ports: AnniversarySnapshotPorts,
): void {
  for (const name of Object.keys(ports.statuses())) {
    const status = eligibleStatus(name, ports);
    if (!status) continue;
    for (const slice of anniversarySlices) {
      if (
        sliceQuantity(status.items, slice) < 1 ||
        targets.some((entry) => entry.name === name && entry.slice === slice) ||
        alreadyHandedOff(state, name, slice)
      )
        continue;
      targets.push(target(name, "recovered", slice, status));
    }
  }
}
