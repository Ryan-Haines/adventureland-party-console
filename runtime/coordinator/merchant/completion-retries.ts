import { requestText } from "../http/contracts.ts";
import { failNpcSales } from "./npc-sales.ts";
import type {
  CompletionState,
  CompletionPorts,
  CompletionJob,
  CompletionReport,
} from "./completion-types.ts";

interface RetryDecision {
  realm: boolean;
  storageYield: boolean;
  anniversaryYield: boolean;
  rendezvous: boolean;
  interruptedCommerce: boolean;
  retry: boolean;
}
function retryRendezvous(job: CompletionJob, error: string): boolean {
  return (
    /rendezvous (?:route )?timed out/i.test(error) && (Number(job.rendezvousRetryCount) || 0) < 2
  );
}
function classify(job: CompletionJob, body: CompletionReport): RetryDecision {
  const failed = !body.success,
    error = requestText(body.error || "");
  const storageYield = failed && body.error === "bankboi_pending",
    anniversaryYield = failed && body.error === "merchant_anniversary_reserved";
  const interrupted = failed && error.toLowerCase() === "interrupted";
  const rendezvous = failed && retryRendezvous(job, error);
  const realm = realmFailure(body);
  return {
    realm,
    storageYield,
    anniversaryYield,
    rendezvous,
    interruptedCommerce: interrupted && job.reason === "merchant commerce",
    retry: realm || retryAllowed(job, storageYield || anniversaryYield || rendezvous, interrupted),
  };
}
function realmFailure(body: CompletionReport): boolean {
  return !body.success && requestText(body.error || "").startsWith("merchant job failed: wrong realm");
}
function retryAllowed(job: CompletionJob, yielded: boolean, interrupted: boolean): boolean {
  return (
    job.reason !== "npc sales" &&
    (yielded ||
      (interrupted && (job.reason === "merchant commerce" || (Number(job.retryCount) || 0) < 2)))
  );
}
function completionMessage(
  name: string | null,
  body: CompletionReport,
  decision: RetryDecision,
): string {
  if (decision.anniversaryYield) return "Merchant paused for anniversary; preserving job";
  if (decision.realm) return "Merchant target changed realm; preserving unfinished work";
  if (decision.rendezvous) return "Merchant rendezvous stalled; retrying in ten seconds";
  if (decision.storageYield) return "Merchant paused for Bankboi storage; preserving job";
  if (decision.interruptedCommerce) return "Merchant commerce interrupted; preserving it for retry";
  if (decision.retry) return "Merchant job interrupted; preserving it for retry";
  return "Merchant job " + (body.success ? "completed" : "failed") + " for " + name;
}
function resourceLimited(
  job: CompletionJob,
  body: CompletionReport,
  capacity: boolean,
  error: string,
): boolean {
  return (
    !body.success &&
    (capacity || /insufficient (?:bank )?gold/i.test(error)) &&
    ["upgrades and compounds", "manual upgrades", "auto upgrade", "manual compounds", "auto compound", "merchant commerce"].includes(job.reason)
  );
}
function retryIncrement(decision: RetryDecision): number {
  return decision.storageYield || decision.anniversaryYield || decision.rendezvous ? 0 : 1;
}

export function createCompletionRetries(state: CompletionState, ports: CompletionPorts) {
  function resourceBlock(job: CompletionJob, body: CompletionReport): void {
    const error = requestText(body.error || ""),
      capacity = /^(bank_full|inventory_full|no_space)$|^Couldn't use lucky slot:/i.test(error);
    if (!resourceLimited(job, body, capacity, error)) return;
    state.merchantJobBlocks[job.target + "\n" + job.reason] = {
      error: requestText(body.error),
      ...(capacity ? { capacitySignature: ports.capacitySignature(job.target) } : {}),
      bankGold: Number(state.bankSnapshot?.gold) || 0,
      merchantGold: Number(state.statuses[String(state.merchantCharacter)]?.gold) || 0,
    };
    ports.log(
      capacity
        ? "Improvement paused until inventory or bank contents change"
        : "Improvement paused until more gold is available",
      "error",
      { target: job.target, reason: job.reason, error: requestText(body.error) },
    );
  }
  function npcSales(job: CompletionJob, body: CompletionReport): void {
    if (!body.success && ["npc sales", "auto npc sales"].includes(job.reason)) {
      const attempted = state.commands[String(state.merchantCharacter)]?.npcSales || [];
      state.npcSaleMarks = failNpcSales(
        state.npcSaleMarks,
        attempted.map((mark) => mark.id),
        requestText(body.error || "NPC sale interrupted"),
        ports.now(),
      );
    }
    blockedSales(body);
  }
  function blockedSales(body: CompletionReport): void {
    for (const blocked of body.npcSalesBlocked || []) {
      const mark = state.npcSaleMarks.find((mark) => mark.id === blocked.id);
      if (mark) {
        mark.state = "blocked";
        mark.error = requestText(blocked.error || "Item unavailable");
        mark.blockedInventory = JSON.stringify(
          (state.statuses[String(state.merchantCharacter)]?.items || []).map(
            (entry) => entry && [entry.slot, entry.item],
          ),
        );
      }
    }
  }
  function decide(job: CompletionJob, body: CompletionReport): RetryDecision {
    resourceBlock(job, body);
    const decision = classify(job, body);
    npcSales(job, body);
    const level =
      decision.interruptedCommerce || decision.retry ? "info" : body.success ? "success" : "error";
    ports.log(completionMessage(job.target, body, decision), level, body.error);
    return decision;
  }
  function enqueue(job: CompletionJob, decision: RetryDecision): void {
    if (!decision.retry) return;
    const retry: CompletionJob = {
      ...job,
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      resumedFrom: job.id,
      retryCount: (Number(job.retryCount) || 0) + retryIncrement(decision),
      rendezvousRetryCount: (Number(job.rendezvousRetryCount) || 0) + (decision.rendezvous ? 1 : 0),
      retryAt: decision.rendezvous ? ports.now() + 10000 : 0,
      queuedAt: ports.now(),
    };
    if (decision.realm) {
      retry.realmAttempts = Number(job.realmAttempts || 0) + 1;
      retry.realmRetryExhausted = retry.realmAttempts >= 3;
      retry.retryAt = ports.now() + 10000;
    }
    delete retry.phase;
    delete retry.operationStage;
    delete retry.startedAt;
    delete retry.heartbeatAt;
    delete retry.progressAt;
    delete retry.checkpointAt;
    delete retry.handoff;
    delete retry.itemMarksCleared;
    state.merchantQueue.unshift(ports.stamp(retry));
    if (job.reason === "merchant luck")
      ports.log(
        "Retrying failed Merchant's Luck itinerary leg without returning to stand",
        "info",
        { target: job.target, attempt: (Number(job.retryCount) || 0) + 2 },
      );
  }
  return { decide, enqueue };
}
