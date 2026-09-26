import { availableCraftStock, type CraftNeed, type CraftProtection } from "../../craft-reservations.ts";
import type { MaterialOrder, OrderChoice } from "./order-types.ts";
export { availableCraftStock };
interface Job { id?: string; order?: unknown; resumeState?: unknown; queuedAt?: number }
interface Progress {phase?: string; craftIndex?: number; crafted?: number}
export interface CraftReservationState {
  merchantDeliveries?: Record<string, unknown[] | undefined>;
  merchantCharacter?: string | null;
  merchantCurrent?: Job | null;
  merchantQueue?: Job[];
  merchantCatalog?: { craftable?: OrderChoice[] } | null;
}
function allocations(job: Job, merchant: string | null | undefined, requirements: CraftNeed[]): NonNullable<CraftProtection["allocations"]> {
  const order = job.order as MaterialOrder | undefined;
  if (!order?.crafts?.length) return [];
  const phase = (job.resumeState as Progress | undefined)?.phase;
  if (["leveling", "crafting"].includes(String(phase)))
    return requirements.map(need => ({...need, location: "inventory:" + merchant}));
  const sources = [
    ...(order.inventory || []).map(mark => ({...mark, location: "inventory:" + merchant})),
    ...Object.entries(order.sources || {}).flatMap(([name, marks]) => marks.map(mark => ({...mark, location: "inventory:" + name}))),
    ...(order.bank || []).map(mark => ({...mark, location: mark.pack})),
    ...(order.storage || []).filter(mark => !mark.resolved).map(mark => ({...mark, location: mark.pack})),
  ];
  return sources.map(mark => ({id: String(mark.item.name), level: Number(mark.item.level) || 0, quantity: mark.quantity, location: mark.location}));
}
function remainingCount(quantity: number, index: number, progress?: Progress): number {
  if (progress?.phase !== "crafting") return quantity;
  const current = Number(progress.craftIndex) || 0;
  if (index < current) return 0;
  return Math.max(0, quantity - (index === current ? Number(progress.crafted) || 0 : 0));
}
function needs(job: Job, choices: OrderChoice[]): CraftNeed[] {
  const order = job.order as MaterialOrder | undefined;
  if (!order?.crafts?.length) return [];
  const progress = job.resumeState as Progress | undefined;
  if (progress?.phase !== "crafting" && order.requirements?.length) return order.requirements;
  return order.crafts.flatMap((line, index) => {
    const count = remainingCount(line.quantity, index, progress);
    if (!count) return [];
    const recipe = order.craftMaterials?.[index] || choices.find(choice => choice.id === line.id)?.materials;
    if (!recipe) throw Error("Cannot protect crafting ingredients: recipe missing for " + line.id);
    return recipe.map(material => ({...material, quantity: material.quantity * count}));
  });
}
/** Derived from durable jobs, so pauses, cancellation, and restarts share one reservation lifetime. */
export function craftProtection(state: CraftReservationState, excludeJob?: string): CraftProtection {
  const jobs = [state.merchantCurrent, ...(state.merchantQueue || [])].filter((job): job is Job => !!job && (!excludeJob || job.id !== excludeJob));
  const seen = new Set<string>();
  const requirements: CraftNeed[] = [];
  const reserved: NonNullable<CraftProtection["allocations"]> = [];
  try {
    for (const job of jobs.sort((a,b) => (a.queuedAt || 0) - (b.queuedAt || 0))) {
      if (job.id && seen.has(job.id)) continue;
      if (job.id) seen.add(job.id);
      const remaining = needs(job, state.merchantCatalog?.craftable || []);
      requirements.push(...remaining);
      reserved.push(...allocations(job, state.merchantCharacter, remaining));
      const pending = pendingCommerceStock(job);
      requirements.push(...pending);
      reserved.push(...pending.map(need => ({...need, location: 'inventory:' + state.merchantCharacter})));
    }
    return protectDeliveries(state, {requirements, allocations: reserved});
  } catch (error) { return {requirements, error: String(error instanceof Error ? error.message : error)}; }
}

function deliveryProtection(state: CraftReservationState): NonNullable<CraftProtection['deliveries']> {
  return Object.entries(state.merchantDeliveries || {}).flatMap(([recipient,marks]) => (marks || []).flatMap(raw => {
    const mark = raw as {item?: import('../contracts/item.ts').Item; slot?: number; awaitingEquip?: boolean};
    return mark.item ? [{item:mark.item, slot:mark.awaitingEquip ? undefined : mark.slot,
      location:'inventory:' + (mark.awaitingEquip ? recipient : state.merchantCharacter)}] : []; }));
}

function protectDeliveries(state: CraftReservationState, protection: CraftProtection): CraftProtection {
  const deliveries = deliveryProtection(state).concat(commerceProtection(state));
  return deliveries.length ? {...protection, deliveries} : protection;
}

function commerceProtection(state: CraftReservationState): NonNullable<CraftProtection['deliveries']> {
  return [state.merchantCurrent, ...(state.merchantQueue || [])].flatMap(job => {
    if (!job) return [];
    const progress = job.resumeState as {results?: {slot?: number; item: import('../contracts/item.ts').Item}[];
      activeSlot?: number; activeItem?: import('../contracts/item.ts').Item;
      pendingUpgrade?: {level: number}; pendingPurchase?: {base?: boolean; name: string}} | undefined;
    if (!progress) return [];
    const owned = [...(progress.results || [])];
    if (progress.activeItem) {
      owned.push({slot: progress.activeSlot, item: progress.activeItem});
      if (progress.pendingUpgrade) owned.push({slot: progress.activeSlot,
        item: {...progress.activeItem, level: progress.pendingUpgrade.level}});
    }
    if (progress.pendingPurchase?.base) owned.push({item: {name: progress.pendingPurchase.name as import('../contracts/item.ts').Item['name'], level: 0}});
    return owned.map(mark => ({...mark, location: 'inventory:' + state.merchantCharacter}));
  });
}

function pendingCommerceStock(job: Job): CraftNeed[] {
  const progress = job.resumeState as {pendingPurchase?: {name: string; quantity: number; before: number}} | undefined;
  const pending = progress?.pendingPurchase;
  return pending ? [{id: pending.name, quantity: pending.before + pending.quantity}] : [];
}
