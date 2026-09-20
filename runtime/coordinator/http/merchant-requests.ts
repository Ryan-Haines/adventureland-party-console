import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";

interface RequestState {
  merchantCharacter: string | null;
  merchantQueue: MerchantWork[];
  statuses: Record<string, { donationXpPerGold?: unknown } | undefined>;
  merchantCatalog?: { allItems?: { id: string }[] } | null;
  standSearch: unknown;
}
interface RequestPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  realmExists(realm: string): boolean;
  log(message: string, level: string): void;
  persist(): void;
  dispatch(): void;
}
function realmName(value: unknown): string {
  let realm = typeof value === "string" ? value.toUpperCase().replace(/\s+/g, "") : "";
  if (realm && !realm.startsWith("SR_")) realm = "SR_" + realm.replace(/^SR/, "");
  return realm;
}
export function createMerchantRequestRoutes(state: RequestState, ports: RequestPorts) {
  function job(reason: string, fields: Partial<MerchantWork>): MerchantWork {
    return {
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason,
      ...fields,
      queuedAt: ports.now(),
    };
  }
  function queue(work: MerchantWork, message: string): void {
    state.merchantQueue.push(work);
    ports.log(message, "info");
    ports.persist();
    ports.dispatch();
  }
  function donate(req: HttpRequest, res: HttpResponse): unknown {
    const amount = Number(requestObject(req.body).amount),
      merchant = state.merchantCharacter;
    if (!merchant) return res.status(409).json({ error: "configure a merchant first" });
    if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1000000000000)
      return res.status(400).json({ error: "enter a positive whole-number donation" });
    const work = job("merchant donation", { amount });
    queue(work, "Queued " + amount.toLocaleString() + " gold donation");
    const rate = Number(state.statuses[merchant]?.donationXpPerGold) || 3.2;
    return res.json({ ok: true, jobId: work.id, amount, xp: Math.floor(amount * rate), rate });
  }
  function giveaway(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    const seller = typeof body.seller === "string" ? body.seller.trim() : "",
      realm = realmName(body.realm);
    if (!seller || seller.length > 40)
      return res.status(400).json({ error: "enter a merchant name" });
    if (!realm || !ports.realmExists(realm))
      return res.status(400).json({ error: "enter a valid realm, such as US I or EU II" });
    const work = job("join giveaway", { seller, realm });
    queue(
      ports.stamp(work),
      "Queued giveaway search for " + seller + " on " + realm.replace(/^SR_/, ""),
    );
    return res.json({ ok: true, jobId: work.id });
  }
  function search(req: HttpRequest, res: HttpResponse): unknown {
    const itemId = requestObject(req.body).itemId;
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "configure a merchant first" });
    if (
      typeof itemId !== "string" ||
      !(state.merchantCatalog?.allItems || []).some((item) => item.id === itemId)
    )
      return res.status(400).json({ error: "select a valid item" });
    const work = job("stand search", { itemId });
    state.standSearch = { status: "searching", itemId, listings: [], error: null };
    queue(work, "Queued player-stand search for " + itemId);
    return res.json({ ok: true, jobId: work.id });
  }
  return { donate, giveaway, search };
}
