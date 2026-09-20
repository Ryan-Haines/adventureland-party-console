import type { MarketListing } from "../merchant/work.ts";
import { requestObject, requestText } from "../http/contracts.ts";

interface PontyEntry extends MarketListing {
  seenAt?: number;
}
interface PontyState {
  listings: PontyEntry[];
  updatedAt?: number;
  error?: string | null;
}
interface PontyPorts {
  now(): number;
  catalog(): { allItems: unknown } | null;
  request(): Promise<unknown>;
  normalize(records: unknown, items: unknown): PontyEntry[];
  realmExists(realm: string): boolean;
  queueMatches(): void;
}

/** A fresh local report supersedes the remote snapshot for its entire realm, including an empty stand. */
export function createPontyMarket(state: PontyState, ports: PontyPorts) {
  let remote: PontyEntry[] = [],
    local: PontyEntry[] = [],
    busy = false;
  let localReport: { realm: string; seenAt: number } | null = null;
  const dismissed = new Map<string | undefined, number>();

  function rebuild(): void {
    const freshLocal = local.filter((entry) => ports.now() - Number(entry.seenAt) < 30000);
    const realms = new Set(
      freshLocal.map((entry) => entry.serverRegion + ":" + entry.serverIdentifier),
    );
    if (localReport && ports.now() - localReport.seenAt < 30000) realms.add(localReport.realm);
    for (const [key, until] of dismissed) if (until <= ports.now()) dismissed.delete(key);
    state.listings = freshLocal
      .concat(
        remote.filter((entry) => !realms.has(entry.serverRegion + ":" + entry.serverIdentifier)),
      )
      .filter((entry) => !dismissed.has(entry.key));
    state.updatedAt = ports.now();
  }

  function observe(observation: {
    report?: { realm: string; seenAt: number };
    listings: PontyEntry[];
  }): void {
    if (observation.report) localReport = observation.report;
    local = observation.listings;
    rebuild();
    ports.queueMatches();
  }

  function dismiss(key: string | undefined): void {
    remote = remote.filter((entry) => entry.key !== key);
    dismissed.set(key, ports.now() + 120000);
    local = local.filter((entry) => entry.key !== key);
    rebuild();
  }

  async function refresh(): Promise<void> {
    if (busy || !ports.catalog()) return;
    busy = true;
    try {
      const records = await ports.request();
      remote = ports
        .normalize(records, ports.catalog()!.allItems)
        .filter((entry) => ports.realmExists("SR_" + entry.serverRegion + entry.serverIdentifier));
      state.error = null;
      rebuild();
      ports.queueMatches();
    } catch (error) {
      state.error = requestText(requestObject(error).message || error);
    } finally {
      busy = false;
    }
  }
  return { rebuild, observe, dismiss, refresh };
}
