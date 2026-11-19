// The job owner's command bodies:
// the wire payload each job sends, built from the job, the coordinator's inputs and the kind's
// record (rules.ts JOB_KINDS). A kind's command type, its dispatch line and its own fields are the kind record's;
// the in-place stand sync is the one per-job case.
import { type MerchantWork, type CharacterWork, type CommandInputs, type MerchantCommand, type ServiceStatus } from './owner.ts';
import { ADDON_STEPS, addonKind, merchantKind, normalizePickupJob, routineFor, type RoutineJob } from '../rules.ts';

// A stand maintenance job that syncs the stand where it stands sends its own command and listings.
const inPlaceStandSync = (job: MerchantWork) => job.reason === "stand maintenance" && !!job.inPlaceStandSync;

export function ownCommandType(job: MerchantWork): string {
  if (inPlaceStandSync(job)) return "merchant-stand-sync";
  return merchantKind(job.reason).command || "merchant-self-improve";
}

// The dispatch's line: the kind's line, or an own improvement's.
export function ownCommandDescription(job: MerchantWork): string {
  if (inPlaceStandSync(job)) return "Merchant synchronizing marked inventory into persistent stand storage";
  const line = merchantKind(job.reason).line;
  return (typeof line === 'function' ? line(job) : line) || "Merchant dispatched for its own upgrades and compounds";
}

/** Keep separately prioritized work out of another routine's command. */
export function scopeWork<T extends Record<string, unknown>>(job: RoutineJob, value: T): T {
  const result: Record<string, unknown> = {...value}, routine = routineFor(job);
  const allowed: Record<string, boolean> = {
    upgrades: routine === 'manual upgrades' || routine === 'auto upgrade', statScrolls: routine === 'manual upgrades',
    preloadStatScrolls: routine === 'manual upgrades', bankUpgradeRules: routine === 'auto upgrade',
    compounds: routine === 'manual compounds', autoCompounds: routine === 'auto compound',
    purchases: routine === 'manual buying',
    npcSales: routine === 'npc sales' || routine === 'auto npc sales',
  };
  for (const [key, permit] of Object.entries(allowed)) if (!permit && key in result) result[key] = [];
  if (Array.isArray(result.upgrades)) result.upgrades = result.upgrades.filter(mark => Boolean(mark?.auto) === (routine === "auto upgrade"));
  if (Array.isArray(result.npcSales)) result.npcSales = result.npcSales.filter(mark => Boolean(mark.auto) === (routine === 'auto npc sales'));
  return result as T;
}

// The merchant's bank errands carry the items owner's visit plan: this job's withdrawals, then the
// next ready jobs', then the marked ones, while the bag holds them. The gold target is the items owner's working
// gold: your gold target, the stand's funding and the gold the ready jobs on its
// realm need, so the errands keep it between jobs.
function merchantSupplies(inputs: CommandInputs, job: MerchantWork) {
  const work = inputs.work(inputs.merchant);
  return {
    merchantGoldTarget: inputs.workingGold,
    ...(inputs.craftProtection ? {craftProtection: inputs.craftProtection} : {}),
    merchantWithdrawals: inputs.visitWithdrawals(job),
    merchantBankMarked: work.marked,
    npcSales: inputs.npcSales,
  };
}

function improvements(work: CharacterWork) {
  return {
    upgrades: work.upgrades,
    purchases: work.purchases,
    statScrolls: work.statScrolls,
    compounds: work.compounds,
    autoCompounds: work.autoCompounds,
  };
}

function purchaseDetails(job: MerchantWork, inputs: CommandInputs) {
  const purchase = merchantKind(job.reason).purchase;
  return {
    listings: inPlaceStandSync(job) ? inputs.standListings : purchase ? job.listings : undefined,
    bidItemId: purchase === 'bid' ? job.bidItemId : undefined,
  };
}

function marketplaceDetails(job: MerchantWork, inputs: CommandInputs) {
  const { market: travelling, resumable } = merchantKind(job.reason);
  return {
    // The home realm is read when the command is built, so a job queued before a party realm
    // switch goes home to the new realm.
    aldataHomeRealm: travelling ? inputs.activeRealm : undefined,
    completedListingKeys: resumable ? job.completedListingKeys || [] : undefined,
  };
}

