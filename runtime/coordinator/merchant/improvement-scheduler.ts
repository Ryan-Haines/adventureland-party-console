import { sameMarkedItem } from "../inventory/item-identity.ts";
import { exchangeStorageWorkers } from "../inventory/exchange-storage.ts";
import { ruleOwner, sharedMember, itemRuleConflicts } from "../inventory/shared-rules.ts";
import { pendingProduction, type ProductionState } from '../inventory/production.ts';
import { sharedCompoundRules, improvementItems, runnableBankUpgrades, localBankUpgrades, planUpgradeStorage, type BankImprovementState } from "./banked-improvements.ts";
import type { InventoryEntry } from "../contracts/item.ts";
import type { BankboiInventory, StorageReference } from "../inventory/bankboi-completion.ts";
import { planCompoundStorage } from "./compound-storage.ts";
import { compoundStorageLeftovers } from "../../compound-storage.ts";
import { craftProtection, availableCraftStock } from "./craft-reservations.ts";
import { collectionPickups } from './collection-pickups.ts';
import {
  evaluateAutoCompounds,
  planAutoExchanges,
  type CompoundRule,
  type ExchangeRule,
  type ExchangeChoice,
  type ExchangeLine,
} from "./automatic-improvements.ts";

interface ExchangeJob {
  routine: 'automatic exchange';
  id: string;
  target: string;
  reason: string;
  exchanges: ExchangeLine[];
  autoExchangeKeys: string[];
  queuedAt: number;
}
interface SchedulerState extends BankImprovementState {
  production: ProductionState;
  bankbois?: Record<string, BankboiInventory>;
  bankboiTransaction?: unknown;
  withdrawals?: Record<string, StorageReference[] | undefined>;
  merchantCharacter: string | null;
  merchantAutomations: Record<string, boolean | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  autoCompounds: Record<string, CompoundRule[] | undefined>;
  autoExchanges?: Record<string, ExchangeRule>;
  merchantCatalog?: { exchangeable?: ExchangeChoice[]; craftable?: import("./order-types.ts").OrderChoice[] } | null;
  merchantCurrent?: { reason?: string; order?: unknown; resumeState?: unknown; id?: string } | null;
  merchantQueue: { reason?: string; target?: string | null; order?: unknown; resumeState?: unknown; id?: string }[];
}
interface SchedulerPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: ExchangeJob): ExchangeJob;
  queue(names: string[], reason: string): void;
  persist(): void;
  log(message: string, level: string, details?: unknown): void;
}
interface Status {
  name?: string;
  items?: (InventoryEntry | null)[];
}

