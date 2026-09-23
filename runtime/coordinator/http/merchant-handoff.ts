import { collectionPickups, type PickupState } from "../merchant/collection-pickups.ts";
import { ruleOwner } from "../inventory/shared-rules.ts";
import { craftProtection } from "../merchant/craft-reservations.ts";
import { scopeWork } from '../merchant/command-scope.ts';
import { receiveDeconstruction, type DeconstructionMark } from "../merchant/deconstruction.ts";
import { receivePlayerSales } from "../merchant/player-npc-sales.ts";
import type { NpcSale } from "../merchant/npc-sales.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { MerchantWork } from "../merchant/work.ts";
import { admitMerchantInterruption } from "../navigation/merchant-interruption.ts";

interface HandoffJob extends MerchantWork {
  order?: { sources: Record<string, unknown> };
  handoff?: unknown;
  orderHandoff?: unknown;
}
interface HandoffState extends PickupState {
  statuses?: Record<string, (NonNullable<PickupState["statuses"]>[string] & { seenAt?: number; merchantServiceProtocol?: number }) | undefined>;
  npcSaleMarks?: NpcSale[];
  deconstructionMarks?: DeconstructionMark[];
  merchantCharacter: string | null;
  merchantCurrent: HandoffJob | null;
  merchantQueue?: HandoffJob[];
  activeConvoy?: { nonPreemptible?: boolean; participants: string[] } | null;
  commands: Record<
    string,
    { id: number; type: string; jobId?: unknown; [field: string]: unknown } | undefined
  >;
  marked: Record<string, unknown[] | undefined>;
  merchantMarked: Record<string, unknown[] | undefined>;
  autoItemMarks: Record<string, unknown>;
  upgrades: Record<string, unknown[] | undefined>;
  compounds: Record<string, unknown[] | undefined>;
  statScrolls: Record<string, unknown[] | undefined>;
  autoCompounds: NonNullable<PickupState["autoCompounds"]>;
  threshold: unknown;
  goldTargets: Record<string, number | undefined>;
}
interface HandoffPorts {
  now?(): number;
  nextCommand(): number;
  persist(): void;
  owned(name: string): unknown;
  queue(names: string[], reason: string): void;
  log(message: string, level: string): void;
}

