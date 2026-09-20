import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { storagePack } from "../inventory/storage-source.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { MerchantWork } from "../merchant/work.ts";
import type { WithdrawalRequest } from "../inventory/exchange-storage.ts";
import { playerSaleReserved, reservePlayerSale, releasePlayerSale, type PlayerSaleState } from "../merchant/player-npc-sales.ts";

interface SaleEntry extends InventoryEntry {
  [field: string]: unknown;
}
interface SaleRequest {
  source: "merchant" | "bank" | "character";
  character?: string;
  pack: string | null;
  slot: number;
  quantity: number;
  item: Item & { name: string };
}
interface SaleMark extends Omit<SaleRequest, "pack"> {
  id: string;
  pack?: string;
  queuedAt: number;
  state: string;
}
interface SaleState extends PlayerSaleState {
  merchantCharacter: string | null;
  statuses: Record<string, { items?: (SaleEntry | null)[] } | undefined>;
  bankbois: Record<string, { items?: (SaleEntry | null)[] } | undefined>;
  bankSnapshot: { packs?: Record<string, (SaleEntry | null)[] | undefined> } | null;
  npcSaleMarks: SaleMark[];
  withdrawals: Record<string, WithdrawalRequest[] | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface SalePorts {
  now(): number;
  nextCommand(): number;
  persistBank(): void;
  bankService(): unknown;
  stamp(job: MerchantWork): MerchantWork;
  queue(names: (string | null)[], reason: string): void;
  log(message: string, level: string): void;
  persist(): void;
}

function saleRequest(body: Record<string, unknown>, merchant: string | null): SaleRequest | null {
  const source = saleSource(body.source),
    pack = storagePack(body.pack),
    slot = Number(body.slot),
    item = requestObject(body.item);
  if (
    !merchant ||
    (source === "bank" && !pack) ||
    !Number.isSafeInteger(slot) ||
    slot < 0 ||
    typeof item.name !== "string"
  )
    return null;
  return {
    source,
    character: typeof body.character === "string" ? body.character : undefined,
    pack,
    slot,
    item: item as Item & { name: string },
    quantity: Number(body.quantity || 1),
  };
}
function saleSource(source: unknown): SaleRequest["source"] {
  return source === "character" || source === "merchant" ? source : "bank";
}
function sameItem(entry: SaleEntry | null | undefined, item: Item): boolean {
  const current = entry?.item || entry;
  return (
    !!current &&
    Object.keys(item)
      .filter((key) => key !== "q")
      .every((key) => JSON.stringify(current[key]) === JSON.stringify(item[key]))
  );
}
function modified(item: Item): boolean {
  return Number(item.level) > 0 || !!item.stat_type || !!item.p;
}
function saleWarning(request: SaleRequest, live: SaleEntry, acknowledged: unknown): string | null {
  const available = Number(live.item?.q) || 1,
    { item, quantity } = request,
    current = live.item || item;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > available)
    return "invalid NPC sale quantity";
  if (modified(current) && acknowledged !== true)
    return "confirm the modified-item warning before selling";
  return current.l ? "locked items cannot be sold" : null;
}

export function createNpcSaleRoute(state: SaleState, ports: SalePorts) {
  function bankboi(pack: string | null) {
    return pack?.startsWith("bankboi:") ? state.bankbois[pack.slice(8)] : null;
  }
  function liveItem(request: SaleRequest): SaleEntry | null | undefined {
    if (request.source !== "bank")
      return state.statuses[String(request.source === "character" ? request.character : state.merchantCharacter)]?.items?.find(
        (entry) => entry?.slot === request.slot,
      );
    const worker = bankboi(request.pack);
    return worker
      ? (worker.items || [])[request.slot]
      : state.bankSnapshot?.packs?.[request.pack!]?.[request.slot];
  }
  function schedule(request: SaleRequest): void {
    const merchant = state.merchantCharacter;
    if (request.source === "character") {
      ports.queue([request.character!], "npc sale pickup");
      return;
    }
    if (bankboi(request.pack)) {
      (state.withdrawals[String(merchant)] ||= []).push({
        pack: request.pack!,
        slot: request.slot,
        item: request.item,
      });
      ports.persistBank();
      ports.bankService();
    } else if (
      state.merchantCurrent?.reason === "npc sales" &&
      !state.merchantQueue.some((job) => job.reason === "npc sales")
    )
      state.merchantQueue.push(
        ports.stamp({
          id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
          target: merchant,
          reason: "npc sales",
          queuedAt: ports.now(),
        }),
      );
    else ports.queue([merchant], "npc sales");
  }
  function remove(body: Record<string, unknown>, res: HttpResponse) {
      const mark = state.npcSaleMarks.find(mark => mark.id === body.id && mark.character === body.character);
      if (!mark || mark.state === "running" || state.merchantCurrent?.reason === "npc sales")
        return res.status(409).json({ error: "Sale is missing or already in progress" });
      releasePlayerSale(state, mark);
      state.npcSaleMarks = state.npcSaleMarks.filter(entry => entry !== mark);
      ports.persist(); return res.json({ ok: true });
  }
  function validate(request: SaleRequest, body: Record<string, unknown>, res: HttpResponse): boolean {
    if (request.source === "character" && (!request.character || request.character === state.merchantCharacter ||
      !state.statuses[request.character])) { res.status(400).json({ error: "Unknown player character" }); return false; }
    const live = liveItem(request);
    if (!sameItem(live, request.item)) {
      res.status(409).json({ error: "the item moved; refresh and try again" }); return false;
    }
    const warning = saleWarning(request, live!, body.acknowledged);
    if (warning) { res.status(400).json({ error: warning }); return false; }
    return validatePlayer(request, live!, res);
  }
  function validatePlayer(request: SaleRequest, live: SaleEntry, res: HttpResponse) {
    if (request.source !== "character") return true;
    if (live.item?.b || playerSaleReserved(state, request.character!, request.slot)) {
      res.status(409).json({ error: "Remove the item's other work marks first" }); return false;
    }
    return true;
  }
  return function npcSale(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (body.remove === true) return remove(body, res);
    const request = saleRequest(body, state.merchantCharacter);
    if (!request) return res.status(400).json({ error: "invalid NPC sale item" });
    if (!validate(request, body, res)) return;
    const existing = state.npcSaleMarks.find(mark => mark.source === request.source && mark.character === request.character &&
      mark.pack === (request.pack || undefined) && mark.slot === request.slot && sameItem({ item: mark.item }, request.item));
    if (existing) return res.json({ ok: true, mark: existing });
    const mark: SaleMark = {
      id: "npc-sale-" + ports.now() + "-" + ports.nextCommand(),
      source: request.source,
      character: request.character,
      pack: request.pack || undefined,
      slot: request.slot,
      item: request.item,
      quantity: request.quantity,
      queuedAt: ports.now(),
      state: request.source === "character" ? "collecting" : "queued",
    };
    state.npcSaleMarks.push(mark);
    if (request.source === "character") reservePlayerSale(state, mark);
    schedule(request);
    ports.log("Queued NPC sale for " + request.quantity + " × " + request.item.name, "info");
    ports.persist();
    return res.json({ ok: true, mark });
  };
}
