import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { createStandMarks, type StandMarkState } from "../merchant/stand-marks.ts";
import { storagePack } from "../inventory/storage-source.ts";
import type { Item } from "../contracts/item.ts";

interface StandPorts {
  now(): number;
  nextCommand(): number;
  persist(): void;
  publish(): void;
  bankService(): Promise<unknown>;
  log(message: string, level: string, details: unknown): void;
  queue(names: (string | null)[], reason: string): void;
  syncStand(): boolean;
  idle(): void;
}
function validPrice(price: number, quantity: number): boolean {
  return (
    Number.isSafeInteger(price) &&
    price >= 1 &&
    price <= 1000000000000 &&
    Number.isSafeInteger(quantity) &&
    quantity >= 1 &&
    quantity <= 9999
  );
}

export function createStandMarkRoute(state: StandMarkState, ports: StandPorts) {
  const marks = createStandMarks(state, {
    now: () => ports.now(),
    nextCommand: () => ports.nextCommand(),
  });
  function needsWithdrawal(pack: string | null, body: Record<string, unknown>): boolean {
    return (
      !!(pack || body.markAll === true) &&
      body.remove !== true &&
      !!state.merchantCharacter &&
      !!(state.withdrawals[String(state.merchantCharacter)] || []).length
    );
  }
  function schedule(pack: string | null, body: Record<string, unknown>): void {
    if (pack?.startsWith("bankboi:") && body.remove !== true)
      ports
        .bankService()
        .catch((error) =>
          ports.log("Could not schedule bankboi retrieval", "error", {
            error: requestObject(error).message,
          }),
        );
    else if (needsWithdrawal(pack, body))
      ports.queue([state.merchantCharacter], "manual bank exchange");
    else if (!ports.syncStand()) ports.idle();
  }
  function update(
    body: Record<string, unknown>,
    item: Item,
    slot: number,
    pack: string | null,
  ): string | null {
    const id = typeof body.id === "string" ? body.id : null,
      index = marks.find(id, pack, slot, item);
    if (body.remove === true) {
      marks.remove(index, pack, slot, item);
      return null;
    }
    const price = Number(body.price),
      quantity = Number(body.quantity || 1);
    if (!validPrice(price, quantity)) return "invalid stand price or quantity";
    if (body.markAll === true) marks.markAll(item, price);
    else if (!marks.single(index, id, pack, slot, item, price, quantity))
      return "merchant stand is full (16/16)";
    return null;
  }
  return function stand(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body),
      slot = Number(body.slot),
      pack = storagePack(body.bankPack),
      item = requestObject(body.item);
    if (typeof item.name !== "string" || !Number.isSafeInteger(slot) || slot < 0)
      return res.status(400).json({ error: "invalid stand item" });
    const error = update(body, item, slot, pack);
    if (error)
      return res.status(error === "merchant stand is full (16/16)" ? 409 : 400).json({ error });
    ports.persist();
    ports.publish();
    schedule(pack, body);
    return res.json({ ok: true, standListings: state.standListings });
  };
}