/** Builds the existing self-service wire payload without owning inventory execution. */
export function ownMerchantCommand(id: number, job: MerchantWork, inputs: CommandInputs): MerchantCommand {
  if (job.reason === "upgrade preview") return {id,type:"merchant-upgrade-preview",jobId:job.id,upgradePreview:job.upgradePreview};
  const work = inputs.work(job.target), kind = merchantKind(job.reason);
  return scopeWork(job, {
    id,
    type: ownCommandType(job),
    jobId: job.id,
    ...(kind.processing ? {processingRoutine: job.reason} : {}),
    ...purchaseDetails(job, inputs),
    ...marketplaceDetails(job, inputs),
    ...merchantSupplies(inputs, job),
    goldTarget: inputs.workingGold,
    ...kind.details?.(job, inputs),
    ...improvements(work),
    ...sharedImprovements(job, inputs),
    buyUpgradeBatchSize: inputs.buyUpgradeBatchSize ?? 1,
    order: job.order || null,
    resumeState: job.resumeState || null,
    ...commerceDetails(job),
    preloadStatScrolls: work.statScrolls,
    ...(job.capacityRecovery ? { capacityRecovery: true, merchantWithdrawals: [], withdrawals: [], npcSales: [] } : {}),
  });
}

function sharedImprovements(job: MerchantWork, inputs: CommandInputs) {
  return {
    ...(inputs.sharedAutoCompounds ? { autoCompounds: inputs.sharedAutoCompounds, sharedBankImprovements: true } : {}),
    ...(job.reason === "auto upgrade" && inputs.bankUpgradeRules?.length ? { bankUpgradeRules: inputs.bankUpgradeRules } : {}),
  };
}

function clusterOptions(job: MerchantWork) {
  return {
    cleanout: job.reason === "inventory cleanout",
    expandLeaderCluster: !!job.expandLeaderCluster,
    expandMarkedCluster: job.reason === "marked items" && !job.clusterExpanded,
    expandLuckCluster: !!merchantKind(job.reason).luck && job.expandLuckCluster !== false,
    castMerchantLuck: !!merchantKind(job.reason).luck && job.castMerchantLuck !== false,
  };
}

export function partyMerchantCommand(
  id: number,
  job: MerchantWork,
  status: ServiceStatus,
  inputs: CommandInputs,
): MerchantCommand {
  job = normalizePickupJob(job, inputs.merchant);
  const work = inputs.work(job.target);
  return scopeWork(job, {
    id,
    type: "merchant-service",
    ...(merchantKind(job.reason).collects ? {collectionOnly: true} : {}),
    targetRealm: status.server,
    jobId: job.id,
    target: job.target,
    targetLocation: { map: status.map, x: status.x, y: status.y },
    marked: work.marked,
    ...improvements(work),
    ...merchantSupplies(inputs, job),
    ...clusterOptions(job),
    withdrawals: work.withdrawals,
    goldTarget: work.goldTarget,
    targetGold: status.gold,
    threshold: inputs.threshold,
    restock: inputs.restock(job.target),
    targetInventory: status.items || [],
    gatheringModes: inputs.gatheringModes,
    cargo: inputs.cargo,
    merchantDeliveries: work.deliveries,
    preloadStatScrolls: Object.entries(inputs.statScrolls).flatMap(([owner, marks]) =>
      (marks || []).map((mark) => ({ ...mark, owner })),
    ),
  });
}

export function luckMerchantCommand(id: number, job: MerchantWork, status: ServiceStatus): MerchantCommand {
  return {
    id,
    type: "merchant-mluck",
    jobId: job.id,
    target: job.target,
    targetLocation: { map: status.map, x: status.x, y: status.y },
    npcSales: [],
  };
}

function commerceDetails(job: MerchantWork) {
  return job.commerceProgressVersion === 2 ? {commerceProgressVersion: 2, commerceOrderId: job.commerceOrderId} : {};
}

// The `addon-steps` body: the add-on's fields and steps whole, the steps already run (the job's
// resume state, so a paused job resumes at its next step), the kind's spend consent and a listing
// kind's realm, which the merchant hops to before the first step. It carries none of the core kinds'
// work.
export function addonStepsCommand(id: number, job: MerchantWork): MerchantCommand {
  const kind = addonKind(job.reason), resume = job.resumeState as { done?: unknown } | null | undefined;
  return { id, type: ADDON_STEPS, jobId: job.id, addon: kind?.addon ?? null, kind: kind ? job.reason.slice(`addon:${kind.addon}:`.length) : job.reason, target: job.target,
    fields: job.addonFields ?? {}, steps: job.addonSteps ?? [], done: Array.isArray(resume?.done) ? resume.done : [],
    spends: job.addonSpends === true, ...(job.realm ? { realm: job.realm } : {}) };
}
