import { offeringStock } from '../inventory/offering-stock.ts';
import type { OfferingRulesState } from '../inventory/upgrade-offerings.ts';
import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import { craftProtection, type CraftReservationState } from "../merchant/craft-reservations.ts";
import { sharedCompoundRules, type BankImprovementState } from "../merchant/banked-improvements.ts";
import { itemRuleConflicts } from "../inventory/shared-rules.ts";
import { operationStage } from '../merchant/activity.ts';
import { collectionPickups, type PickupState } from '../merchant/collection-pickups.ts';

interface ProgressState extends CraftReservationState, PickupState, OfferingRulesState {
  autoCompounds?: BankImprovementState['autoCompounds'];
  merchantRules?: BankImprovementState['merchantRules'];
  merchantAutomations?: Record<string, boolean | undefined>;
  merchantCharacter: string | null;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
  statuses: NonNullable<PickupState['statuses']>;
  gatheringModes: string[];
  gatheringCooldowns: Record<string, number | undefined>;
  commands: Record<string, unknown>;
}
interface ProgressPorts {
  now(): number;
  priority(job: MerchantWork): number;
  routinePriority(mode: string): number;
  persist(): void;
  stamp(job: MerchantWork): MerchantWork;
  log(message: string, level: string, details: unknown): void;
  dispatch(): void;
}

export function createMerchantProgressRoutes(state: ProgressState, ports: ProgressPorts) {
  function nextTarget(job: MerchantWork): string | null {
    const next = job.batchId
      ? state.merchantQueue.find((candidate) => candidate.batchId === job.batchId) || null
      : state.merchantQueue[0] || null;
    return next && (job.batchId ? next.batchId === job.batchId : next.reason === job.reason)
      ? next.target
      : null;
  }
  function job(req: HttpRequest, res: HttpResponse): unknown {
    const current = state.merchantCurrent;
    if (!current || req.params.id !== current.id)
      return res.status(404).json({ error: "merchant job not found" });
    const target = typeof req.query?.target === "string" ? req.query.target : current.target;
    return res.json({
      ...current,
      targetStatus: state.statuses[String(target)] || null,
      nextCollectionTarget: nextTarget(current),
      craftProtection: craftProtection(state),
      ...(['marked items', 'inventory cleanout'].includes(current.reason) ? {collectionPickups: collectionPickups(state, String(target))} : {}),
    });
  }
  function heartbeat(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!current || body.jobId !== current.id)
      return res.status(409).json({ error: "merchant job is no longer current" });
    current.heartbeatAt = ports.now();
    const stage = operationStage(body.operationStage);
    if (stage && current.target === state.merchantCharacter) current.operationStage = stage;
    if (Number.isFinite(Number(body.progressAt)))
      current.progressAt = Math.min(ports.now(), Number(body.progressAt));
    if (current.phase === "assigned") current.phase = "processing";
    return res.json({ ok: true });
  }
  function priorities(current: MerchantWork) {
    const currentPriority = ports.priority(current),
      queuedPriority = state.merchantQueue.reduce(
        (highest, job) => Math.max(highest, ports.priority(job)),
        -1,
      );
    const gathering = state.gatheringModes.filter(
      (mode) => Number(state.gatheringCooldowns[mode] || 0) <= ports.now(),
    );
    const gatheringPriority = gathering.reduce(
      (highest, mode) => Math.max(highest, ports.routinePriority(mode)),
      -1,
    );
    return {
      currentPriority,
      waitingPriority: Math.max(queuedPriority, gatheringPriority),
      waitingType: gatheringPriority > queuedPriority ? "gathering" : "queue",
    };
  }
  function pause(current: MerchantWork, currentPriority: number, waitingPriority: number): void {
    const paused: MerchantWork = { ...current, queuedAt: Number(current.queuedAt) || ports.now() };
    delete paused.phase;
    delete paused.operationStage;
    delete paused.startedAt;
    delete paused.checkpointAt;
    delete paused.handoff;
    state.merchantQueue.push(ports.stamp(paused));
    delete state.commands[String(state.merchantCharacter)];
    state.merchantCurrent = null;
    ports.log("Paused " + paused.reason + " for a higher-priority routine", "info", {
      priority: currentPriority,
      waitingPriority,
    });
    ports.persist();
    ports.dispatch();
  }
  function checkpoint(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      current = state.merchantCurrent;
    if (!current || body.jobId !== current.id)
      return res.status(409).json({ error: "merchant job is no longer current" });
    if (body.protectionOnly === true) {
      if (current.itemMarksCleared) return res.status(409).json({ error: "Item marks cleared; refresh merchant work" });
      return res.json(protectionReply(state));
    }
    current.resumeState = body.state && typeof body.state === "object" ? body.state : {};
    current.phase = "checkpointed";
    current.checkpointAt = ports.now();
    current.progressAt = ports.now();
    const { currentPriority, waitingPriority, waitingType } = priorities(current);
    if (waitingPriority <= currentPriority) {
      current.phase = "processing";
      delete current.checkpointAt;
      ports.persist();
      return res.json({ yield: false, currentPriority, waitingPriority, waitingType });
    }
    pause(current, currentPriority, waitingPriority);
    return res.json({ yield: true, currentPriority, waitingPriority });
  }
  return { job, heartbeat, checkpoint };
}

function protectionReply(state: ProgressState) {
  const compoundState = {...state, autoCompounds: state.autoCompounds || {}};
  const compoundRules = state.merchantAutomations?.['auto compound'] === false ? [] : sharedCompoundRules(compoundState)
    .filter(rule => Number(rule.quantity) !== 0);
  const compoundBlocked = compoundRules.flatMap(rule => Array.from({length: rule.targetTier || 1}, (_, level) => ({name:rule.name,level})))
    .filter(item => itemRuleConflicts(compoundState,item).length);
  return {craftProtection: craftProtection(state), compoundRules, compoundBlocked,
    upgradeOfferingRules: state.upgradeOfferingRules || [], upgradeOfferingStock: offeringStock(state)};
}
