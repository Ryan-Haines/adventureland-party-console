import { randomUUID } from 'node:crypto';
import { sharedMember } from './shared-rules.ts';
import { exchangePickup, type PickupState } from '../merchant/collection-pickups.ts';
import type { MerchantWork } from '../merchant/work.ts';
import { requestObject, requestText } from "../http/contracts.ts";
import type { Item, InventoryEntry, ItemMark } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";
import { entryMeta } from "./catalog-meta.ts";

interface Entry extends InventoryEntry {
  slot: number;
  item: Item;
}
interface Status {
  items?: (Entry | null)[];
}
interface MerchantItemState extends PickupState {
  merchantCharacter: string | null;
  merchantWeapon: { item: Item } | null;
  statuses: Record<string, Status | undefined>;
  merchantCatalog?: NonNullable<PickupState['merchantCatalog']> & { exchangeable?: { id: string; level?: number; reward?: unknown; required?: number }[] } | null;
  autoExchanges: Record<string, { name: string; level: number }>;
  merchantQueue: MerchantWork[];
  purchases: Record<string, { name: string }[] | undefined>;
}
interface Ports {
  selectAction?(item: Item, name: string): void;
  persist(): void;
  scheduleExchange(status: Status | undefined): void;
}
const weaponTypes = new Set([
  "mace",
  "staff",
  "bow",
  "spear",
  "short_sword",
  "fist",
  "dartgun",
  "dagger",
  "axe",
  "basher",
]);
export function merchantWeaponCompatible(definition: {type?: string; wtype?: string}): boolean {
  return definition.type === 'weapon' && weaponTypes.has(definition.wtype || '');
}
type Request = Record<string, unknown>;
function failure(message: string, status = 400): CommandOutcome {
  return { status, body: { error: message } };
}
function itemQuantity(item: Item): number { return Number(item.q) || 1; }
function exchangeChoice(state: MerchantItemState, item: Item) {
  const level = Number(item.level) || 0;
  return state.merchantCatalog?.exchangeable?.find(line => !line.reward && line.id === item.name && (Number(line.level) || 0) === level);
}
function exchangeCount(choice: ReturnType<typeof exchangeChoice>, item: Item): number {
  return Math.floor(itemQuantity(item) / Math.max(1, Number(choice?.required) || 1));
}
function collectionIntent(state: MerchantItemState, name: string, slot: number): boolean {
  return [...(state.marked?.[name] || []), ...(state.merchantMarked?.[name] || [])].some(raw => requestObject(raw).slot === slot);
}
function validSelection(state: MerchantItemState, body: Request): boolean {
  if (!state.merchantCharacter || !sharedMember(state, String(body.character))) return false;
  if (!Number.isSafeInteger(body.slot)) return false;
  return body.type !== 'merchant-weapon' || body.character === state.merchantCharacter;
}
function prospectiveExchange(state: MerchantItemState, body: Request): boolean {
  return body.type === 'auto-exchange' && body.character === state.merchantCharacter && body.slot === -1;
}
export function createMerchantItemCommands(state: MerchantItemState, ports: Ports) {
  function weapon(body: Request, entry: Entry): CommandOutcome {
    const definition = entryMeta(state.merchantCatalog, entry)?.definition || {};
    if (!merchantWeaponCompatible(definition))
      return failure("select a normal merchant-compatible weapon");
    state.merchantWeapon = body.remove === true ? null : { item: requestObject(body.item) };
    ports.persist();
    return null;
  }
  function exchange(item: Item & { name: string }, status: Status | undefined): CommandOutcome {
    const level = Number(item.level) || 0;
    const choice = state.merchantCatalog?.exchangeable?.find(
      (entry) => !entry.reward && entry.id === item.name && (Number(entry.level) || 0) === level,
    );
    if (!choice) return failure("this item cannot be exchanged");
    const key = item.name + "@" + level;
    if (state.autoExchanges[key]) delete state.autoExchanges[key];
    else {
      ports.selectAction?.(item, String(state.merchantCharacter));
      state.autoExchanges[key] = { name: item.name, level };
    }
    ports.persist();
    ports.scheduleExchange(status);
    return null;
  }
  function once(body: Request, entry: Entry): CommandOutcome {
    const item = entry.item, level = Number(item.level) || 0, name = String(body.character);
    const choice = exchangeChoice(state, item), quantity = exchangeCount(choice, item);
    if (!choice || !quantity) return failure("not enough stock for this exchange");
    const pickup = exchangePickup(state, name, entry);
    if (!pickup) return failure("this item is protected or reserved", 409);
    if (collectionIntent(state, name, entry.slot)) return failure("this item already has a collection intent", 409);
    const id = 'exchange-' + randomUUID(), queuedAt = Date.now();
    const job: MerchantWork = {id, target: state.merchantCharacter, reason: 'exchange', routine: 'manual exchange', manual: true, queuedAt,
      exchanges: [{id: String(item.name), level, quantity}]};
    if (name !== state.merchantCharacter) queuePickup(name, item, pickup, job);
    state.merchantQueue.push(job);
    ports.persist();
    return null;
  }
  function queuePickup(name: string, item: Item, pickup: ItemMark, job: MerchantWork): void {
    const id = job.id, queuedAt = job.queuedAt;
    const mark = {...pickup, exchangeJobId: id};
    (state.merchantMarked ||= {})[name] ||= [];
    state.merchantMarked[name].push(mark);
    job.exchangePickupItem = item;
    job.exchangePickupQuantity = itemQuantity(item);
    job.exchangePickupId = id + '-pickup';
    state.merchantQueue.push({id: job.exchangePickupId, target: name, reason: 'exchange pickup', routine: 'manual exchange', manual: true, queuedAt, exchangeDeliveryId: id});
  }
  function selected(body: Request, item: Item & { name: string }): CommandOutcome {
    if (!validSelection(state, body))
      return undefined;
    const status = state.statuses[String(state.merchantCharacter)],
      entry = state.statuses[String(body.character)]?.items?.find((candidate) => candidate?.slot === body.slot);
    if (prospectiveExchange(state, body)) return exchange(item, status);
    if (!entry || JSON.stringify(entry.item) !== JSON.stringify(item))
      return failure("merchant inventory item changed; refresh and try again", 409);
    if (body.type === "exchange") return once(body, entry);
    return body.type === "merchant-weapon" ? weapon(body, entry) : exchange(item, status);
  }
  function handle(body: Request): CommandOutcome {
    const item = requestObject(body.item);
    if (typeof item.name !== "string") return undefined;
    if (body.type === "buy-copy") {
      (state.purchases[requestText(body.character)] ||= []).push({ name: item.name });
      ports.persist();
      return null;
    }
    if (body.type !== "merchant-weapon" && body.type !== "auto-exchange" && body.type !== "exchange") return undefined;
    return selected(body, item as Item & { name: string });
  }
  return { handle };
}
