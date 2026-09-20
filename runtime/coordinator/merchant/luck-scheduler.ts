import type { MerchantWork } from "./work.ts";
import type { LuckStatus } from "./luck.ts";

interface Status extends LuckStatus {
  seenAt: number;
  level: number;
  ctype?: string;
  rip?: boolean;
  server?: string;
}
interface State {
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean>;
  statuses: Record<string, Status | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface Ports {
  now(): number;
  nextCommand(): number;
  names(): string[];
  strong(status: Status): boolean;
  remaining(status: Status): number;
  lead(status: Status): number;
  persist(): void;
  dispatch(): void;
  log(message: string, level: string, details: unknown): void;
}
export function createLuckScheduler(state: State, ports: Ports) {
  function eligible(merchant: Status): Status[] {
    return ports
      .names()
      .map((name) => state.statuses[name])
      .filter(
        (status): status is Status =>
          !!status &&
          (status.name === state.merchantCharacter || status.ctype !== "merchant") &&
          !status.rip &&
          status.server === merchant.server &&
          !ports.strong(status),
      );
  }
  function tie(a: string, b: string): number {
    return a === state.merchantCharacter ? -1 : b === state.merchantCharacter ? 1 : 0;
  }
  function schedule(): false | undefined {
    if (state.merchantAutomations["merchant luck"] === false) return false;
    const merchant = state.statuses[String(state.merchantCharacter)];
    if (!merchant || merchant.seenAt < ports.now() - 10000 || merchant.level < 40) return undefined;
    if (
      [state.merchantCurrent, ...state.merchantQueue].some(
        (job) => job && ["merchant luck", "merchant luck exchange"].includes(job.reason),
      )
    )
      return undefined;
    const due = eligible(merchant)
      .map((status) => ({ status, remaining: ports.remaining(status), lead: ports.lead(status) }))
      .filter((entry) => entry.remaining <= entry.lead)
      .sort((a, b) => a.remaining - b.remaining || tie(a.status.name, b.status.name));
    const trigger = due.find((entry) => entry.status.name !== state.merchantCharacter) || due[0];
    if (!trigger) return undefined;
    const target = trigger.status.name;
    state.merchantQueue.push({
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target,
      reason: "merchant luck",
      radius: 200,
      expandLuckCluster: true,
      castMerchantLuck: true,
      queuedAt: ports.now(),
    });
    ports.log("Merchant's Luck refresh queued for " + target, "info", {
      target,
      remainingMs: trigger.remaining,
      estimatedTravelMs: trigger.lead - 30000,
      marginMs: 30000,
    });
    ports.persist();
    ports.dispatch();
    return undefined;
  }
  function snapshot() {
    const merchant = state.statuses[String(state.merchantCharacter)];
    if (!merchant || merchant.level < 40) return null;
    const next = eligible(merchant)
      .map((status) => {
        const remainingMs = ports.remaining(status),
          leadMs = ports.lead(status);
        return {
          target: status.name,
          remainingMs,
          leadMs,
          dispatchInMs: Math.max(0, remainingMs - leadMs),
        };
      })
      .sort((a, b) => a.dispatchInMs - b.dispatchInMs || tie(a.target, b.target))[0];
    if (!next) return null;
    const active = state.merchantCurrent?.reason === "merchant luck",
      queued = state.merchantQueue.some((job) => job.reason === "merchant luck");
    return {
      ...next,
      status: active ? "in progress" : queued ? "queued" : "scheduled",
      marginMs: 30000,
    };
  }
  return { schedule, snapshot };
}
