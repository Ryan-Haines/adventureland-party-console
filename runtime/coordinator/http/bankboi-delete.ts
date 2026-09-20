import { requestObject, requestText, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { BankboiInventory } from "../inventory/bankboi-completion.ts";

interface DeletionState {
  bankbois: Record<string, BankboiInventory | undefined>;
  bankboiQueue: { bankboi?: string }[];
  bankboiTransaction: { bankboi: string } | null;
}
interface DeletionPorts {
  now(): number;
  request(name: string): Promise<{ ok: boolean; statusText: string; payload: unknown }>;
  refresh(): Promise<unknown>;
  owned(name: string): unknown;
  persist(): void;
}

function occupied(entry: BankboiInventory): boolean {
  return (
    !!(entry.items || []).some(Boolean) ||
    !!Object.keys(entry.slots || {}).length ||
    !!Number(entry.gold)
  );
}
function failureMessage(messages: unknown): Record<string, unknown> | undefined {
  return Array.isArray(messages)
    ? messages
        .map(requestObject)
        .find(
          (message) => message.type === "ui_error" || message.type === "error" || message.reason,
        )
    : undefined;
}
function deletionFailure(payload: unknown, ok: boolean, statusText: string): string | null {
  const body = requestObject(payload),
    messages = Array.isArray(payload) ? payload : body.infs;
  const failure = failureMessage(messages);
  if (ok && !failure && !body.failed) return null;
  return requestText(failure?.reason || failure?.message || body.reason || statusText);
}

export function createBankboiDeleteRoute(state: DeletionState, ports: DeletionPorts) {
  async function remove(name: string, res: HttpResponse): Promise<unknown> {
    try {
      const reply = await ports.request(name),
        failure = deletionFailure(reply.payload, reply.ok, reply.statusText);
      if (failure !== null) throw new Error(failure);
      await ports.refresh();
      if (ports.owned(name)) throw new Error("deletion was not confirmed by the account roster");
      delete state.bankbois[name];
      ports.persist();
      return res.json({ ok: true });
    } catch (error) {
      return res.status(502).json({ error: requestText(requestObject(error).message || error) });
    }
  }
  return async function deleteBankboi(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const name = req.params.name!,
      entry = state.bankbois[name];
    if (!entry) return res.status(404).json({ error: "unknown bankboi" });
    if (
      occupied(entry) ||
      state.bankboiQueue.some((request) => request.bankboi === name) ||
      state.bankboiTransaction?.bankboi === name
    )
      return res
        .status(409)
        .json({ error: "bankboi must have no inventory, equipment, gold, or pending work" });
    const deletionAvailableAt = Number(entry.createdAt) + 180 * 60 * 1000;
    if (Number(entry.createdAt) && ports.now() < deletionAvailableAt)
      return res
        .status(409)
        .json({
          error: "bankboi deletion unlocks after the 180-minute character cooldown",
          deletionAvailableAt,
        });
    return remove(name, res);
  };
}
