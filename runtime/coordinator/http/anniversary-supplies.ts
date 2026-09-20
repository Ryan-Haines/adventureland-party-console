import { anniversarySlices } from "../anniversary/contracts.ts";
import type { InventoryEntry } from "../contracts/item.ts";
import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";

interface Withdrawal extends InventoryEntry {
  pack: string;
}
interface SuppliesState {
  merchantCharacter: string | null;
  withdrawals: Record<string, Withdrawal[] | undefined>;
  bankbois?: Record<string, { name: string; items?: (InventoryEntry | null)[] }>;
}
interface SuppliesPorts {
  counts(): Record<string, number>;
  persist(): void;
  log(message: string, level: string, details: unknown): void;
}

function validRequest(
  body: Record<string, unknown>,
  merchant: string | null,
): body is Record<string, unknown> & { missing: string[] } {
  return (
    !!merchant &&
    body.character === merchant &&
    Array.isArray(body.missing) &&
    body.missing.every((name) => anniversarySlices.includes(name))
  );
}

export function createAnniversarySuppliesRoute(state: SuppliesState, ports: SuppliesPorts) {
  function withdraw(
    name: string,
    counts: Record<string, number>,
    withdrawals: Withdrawal[],
  ): boolean {
    if (withdrawals.some((request) => request.item?.name === name)) return true;
    const worker = Object.values(state.bankbois || {}).find((worker) =>
      (worker.items || []).some((entry) => entry?.item?.name === name),
    );
    const entry = worker?.items?.find((entry) => entry?.item?.name === name);
    if (!entry || !worker || !(counts[name]! > 0)) return false;
    withdrawals.push({ pack: "bankboi:" + worker.name, slot: entry.slot, item: { ...entry.item } });
    ports.log("Requested anniversary ingredient from bankboi", "info", {
      item: name,
      bankboi: worker.name,
    });
    return true;
  }

  return function supplies(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      merchant = state.merchantCharacter;
    if (!validRequest(body, merchant))
      return res.status(400).json({ error: "invalid anniversary supply request" });
    const withdrawals = (state.withdrawals[String(merchant)] ||= []),
      counts = ports.counts();
    const pending: string[] = [],
      missing: string[] = [];
    for (const name of new Set(body.missing))
      (withdraw(name, counts, withdrawals) ? pending : missing).push(name);
    ports.persist();
    // Scheduling waits for the craft attempt to release the merchant's busy state.
    return res.json({ ok: true, pending, missing });
  };
}
