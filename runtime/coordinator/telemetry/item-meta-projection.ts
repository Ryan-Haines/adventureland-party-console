import { entryMeta } from "../inventory/catalog-meta.ts";
import { compactEntry } from "./public-state-characters.ts";
import type { PresentationEntry, PresentationStatus } from "./public-state-types.ts";

/**
 * Item meta projections for the bank section and the unsectioned debug state.
 * Reports leave per-type meta to merchantCatalog (inventory/catalog-meta.ts);
 * these put it back in the shapes readers received before.
 */
function mapEntries(value: unknown, project: (entry: PresentationEntry) => unknown): unknown {
  return Array.isArray(value)
    ? value.map((entry) => (entry && typeof entry === "object" ? project(entry) : entry))
    : value;
}
function mapPacks(bank: unknown, project: (entry: PresentationEntry) => unknown): unknown {
  if (!bank || typeof bank !== "object") return bank;
  const snapshot = bank as { packs?: unknown };
  if (!snapshot.packs || typeof snapshot.packs !== "object") return bank;
  return {
    ...snapshot,
    packs: Object.fromEntries(
      Object.entries(snapshot.packs).map(([pack, entries]) => [pack, mapEntries(entries, project)]),
    ),
  };
}

// The bank snapshot changes once or twice per bank visit while the dashboard
// polls the bank section every two seconds, so compactBank compacts each
// snapshot once.
const compactBanks = new WeakMap<object, { catalog: unknown; value: unknown }>();
/** Bank packs in the shape compactEntry gives inventory cells. */
export function compactBank(bank: unknown, catalog: unknown): unknown {
  if (!bank || typeof bank !== "object") return bank;
  const cached = compactBanks.get(bank);
  if (cached && cached.catalog === catalog) return cached.value;
  const value = mapPacks(bank, (entry) => compactEntry(entry, catalog));
  compactBanks.set(bank, { catalog, value });
  return value;
}

function mapBankbois(bankbois: unknown, project: (entry: PresentationEntry) => unknown): unknown {
  return mapEntries(bankbois, (bankboi) => ({ ...bankboi, items: mapEntries(bankboi.items, project) }));
}
/** Storage worker inventories, compacted like the bank they hold. */
export function compactBankbois(bankbois: unknown, catalog: unknown): unknown {
  return mapBankbois(bankbois, (entry) => compactEntry(entry, catalog));
}

function withFullMeta(entry: PresentationEntry, catalog: unknown): PresentationEntry {
  const meta = entryMeta(catalog, entry);
  return meta ? { ...entry, meta } : entry;
}
/**
 * The unsectioned debug state keeps every field reports carried before they
 * left per-type meta to the catalog, for tools and tests that read it.
 */
export function fullMetaStatuses(
  statuses: Readonly<Record<string, PresentationStatus>>,
  catalog: unknown,
): Record<string, PresentationStatus> {
  const join = (entry: PresentationEntry) => withFullMeta(entry, catalog);
  return Object.fromEntries(
    Object.entries(statuses).map(([name, status]) => [
      name,
      {
        ...status,
        items: mapEntries(status.items, join) as PresentationStatus["items"],
        slots: Object.fromEntries(
          Object.entries(status.slots || {}).map(([slot, entry]) => [slot, entry && join(entry)]),
        ),
        ...(status.bank ? { bank: mapPacks(status.bank, join) } : {}),
        ...(Array.isArray(status.nearbyStandListings)
          ? { nearbyStandListings: mapEntries(status.nearbyStandListings, join) }
          : {}),
      },
    ]),
  );
}
/** The bank snapshot with full meta, for the unsectioned debug state. */
export function fullMetaBank(bank: unknown, catalog: unknown): unknown {
  return mapPacks(bank, (entry) => withFullMeta(entry, catalog));
}
/** Storage worker inventories with full meta, for the unsectioned debug state. */
export function fullMetaBankbois(bankbois: unknown, catalog: unknown): unknown {
  return mapBankbois(bankbois, (entry) => withFullMeta(entry, catalog));
}
