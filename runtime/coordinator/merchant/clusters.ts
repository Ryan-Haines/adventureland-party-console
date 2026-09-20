import type { MerchantWork } from "./work.ts";
export interface ClusterStatus {
  seenAt: number;
  map: string;
  x?: number;
  y?: number;
  server?: string;
  ctype?: string;
  rip?: boolean;
}
export interface ClusterJob extends MerchantWork {
  batchId?: string;
  clusterMembers?: string[];
}
export interface ClusterState {
  merchantCharacter: string | null;
  merchantCurrent: ClusterJob | null;
  merchantQueue: ClusterJob[];
  statuses: Record<string, ClusterStatus | undefined>;
  marked: Record<string, unknown[] | undefined>;
  merchantMarked: Record<string, unknown[] | undefined>;
}
export interface ClusterPorts {
  now(): number;
  nextCommand(): number;
  active(): string[];
  stamp(job: ClusterJob): ClusterJob;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
}

function distance(a: ClusterStatus, b: ClusterStatus): number {
  return Math.hypot(
    (Number(a.x) || 0) - (Number(b.x) || 0),
    (Number(a.y) || 0) - (Number(b.y) || 0),
  );
}

export function createMerchantClusters(state: ClusterState, ports: ClusterPorts) {
  function hasMarks(name: string): boolean {
    return !!(state.marked[name] || []).length || !!(state.merchantMarked[name] || []).length;
  }
  function nearby(
    job: ClusterJob,
    anchor: ClusterStatus,
    radius: number,
    marked: boolean,
  ): string[] {
    return ports.active().filter((name) => {
      if (name === job.target || name === state.merchantCharacter || (marked && !hasMarks(name)))
        return false;
      const status = state.statuses[name];
      return !!status && status.map === anchor.map && distance(status, anchor) <= radius;
    });
  }
  function queued(target: string, reason: string): ClusterJob {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target,
      reason,
      queuedAt: ports.now(),
    };
  }
  function leader(job: ClusterJob, anchor: ClusterStatus, radius: number): string[] {
    const names = nearby(job, anchor, radius, false).sort(
      (a, b) => distance(state.statuses[a]!, anchor) - distance(state.statuses[b]!, anchor),
    );
    const existing = new Set(
      [state.merchantCurrent, ...state.merchantQueue]
        .filter((entry) => !!entry)
        .map((entry) => entry.target + "\n" + entry.reason),
    );
    state.merchantQueue.unshift(
      ...names
        .filter((name) => !existing.has(name + "\nparty collection"))
        .map((name) => queued(name, "party collection")),
    );
    job.clusterExpanded = true;
    job.clusterMembers = names;
    ports.log("Leader cluster resolved on arrival", "info", {
      leader: job.target,
      radius,
      nearby: names,
    });
    ports.persist();
    return names;
  }
  function marked(job: ClusterJob, anchor: ClusterStatus): string[] {
    const names = nearby(job, anchor, 200, true),
      batchId = job.batchId || (job.batchId = "marked-" + job.id);
    job.clusterExpanded = true;
    job.clusterMembers = names;
    const members = new Set<string | null>(names);
    state.merchantQueue = state.merchantQueue.filter(
      (entry) => !(entry.reason === "marked items" && members.has(entry.target)),
    );
    state.merchantQueue.unshift(
      ...names.map((name) =>
        ports.stamp({ ...queued(name, "marked items"), batchId, clusterExpanded: true }),
      ),
    );
    ports.log("Marked-item collection cluster resolved on arrival", "info", {
      anchor: job.target,
      nearby: names,
    });
    ports.persist();
    return names;
  }
  function luckRecipients(job: ClusterJob, center: ClusterStatus, radius: number): string[] {
    return ports
      .active()
      .filter((name) => {
        const status = state.statuses[name];
        return (
          !!status &&
          status.ctype !== "merchant" &&
          !status.rip &&
          status.server === center.server &&
          status.map === center.map &&
          distance(status, center) <= radius
        );
      })
      .sort((a, b) => (a === job.target ? -1 : b === job.target ? 1 : 0));
  }
  function luck(job: ClusterJob, center: ClusterStatus, radius: number): string[] {
    const recipients = luckRecipients(job, center, radius);
    job.batchId ||= job.id;
    const existing = new Set(
      [state.merchantCurrent, ...state.merchantQueue]
        .filter(
          (entry) => entry && ["merchant luck", "merchant luck exchange"].includes(entry.reason),
        )
        .map((entry) => entry!.target),
    );
    const additions = recipients
      .filter((name) => name !== job.target && !existing.has(name))
      .map((name) => ({
        ...queued(name, "merchant luck"),
        batchId: job.batchId,
        expandLuckCluster: false,
        castMerchantLuck: true,
        radius,
      }));
    state.merchantQueue.unshift(...additions.map((entry) => ports.stamp(entry)));
    job.clusterExpanded = true;
    job.clusterMembers = recipients;
    ports.log("Merchant's Luck party itinerary resolved on arrival", "info", {
      center: job.target,
      radius,
      recipients,
    });
    ports.persist();
    return recipients;
  }
  return { leader, marked, luck };
}