export function createMerchantHandoffRoutes(state: HandoffState, ports: HandoffPorts) {
  function current(body: Record<string, unknown>, name: unknown): HandoffJob | null {
    const job = state.merchantCurrent;
    return job && body.jobId === job.id && name === job.target ? job : null;
  }
  function concurrent(name: string): boolean {
    const status = state.statuses?.[name];
    return status?.merchantServiceProtocol === 1 && (ports.now?.() ?? Date.now()) - (status.seenAt || 0) <= 3000;
  }
  function issue(name: string, job: HandoffJob, command: NonNullable<HandoffState["commands"][string]>): void {
    if (concurrent(name)) {
      command.concurrentService = true;
      (job.recipientServices ||= {})[name] = { ...command, jobId: job.id };
    } else state.commands[name] = command;
  }
  function issued(name: string) {
    return state.merchantCurrent?.recipientServices?.[name] || state.commands[name];
  }
  function waiting(name: string, jobId: unknown, res: HttpResponse): unknown {
    if (concurrent(name)) return null;
    if (admitMerchantInterruption(state, name, jobId, ports.now?.() ?? Date.now())) return null;
    ports.persist();
    return res.json({ ok: true, waiting: true, retryAfterMs: 3000, reason: "Recipient is travelling; waiting for concurrent-service runtime or arrival" });
  }
  function alreadyIssued(name: string, jobId: unknown, type: string): boolean {
    const command = issued(name);
    return command?.type === type && command.jobId === jobId;
  }
  function currentServiceReceipt(name: string, body: Record<string, unknown>): boolean {
    const service = state.merchantCurrent?.recipientServices?.[name];
    if (service) return service.id === body.commandId && service.jobId === body.jobId;
    const command = state.commands[name];
    return !command || command.jobId !== body.jobId || !body.commandId || command.id === body.commandId;
  }
  function clearCommand(name: string, body: Record<string, unknown>, type: string): void {
    const command = issued(name);
    if (
      command?.type === type &&
      command.jobId === body.jobId &&
      (!body.commandId || command.id === body.commandId)
    )
      {
        if (state.merchantCurrent?.recipientServices?.[name]?.id === command.id)
          delete state.merchantCurrent.recipientServices[name];
        else delete state.commands[name];
      }
  }
  function scopeHandoff(name: string, job: HandoffJob, command: NonNullable<HandoffState["commands"][string]>) {
    const scoped = scopeWork(job, command);
    if (!['marked items', 'inventory cleanout'].includes(job.reason)) scoped.marked = [];
    if (job.reason === 'npc sale pickup' || job.reason === 'auto npc sale pickup') {
      scoped.merchantMarked = (state.npcSaleMarks || []).filter(mark => mark.character === name && mark.source === 'character' && Boolean(mark.auto) === (job.reason === 'auto npc sale pickup')).map(mark => ({slot: mark.slot, item: mark.item}));
    } else if (job.reason !== 'marked items' && job.reason !== 'inventory cleanout' && job.reason !== 'deconstruction pickup') scoped.merchantMarked = [];
    if (['marked items', 'inventory cleanout'].includes(job.reason)) {
      const pickups = collectionPickups(state, name);
      scoped.marked = pickups.bank;
      scoped.merchantMarked = pickups.keep;
      scoped.craftProtection = craftProtection(state);
    }
    return scoped;
  }
  function handoffCommand(name: string, body: Record<string, unknown>, job: HandoffJob) {
    const command: NonNullable<HandoffState["commands"][string]> = {
      id: ports.nextCommand(),
      type: "merchant-handoff",
      jobId: body.jobId,
      merchant: state.merchantCharacter,
      autoItemMarks: state.merchantRules ? {} : state.autoItemMarks[ruleOwner(state, name)] || {},
      cleanout: job.reason === "inventory cleanout",
      threshold: state.threshold,
      goldTarget: Number.isSafeInteger(state.goldTargets[name]) ? state.goldTargets[name] : null,
      capacity:
        typeof body.capacity === "number" && Number.isSafeInteger(body.capacity)
          ? Math.max(0, body.capacity)
          : 0,
    };
    for (const key of [
      "marked",
      "merchantMarked",
      "upgrades",
      "compounds",
      "statScrolls",
      "autoCompounds",
    ] as const)
      command[key] = state[key][key === "autoCompounds" ? ruleOwner(state, name) : name] || [];
    return scopeHandoff(name, job, command);
  }

  function handoff(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body, body.target),
      name = requestText(body.target);
    if (!job) return res.status(409).json({ error: "merchant job is no longer current" });
    if (job.handoff || alreadyIssued(name, body.jobId, "merchant-handoff")) return res.json({ ok: true });
    const deferred = waiting(name, body.jobId, res);
    if (deferred) return deferred;
    job.phase = "handoff";
    job.handoff = null;
    issue(name, job, handoffCommand(name, body, job));
    ports.persist();
    return res.json({ ok: true });
  }
  function complete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = current(body, body.character),
      name = requestText(body.character);
    if (!job) return res.status(409).json({ error: "merchant job is no longer current" });
    if (!currentServiceReceipt(name, body)) return res.status(409).json({ error: "merchant service is no longer current" });
    if (job.handoff) return res.json({ ok: true });
    receiveDeconstruction({ deconstructionMarks: state.deconstructionMarks || [], merchantCharacter: state.merchantCharacter, merchantMarked: state.merchantMarked as import("../merchant/deconstruction.ts").DeconstructionState["merchantMarked"] }, name, body.kept, ports.now?.() ?? Date.now());
    receivePlayerSales({ npcSaleMarks: state.npcSaleMarks || [], merchantMarked: state.merchantMarked as import("../merchant/player-npc-sales.ts").PlayerSaleState["merchantMarked"] }, name, body.kept, ports.now?.() ?? Date.now());
    job.handoff = body;
    job.phase = "processing";
    clearCommand(name, body, "merchant-handoff");
    ports.persist();
    return res.json({ ok: true });
  }
  function cleanout(req: HttpRequest, res: HttpResponse): unknown {
    const name = requestText(requestObject(req.body).character);
    if (!ports.owned(name) || name === state.merchantCharacter)
      return res.status(400).json({ error: "unknown cleanout character" });
    if ([state.merchantCurrent, ...(state.merchantQueue || [])].some(job => job?.target === name &&
      ['inventory cleanout', 'marked items'].includes(job.reason))) return res.json({ok: true, alreadyQueued: true});
    ports.queue([name], "inventory cleanout");
    ports.log("Inventory cleanout queued for " + name, "info");
    return res.json({ ok: true });
  }
  function order(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent,
      name = requestText(body.target);
    if (
      !job ||
      job.id !== body.jobId ||
      job.reason !== "merchant commerce" ||
      !body.target ||
      !job.order?.sources[name]
    )
      return res.status(409).json({ error: "merchant commerce job is no longer current" });
    if (alreadyIssued(name, body.jobId, "merchant-order-handoff")) return res.json({ ok: true });
    const deferred = waiting(name, body.jobId, res);
    if (deferred) return deferred;
    issue(name, job, {
      id: ports.nextCommand(),
      type: "merchant-order-handoff",
      jobId: body.jobId,
      merchant: state.merchantCharacter,
      items: job.order.sources[name],
    });
    job.orderHandoff = null;
    job.phase = "collecting materials from " + name;
    ports.persist();
    return res.json({ ok: true });
  }
  function orderComplete(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      job = state.merchantCurrent;
    if (!job || job.id !== body.jobId)
      return res.status(409).json({ error: "merchant commerce job is no longer current" });
    if (!currentServiceReceipt(requestText(body.character), body)) return res.status(409).json({ error: "merchant service is no longer current" });
    job.orderHandoff = { character: body.character, sent: body.sent || [] };
    clearCommand(requestText(body.character), body, "merchant-order-handoff");
    ports.persist();
    return res.json({ ok: true });
  }
  return { handoff, complete, cleanout, order, orderComplete };
}
