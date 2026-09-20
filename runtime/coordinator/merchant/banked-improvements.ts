import { upgradeOfferingReady } from '../inventory/offering-waits.ts';
import { itemRuleConflicts, type ConflictState } from "../inventory/shared-rules.ts";
import type { InventoryEntry } from "../contracts/item.ts";
import type { CompoundRule } from "./automatic-improvements.ts";
import type { StorageReference, BankboiInventory } from "../inventory/bankboi-completion.ts";
import { availableCraftStock, craftProtection, type CraftReservationState } from "./craft-reservations.ts";

type UpgradePreference = number | string | { tiers: number; quantity?: number };
export interface BankUpgradeRule { name: string; level: number; tiers: number; quantity: number; existingTargetQuantity?: number }
export interface BankImprovementState extends ConflictState, CraftReservationState {
  merchantCharacter: string | null;
  upgrades?: Record<string, unknown[] | undefined>;
  autoUpgradeMarks?: Record<string, Record<string, UpgradePreference | undefined> | undefined>;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
  statuses?: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  bankbois?: Record<string, BankboiInventory>;
}
function quantity(value: unknown): number { return Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : -1; }
function mergedQuantity(a: number, b: number): number { return a === -1 || b === -1 ? -1 : Math.max(a, b); }

/** Bank stock is shared; duplicate preferences authorize one pass, never duplicate withdrawals. */
export function sharedCompoundRules(state: Pick<BankImprovementState, 'merchantCharacter' | 'merchantRules' | 'autoCompounds'>): CompoundRule[] {
  const rules = new Map<string, CompoundRule>();
  for (const rule of (state.merchantRules ? [state.autoCompounds[String(state.merchantCharacter)]] : Object.values(state.autoCompounds)).flatMap(value => value || [])) {
    const key = rule.name + "@" + (rule.targetTier || 1), old = rules.get(key);
    rules.set(key, { name: rule.name, targetTier: rule.targetTier || 1,
      quantity: old ? mergedQuantity(quantity(old.quantity), quantity(rule.quantity)) : quantity(rule.quantity) });
  }
  return [...rules.values()].sort((a, b) => Number(b.targetTier) - Number(a.targetTier));
}
function parseUpgrade(key: string, value: UpgradePreference | undefined): BankUpgradeRule | null {
  const match = /^(.*)@\+(\d+)$/.exec(key), tiers = Number(typeof value === "object" ? value?.tiers : value);
  if (!match || !Number.isSafeInteger(tiers) || tiers < 1 || tiers + Number(match[2]) > 13) return null;
  return { name: match[1], level: Number(match[2]), tiers, quantity: quantity(typeof value === "object" ? value?.quantity : -1) };
}
export function sharedUpgradeRules(state: BankImprovementState): BankUpgradeRule[] {
  const rules = new Map<string, BankUpgradeRule>();
  for (const entries of (state.merchantRules ? [state.autoUpgradeMarks?.[String(state.merchantCharacter)]] : Object.values(state.autoUpgradeMarks || {}))) for (const [key, value] of Object.entries(entries || {})) {
    const rule = parseUpgrade(key, value);
    if (!rule) continue;
    const goal = key + "@" + rule.tiers, old = rules.get(goal);
    rules.set(goal, old ? { ...rule, quantity: mergedQuantity(old.quantity, rule.quantity) } : rule);
  }
  return [...rules.values()].sort((a, b) => (b.level + b.tiers) - (a.level + a.tiers));
}
export function externalImprovementItems(state: BankImprovementState): (InventoryEntry | null)[] {
  const fighters = Object.entries(state.statuses || {}).filter(([name]) => name !== state.merchantCharacter && !state.bankbois?.[name]);
  return fighters.flatMap(([, status]) => status?.items || []).concat(Object.values(state.bankbois || {}).flatMap(worker => worker.items || []));
}
export function improvementItems(state: BankImprovementState): (InventoryEntry | null)[] {
  return (state.statuses?.[String(state.merchantCharacter)]?.items || [])
    .concat(Object.values(state.bankSnapshot?.packs || {}).flatMap(pack => pack || []), externalImprovementItems(state));
}
export function completedUpgrades(rule: BankUpgradeRule, entries: readonly (InventoryEntry | null)[]): number {
  return entries.filter(entry => entry?.item?.name === rule.name && (Number(entry.item.level) || 0) >= rule.level + rule.tiers).length;
}
export function matchesUpgrade(rule: BankUpgradeRule, entry: InventoryEntry | null | undefined): boolean {
  return !!entry?.item && !entry.item.l && entry.item.name === rule.name && (Number(entry.item.level) || 0) === rule.level;
}
export function runnableBankUpgrades(state: BankImprovementState): BankUpgradeRule[] {
  const available = availableUpgradeStock(state);
  return sharedUpgradeRules(state).filter(rule => !hasWaitingUpgrade(state, rule) && (rule.quantity === -1 || rule.quantity > 0) && !itemRuleConflicts(state,{name:rule.name,level:rule.level}).length && available.some(entry => matchesUpgrade(rule, entry)));
}
function workerUpgrade(state: BankImprovementState, rule: BankUpgradeRule): StorageReference[] {
  const entry = availableUpgradeStock(state).find(entry => entry?.craftLocation?.startsWith('bankboi:') && matchesUpgrade(rule,entry));
  if (entry && Number.isSafeInteger(entry.slot)) return [{pack:entry.craftLocation!,slot:entry.slot,item:entry.item,improvement:'auto upgrade'}];
  return [];
}
export function planUpgradeStorage(state: BankImprovementState, rules: BankUpgradeRule[]): StorageReference[] {
  const local = availableUpgradeStock(state).filter(entry => !entry?.craftLocation?.startsWith('bankboi:'));
  for (const rule of rules) {
    if (local.some(entry => matchesUpgrade(rule, entry))) continue;
    const requests = workerUpgrade(state, rule);
    if (requests.length) return requests;
  }
  return [];
}

function availableUpgradeStock(state: BankImprovementState) {
  const locations: [string,(InventoryEntry | null)[]][] = [
    ['inventory:'+state.merchantCharacter,state.statuses?.[String(state.merchantCharacter)]?.items || []],
    ...Object.entries(state.bankSnapshot?.packs || {}).map(([pack,items]): [string,(InventoryEntry | null)[]] => [pack,items || []]),
    ...Object.values(state.bankbois || {}).map((worker): [string,(InventoryEntry | null)[]] => ['bankboi:'+worker.name,worker.items || []])
  ];
  const entries = locations.flatMap(([craftLocation,items]) => items.map(entry => entry && {...entry,craftLocation}));
  return availableCraftStock(entries,craftProtection(state));
}

export function hasWaitingUpgrade(state: BankImprovementState, rule: BankUpgradeRule): boolean {
  return Object.values(state.upgrades || {}).flatMap(marks => marks || []).some(raw => {
    const mark = raw as {item?: {name?: string; level?: number}};
    return mark.item?.name === rule.name && (mark.item.level || 0) === rule.level && !upgradeOfferingReady(state, mark);
  });
}
