import { nativeLedger, nativeOccupants, displaceNativeOccupant, type NativeStandState } from "../commerce/native-stand.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { StandBid } from "../commerce/bids.ts";

interface Bid {
  useStandSlot: boolean;
  acceptHigherLevels: boolean;
  price: number;
  quantity: number;
  minimumQuality: number;
  priorityOverride?: number;
}
interface BidItem {
  id: string;
  upgradeable?: boolean;
  compoundable?: boolean;
}
interface BidState extends NativeStandState {
  merchantCharacter: string | null;
  merchantCatalog?: { allItems?: BidItem[] } | null;
  standBids: Record<string, StandBid | undefined>;
  statuses: Record<string, { nearbyStandListings?: unknown[] } | undefined>;
}
interface BidPorts {
  removeQueued(id: string): void;
  log(message: string, level: string): void;
  observe(listings: unknown[]): void;
  persist(): void;
  publish(): void;
  ponty(): boolean;
  aldata(): unknown;
  dispatch(): void;
}
function whole(value: number, min: number, max: number): boolean {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}
function priority(value: unknown, previous: number | undefined): number | undefined {
  if (value === undefined) return previous;
  return value === null || value === "" ? undefined : Number(value);
}
function preferences(body: Record<string, unknown>, previous: StandBid | undefined) {
  return {
    useStandSlot: body.useStandSlot === undefined ? previous?.useStandSlot === true : body.useStandSlot === true,
    acceptHigherLevels: body.acceptHigherLevels === undefined ? previous?.acceptHigherLevels !== false : body.acceptHigherLevels !== false,
  };
}
function parseEdit(body: Record<string, unknown>, previous: StandBid | undefined): Bid | string {
  if (body.editField !== undefined) {
    if (!previous) return "This WTB order has already completed or was cancelled";
    if (typeof body.editField !== "string" || !["price", "quantity", "priorityOverride"].includes(body.editField)) return "invalid WTB edit field";
    if (body.value === undefined) return "missing WTB edit value";
    return validate({ ...previous, [body.editField]: body.value }, previous);
  }
  if (body.preferencesOnly !== true) return validate(body, previous);
  if (!previous) return "This WTB order has already completed or was cancelled";
  return validate({ ...body, price: previous.price, quantity: previous.quantity, minimumQuality: previous.minimumQuality, priorityOverride: previous.priorityOverride }, previous);
}
function staleFieldEdit(body: Record<string, unknown>, previous: StandBid | undefined): boolean {
  if (body.editField === undefined) return false;
  return !previous || body.bidRevision !== Number(previous.revision || 0);
}
function validate(body: Record<string, unknown>, previous: StandBid | undefined): Bid | string {
  const price = Number(body.price),
    quantity = Number(body.quantity),
    minimumQuality = Number(body.minimumQuality || 0);
  if (!whole(price, 1, 1000000000000) || !whole(quantity, 1, Number.MAX_SAFE_INTEGER) || !whole(minimumQuality, 0, 99))
    return "enter a positive whole-number bid and quantity";
  const priorityOverride = priority(body.priorityOverride, previous?.priorityOverride);
  if (priorityOverride !== undefined && !whole(priorityOverride, 0, 100))
    return "priority override must be a whole number from 0 to 100, or blank";
  return {
    price,
    quantity,
    ...preferences(body, previous),
    ...(priorityOverride === undefined ? {} : { priorityOverride }),
    minimumQuality,
  };
}
export function createMerchantBidRoute(state: BidState, ports: BidPorts) {
  function set(item: BidItem, bid: Bid): void {
    ports.removeQueued(item.id);
    state.standBids[item.id] = {
      ...bid,
      revision: state.standBids[item.id] ? Number(state.standBids[item.id]!.revision || 0) : ++nativeLedger(state).sequence,
      standSuppressed: bid.useStandSlot ? false : state.standBids[item.id]?.standSuppressed,
      minimumQuality: item.upgradeable || item.compoundable ? bid.minimumQuality : 0,
    };
    ports.log(
      "Bid set for " +
        bid.quantity +
        " × " +
        item.id +
        " at up to " +
        bid.price.toLocaleString() +
        " gold",
      "info",
    );
    ports.observe(state.statuses[String(state.merchantCharacter)]?.nearbyStandListings || []);
  }
  function purchasePending(id: string): boolean {
    return Object.values(nativeLedger(state).purchases || {}).some(entry => entry.item.name === id);
  }
  function conflict(id: string, body: Record<string, unknown>): string | null {
    if (staleFieldEdit(body, state.standBids[id]))
      return "This WTB order completed, was cancelled, or was replaced; refresh before editing";
    return purchasePending(id) ? "A purchase is awaiting confirmation; retry the edit after it completes" : null;
  }
  function replace(id: string, parsed: Bid, selection: unknown) {
    const occupants = nativeOccupants(state, id);
    if (!parsed.useStandSlot || state.standBids[id]?.useStandSlot || occupants.length < 16) return null;
    const selected = occupants.find(entry => entry.id === selection);
    if (!selected) return { error: "All stand slots are full. Which item would you like to remove to make room for the buy order?", occupants };
    displaceNativeOccupant(state, selected.id);
    return null;
  }
  return function bid(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    const item = (state.merchantCatalog?.allItems || []).find((entry) => entry.id === body.itemId);
    if (typeof body.itemId !== "string" || !item)
      return res.status(400).json({ error: "select a valid item" });
    const id = requestText(body.itemId);
    const editConflict = conflict(id, body);
    if (editConflict) return res.status(409).json({ error: editConflict });
    if (body.clear === true) {
      ports.removeQueued(id);
      delete state.standBids[id];
      ports.log("Cleared bid for " + id, "info");
    } else {
      const parsed = parseEdit(body, state.standBids[id]);
      if (typeof parsed === "string") return res.status(400).json({ error: parsed });
      const replacementError = replace(id, parsed, body.replaceStandEntry);
      if (replacementError) return res.status(409).json(replacementError);
      set(item, parsed);
    }
    ports.persist();
    ports.publish();
    if (!ports.ponty()) ports.aldata();
    ports.dispatch();
    return res.json({ ok: true, standBids: state.standBids });
  };
}