/** Translate inventory evaluations into durable rules and serialized merchant work. */
export function createImprovementScheduler(state: SchedulerState, ports: SchedulerPorts) {
  let reservationError = "";
  function reportReservationError(): void {
    const error = craftProtection(state).error || "";
    if (error && error !== reservationError) ports.log(error, "error");
    reservationError = error;
  }
  function compoundInventory(name: string, items: (InventoryEntry | null | undefined)[]) {
    const bank =
      name === state.merchantCharacter ? Object.values(state.bankSnapshot?.packs || {}).flat() : [];
    const workers = name === state.merchantCharacter ? Object.values(state.bankbois || {}) : [];
    const local = availableCraftStock([...items.map(entry => entry && {...entry,craftLocation:"inventory:"+name}), ...bank], craftProtection(state));
    const result = evaluateAutoCompounds(state.autoCompounds[ruleOwner(state, name)] || [],
      local.concat(workers.flatMap((worker) => worker.items || [])));
    return result;
  }
  function stageCompound(name: string, inputs: StorageReference[]): void {
    if (state.merchantCurrent || state.bankboiTransaction) return;
    const pending = state.withdrawals?.[name] || [];
    const retained = pending.filter(mark => {
      if (mark.improvement !== "auto compound") return true;
      if (mark.pack?.startsWith("bankboi:")) return false;
      const physical = state.bankSnapshot?.packs?.[String(mark.pack)];
      return !physical || sameMarkedItem(physical[Number(mark.slot)]?.item, mark.item);
    });
    const next = retained.concat(inputs.map(input => ({...input, improvement: "auto compound"})));
    if (JSON.stringify(next) === JSON.stringify(pending)) return;
    (state.withdrawals ||= {})[name] = next;
    ports.persist();
  }
  function exchangeInventory(items: (InventoryEntry | null)[]) {
    const bank = Object.values(state.bankSnapshot?.packs || {}).flatMap((pack) => pack || []);
    const rules = state.autoExchanges || {};
    const catalog = state.merchantCatalog?.exchangeable || [];
    const local = items.concat(bank);
    const plan = planAutoExchanges(rules, catalog, local);
    if (plan.lines.length || !Object.keys(rules).length || !Object.keys(state.bankbois || {}).length) return plan;
    const remote = exchangeStorageWorkers(state).flatMap(worker => worker.items);
    return planAutoExchanges(rules, catalog, local, remote);
  }
  function canStage(name: string): boolean {
    return !state.merchantCurrent && !state.bankboiTransaction && !state.withdrawals?.[name]?.length;
  }
  function bankUpgrades(name: string): void {
    if (name !== state.merchantCharacter || state.merchantAutomations["auto upgrade"] === false) return;
    const rules = runnableBankUpgrades(state);
    if (!rules.length) return;
    if (canStage(name)) {
      const requests = planUpgradeStorage(state, rules);
      if (requests.length) { (state.withdrawals ||= {})[name] = requests; ports.persist(); }
    }
    if (localBankUpgrades(state, rules).length) ports.queue([name], "auto upgrade");
  }
  function sharedCompounds(name: string, status: Status): boolean {
    const inventory = (status.items || []).filter(entry => !entry?.item || !itemRuleConflicts(state,entry.item).length).map(entry => entry && {...entry, craftLocation: "inventory:" + name});
    const stock = inventory.concat(Object.entries(state.bankSnapshot?.packs || {}).flatMap(([pack, entries]) =>
      (entries || []).map(entry => entry && {...entry, craftLocation: pack})));
    const allWorkers = Object.values(state.bankbois || {});
    const available = availableCraftStock(stock.concat(allWorkers.flatMap(worker => (worker.items || []).map(entry =>
      entry && {...entry, craftLocation: "bankboi:" + worker.name}))).map(entry =>
        entry?.item && itemRuleConflicts(state,entry.item).length ? null : entry), craftProtection(state));
    const reserved = Object.values(state.withdrawals || {}).flat().filter(mark => mark && mark.improvement !== "auto compound");
    const usable = available.map(entry => entry && reserved.some(mark => mark?.pack === entry.craftLocation && mark.slot === entry.slot) ? null : entry);
    const local = usable.slice(0, stock.length);
    let offset = stock.length;
    const workers = allWorkers.map(worker => {
      const items = usable.slice(offset, offset + (worker.items || []).length);
      offset += (worker.items || []).length;
      return {...worker, items};
    });
    const rules = evaluateAutoCompounds(sharedCompoundRules(state), improvementItems(state)).remaining;
    const carried = local.slice(0, inventory.length);
    const free = (status.items || []).filter(entry => !entry?.item).length;
    const plan = planCompoundStorage(rules, local, workers, carried, free);
    stageCompound(name, plan || []);
    return plan?.length === 0 || compoundStorageLeftovers(rules, carried,
      local.concat(workers.flatMap(worker => worker.items || []))).length > 0;
  }
  function compound(name: string, status: Status | null | undefined): boolean {
    if (pendingProduction(state.production).length) return false;
    return evaluateCompound(name, status);
  }
  function evaluateCompound(name: string, status: Status | null | undefined): boolean {
    if (!sharedMember(state,name)) return false;
    reportReservationError();
    bankUpgrades(name);
    if (state.merchantAutomations["auto compound"] === false || !Array.isArray(status?.items))
      return false;
    const result = compoundInventory(name, status.items);
    state.autoCompounds[ruleOwner(state, name)] = result.remaining;
    for (const { rule, target, quantity } of result.completed)
      ports.log("Auto compound quantity reached for " + rule.name + " +" + target, "success", {
        character: name,
        quantity,
      });
    if (result.completed.length) ports.persist();
    const runnable = name === state.merchantCharacter ? sharedCompounds(name, status)
      : collectionPickups({...state, statuses: {...state.statuses, [name]: status}}, name).keep.some(mark => mark.automaticPickup);
    if (runnable) ports.queue([name], name === state.merchantCharacter ? "auto compound" : "marked items");
    else pruneCompound(name);
    return runnable;
  }
  function pruneCompound(name: string): void {
    if (name !== state.merchantCharacter) return;
    const before = state.merchantQueue.length;
    state.merchantQueue = state.merchantQueue.filter(job => job.reason !== "auto compound" || job.target !== name);
    if (state.merchantQueue.length !== before) ports.persist();
  }

  function exchange(status: Status | null | undefined): boolean {
    if (pendingProduction(state.production).length) return false;
    if (state.merchantAutomations['automatic exchange'] === false) return false;
    const merchant = state.merchantCharacter;
    if (!merchant || status?.name !== merchant || !Array.isArray(status.items)) return false;
    if ([state.merchantCurrent, ...state.merchantQueue].some(job => job?.reason === "exchange")) return false;
    const { lines, keys } = exchangeInventory(status.items);
    if (!lines.length) return false;
    state.merchantQueue.push(
      ports.stamp({
        id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
        target: merchant,
        reason: "exchange",
        routine: 'automatic exchange',
        exchanges: lines,
        autoExchangeKeys: keys,
        queuedAt: ports.now(),
      }),
    );
    ports.log("Automatic exchange queued", "info", { exchanges: lines });
    ports.persist();
    return true;
  }
  return { compound, exchange };
}
