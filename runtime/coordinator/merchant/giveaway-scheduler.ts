interface Giveaway {
  seller?: string;
  slot?: string;
  rid?: string;
  candidateKey?: string;
  expiresAt?: number;
  entrants?: (string | null)[];
  map?: string;
  x?: unknown;
  y?: unknown;
  item?: { name?: string; level?: number } | null;
  minutes?: unknown;
}
interface GiveawayJob {
  id: string;
  target: string | null;
  reason: string;
  seller: string;
  slot: string;
  rid?: string;
  candidateKey?: string;
  expiresAt?: number;
  expectedItem?: { name?: string; level?: number } | null;
  realm: string | null;
  location: { map?: string; x: number; y: number };
  queuedAt: number;
}
interface QueueEntry {
  slot?: string;
  realm?: string | null;
  candidateKey?: string;
  reason?: string;
  seller?: string;
  rid?: string;
}
interface GiveawayState {
  giveawayAttempts?: Record<string, number>;
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean | undefined>;
  merchantCurrent?: QueueEntry | null;
  merchantQueue: QueueEntry[];
}
interface GiveawayPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: GiveawayJob): GiveawayJob;
  log(message: string, level: string, details: unknown): void;
}
type EligibleGiveaway = Giveaway & { seller: string; slot: string };
function eligible(
  giveaway: Giveaway | null,
  merchant: string | null,
): giveaway is EligibleGiveaway {
  return (
    !!giveaway &&
    !!giveaway.seller &&
    !!giveaway.slot &&
    (!!giveaway.rid || !!giveaway.candidateKey) &&
    !(giveaway.entrants || []).includes(merchant)
  );
}

/** Discovery enqueues once per seller/offer; the normal merchant dispatcher owns execution. */
export function createGiveawayScheduler(state: GiveawayState, ports: GiveawayPorts) {
  function queued(giveaway: EligibleGiveaway, realm: string | null): boolean {
    return [state.merchantCurrent, ...state.merchantQueue].some(
      (job) =>
        !!job &&
        job.reason === "join giveaway" &&
        job.seller === giveaway.seller &&
        ((!job.realm || job.realm === realm) && (job.slot === giveaway.slot || (!!giveaway.rid && job.rid === giveaway.rid))),
    );
  }
  function schedule(
    status: { server?: string; nearbyGiveaways?: (Giveaway | null)[] } | null | undefined,
  ): void {
    if (
      state.merchantAutomations["join giveaway"] === false ||
      !status ||
      !Array.isArray(status.nearbyGiveaways)
    )
      return;
    const merchant = state.merchantCharacter;
    const realm = status.server ? "SR_" + status.server.replace(/^SR_/, "") : null;
    if (!safeMerchantRealm(merchant, realm)) return;
    for (const giveaway of status.nearbyGiveaways) {
      if (!eligible(giveaway, merchant) || queued(giveaway, realm)) continue;
      if (!claimAttempt(giveaway, realm)) continue;
      enqueueGiveaway(giveaway, realm, merchant);
    }
  }
  function enqueueGiveaway(giveaway: EligibleGiveaway, realm: string | null, merchant: string) {
      state.merchantQueue.push(
        ports.stamp({
          id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
          target: merchant,
          reason: "join giveaway",
          seller: giveaway.seller,
          slot: giveaway.slot,
          rid: giveaway.rid,
          realm,
          candidateKey: giveaway.candidateKey,
          expiresAt: giveaway.expiresAt,
          expectedItem: giveaway.item,
          location: { map: giveaway.map, x: Number(giveaway.x), y: Number(giveaway.y) },
          queuedAt: ports.now(),
        }),
      );
      ports.log("Discovered giveaway from " + giveaway.seller + "; queued entry", "info", {
        item: giveaway.item && giveaway.item.name,
        slot: giveaway.slot,
        minutes: giveaway.minutes,
      });
  }
  function claimAttempt(giveaway: EligibleGiveaway, realm: string | null): boolean {
    const attempts = (state.giveawayAttempts ||= {});
    for (const [key, expiry] of Object.entries(attempts)) if (expiry <= ports.now()) delete attempts[key];
    const key = giveaway.candidateKey || JSON.stringify([realm, giveaway.seller, giveaway.rid]);
    if (attempts[key] > ports.now() || Number(giveaway.expiresAt || Infinity) <= ports.now()) return false;
    attempts[key] = ports.now() + 30 * 60_000;
    return true;
  }
  function scheduleMarket(value: unknown): void {
    if (!Array.isArray(value)) return;
    for (const merchant of value) {
      if (!validMerchant(merchant, ports.now())) continue;
      marketOffers(merchant).forEach(schedule);
    }
  }
  return { schedule, scheduleMarket };
}
interface MarketMerchant {id: string; lastSeen: string; map: string; x: number; y: number; serverRegion: string; serverIdentifier: string; slots?: Record<string, MarketOffer>}
interface MarketOffer {giveaway?: number; name?: string; level?: number; list?: string[]}
function validMerchant(value: unknown, now: number): value is MarketMerchant {
  if (!value || typeof value !== 'object') return false;
  const m = value as MarketMerchant;
  return Boolean(m.id && m.map && Number.isFinite(m.x) && Number.isFinite(m.y) && m.serverIdentifier !== 'PVP' && Date.parse(m.lastSeen) >= now - 120_000);
}
function marketOffers(merchant: MarketMerchant) {
  const realm = merchant.serverRegion + merchant.serverIdentifier;
  if (!/^(US|EU|ASIA)[A-Z0-9]+$/.test(realm)) return [];
  const seen = Date.parse(merchant.lastSeen);
  return Object.entries(merchant.slots || {}).filter(([slot, item]) => slot.startsWith('trade') && item?.name && Number(item.giveaway) > 0).map(([slot, item]) => ({server: realm, nearbyGiveaways: [{seller: merchant.id, slot, item, entrants: item.list, map: merchant.map, x: merchant.x, y: merchant.y,
    candidateKey: JSON.stringify([realm, merchant.id, slot, item.name, item.level || 0]), expiresAt: Math.min(seen + 120_000, seen + Number(item.giveaway) * 60_000)}]}));
}

function safeMerchantRealm(merchant: string | null, realm: string | null): merchant is string { return Boolean(merchant && !realm?.includes("PVP")); }
