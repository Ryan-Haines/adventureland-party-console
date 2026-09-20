import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import {
  createStandReconciliation,
  type StandReconciliationState,
} from "../merchant/stand-reconciliation.ts";
import type { Item, InventoryEntry } from "../contracts/item.ts";

interface IdleState extends StandReconciliationState {
  commands: Record<string, { id?: unknown; type: string } | undefined>;
}
interface IdlePorts {
  sameItem(first: Item, second: Item | null | undefined): boolean;
  log(message: string, level: string, details?: unknown): void;
  persist(): void;
  queue(names: (string | null)[], reason: string): void;
}
function failureMessage(body: Record<string, unknown>, interrupted: boolean): string {
  if (interrupted) return "Stand return interrupted; retrying";
  return body.stage === "stand" ? "Could not update stand" : "Could not return to stand";
}
export function createMerchantIdleRoute(state: IdleState, ports: IdlePorts) {
  const stand = createStandReconciliation(state, ports);
  function clearIdle(commandId?: unknown): void {
    const command = state.commands[String(state.merchantCharacter)];
    if (command?.type === "merchant-idle" && (!commandId || command.id === commandId))
      delete state.commands[String(state.merchantCharacter)];
  }
  function complete(body: Record<string, unknown>): void {
    const live = new Map<string, unknown>();
    for (const raw of Array.isArray(body.liveListings) ? body.liveListings : []) {
      const entry = requestObject(raw);
      if (typeof entry.id === "string") live.set(entry.id, entry.tradeSlot);
    }
    stand.reconcile(
      live,
      (Array.isArray(body.inventory) ? body.inventory : []) as (InventoryEntry | null)[],
    );
    const needsWithdrawal = stand.withdrawals();
    clearIdle(body.commandId);
    if (needsWithdrawal) ports.queue([state.merchantCharacter], "manual bank exchange");
  }
  function phase(body: Record<string, unknown>): boolean {
    if (body.phase === "returning") ports.log("Returning to stand", "info");
    else if (body.phase === "arrived") ports.log("At stand", "info");
    else if (body.phase === "inventory-recovery") {
      ports.log("Inventory recovery required", "error", body.error);
      clearIdle(body.commandId);
    }
    else if (body.phase === "failed") {
      const interrupted = requestText(body.error || "").toLowerCase() === "interrupted";
      ports.log(
        failureMessage(body, interrupted),
        interrupted ? "info" : "error",
        body.error,
      );
      clearIdle();
      if (body.error === "no_space") ports.queue([state.merchantCharacter], "manual bank exchange");
    } else if (body.phase === "complete") complete(body);
    else return false;
    return true;
  }
  return function idle(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!merchant || body.character !== merchant)
      return res.status(409).json({ error: "merchant is no longer configured" });
    const command = state.commands[merchant];
    if (body.commandId && command && command.id !== body.commandId)
      return res.status(409).json({ error: "merchant idle command is no longer current" });
    if (!phase(body)) return res.status(400).json({ error: "invalid idle phase" });
    ports.persist();
    return res.json({ ok: true });
  };
}
