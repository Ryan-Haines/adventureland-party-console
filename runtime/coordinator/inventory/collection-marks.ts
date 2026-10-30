import type { InventoryEntry, ItemMark } from "../contracts/item.ts";
import { autoItemRuleMode, markedItem, sameMarkedItem } from "./item-identity.ts";

type Mode = "bank" | "merchant";
type Inventory = readonly (InventoryEntry | null)[];
/** Copies with no item rule that still belong in the bank (#116: kept NPC-sale stock). */
type BankKept = (entry: InventoryEntry) => boolean;

interface MarkState {
  bank: ItemMark[];
  merchant: ItemMark[];
  changed: boolean;
}

function retainManual(
  mark: ItemMark,
  items: Inventory,
  live: InventoryEntry | null | undefined,
  state: MarkState,
): boolean {
  if (!Number.isSafeInteger(mark.slot))
    return items.some((entry) => !!entry && sameMarkedItem(entry.item, markedItem(mark)));
  if (live && sameMarkedItem(live.item, mark.item)) return true;
  // Sorting moves an item's manual intent with it, rather than clearing the mark.
  const relocated = items.find((entry) => !!entry && sameMarkedItem(entry.item, mark.item));
  if (!relocated) return false;
  mark.slot = relocated.slot;
  state.changed = true;
  return true;
}

function retainMark(
  mark: ItemMark,
  mode: Mode,
  items: Inventory,
  rules: Readonly<Record<string, string>>,
  state: MarkState,
  bankKept?: BankKept,
): boolean {
  const live = Number.isSafeInteger(mark.slot)
    ? items.find((entry) => entry?.slot === mark.slot)
    : null;
  if (!mark.auto) return retainManual(mark, items, live, state);
  if (!live || !sameMarkedItem(live.item, mark.item)) return false;
  return entryMode(live, rules, bankKept) === mode;
}
function entryMode(entry: InventoryEntry, rules: Readonly<Record<string, string>>, bankKept?: BankKept): string | undefined {
  return autoItemRuleMode(rules, entry.item) || (bankKept?.(entry) ? "bank" : undefined);
}

function pruneMarks(
  mode: Mode,
  items: Inventory,
  rules: Readonly<Record<string, string>>,
  state: MarkState,
  bankKept?: BankKept,
): void {
  const before = state[mode];
  state[mode] = before.filter((mark) => retainMark(mark, mode, items, rules, state, bankKept));
  if (state[mode].length !== before.length) state.changed = true;
}

function assignMark(entry: InventoryEntry, mode: Mode, state: MarkState): void {
  // A one-off destination overrides the standing rule for this copy only.
  const manual = (mark: ItemMark) =>
    !mark.auto &&
    (Number.isSafeInteger(mark.slot)
      ? mark.slot === entry.slot
      : sameMarkedItem(entry.item, markedItem(mark)));
  if (state.bank.some(manual) || state.merchant.some(manual)) return;
  const list = state[mode],
    other = mode === "bank" ? "merchant" : "bank";
  const existing = list.findIndex((mark) => mark.slot === entry.slot);
  const next: ItemMark = { slot: entry.slot, item: entry.item || undefined, auto: true };
  if (existing < 0) {
    list.push(next);
    state.changed = true;
  } else if (
    list[existing].auto &&
    JSON.stringify(list[existing].item) !== JSON.stringify(entry.item)
  ) {
    list[existing] = next;
    state.changed = true;
  }
  const before = state[other].length;
  state[other] = state[other].filter((mark) => mark.slot !== entry.slot);
  if (state[other].length !== before) state.changed = true;
}

export function reconcileCollectionMarks(
  bank: ItemMark[],
  merchant: ItemMark[],
  rules: Readonly<Record<string, string>>,
  items: Inventory,
  bankKept?: BankKept,
): MarkState {
  const state: MarkState = { bank, merchant, changed: false };
  pruneMarks("bank", items, rules, state, bankKept);
  pruneMarks("merchant", items, rules, state, bankKept);
  for (const entry of items) {
    if (!entry?.item || !Number.isSafeInteger(entry.slot)) continue;
    const mode = entryMode(entry, rules, bankKept);
    if (mode === "bank" || mode === "merchant") assignMark(entry, mode, state);
  }
  return state;
}
