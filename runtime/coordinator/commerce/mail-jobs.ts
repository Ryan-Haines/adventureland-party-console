import type { Item, InventoryEntry } from "../contracts/item.ts";
import type { MerchantWork } from "../merchant/work.ts";
import { requestObject } from "../http/contracts.ts";
import type { WithdrawalRequest } from "../inventory/exchange-storage.ts";

export interface OutgoingMail {
  recipient: string;
  subject: string;
  message: string;
  quantity?: number;
  source?: { pack: string; slot: number; item: Item };
}
export interface MailJobState {
  merchantCharacter: string | null;
  merchantQueue: MerchantWork[];
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankbois: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  withdrawals: Record<string, WithdrawalRequest[] | undefined>;
}
export interface MailJobPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  persist(): void;
  persistBank(): void;
  dispatch(): void;
  bankboi(): Promise<unknown>;
  log(message: string, level: string, details?: unknown): void;
}
export function createMailJobs(state: MailJobState, ports: MailJobPorts) {
  function entry(pack: string, slot: number): InventoryEntry | undefined {
    let entries = state.bankSnapshot?.packs?.[pack];
    if (pack === "merchant") entries = state.statuses[String(state.merchantCharacter)]?.items;
    else if (pack.startsWith("bankboi:")) entries = state.bankbois[pack.slice(8)]?.items;
    return entries?.find((value) => value?.slot === slot) || undefined;
  }
  function stage(job: MerchantWork, source: NonNullable<OutgoingMail["source"]>): void {
    (state.withdrawals[String(state.merchantCharacter)] ||= []).push({
      ...source,
      mailJobId: job.id,
    });
    ports.persistBank();
    void ports
      .bankboi()
      .catch((error: unknown) =>
        ports.log("Could not stage mail attachment", "error", requestObject(error).message),
      );
  }
  function send(mail: OutgoingMail): MerchantWork {
    const blocked = mail.source?.pack.startsWith("bankboi:") || false;
    const job = ports.stamp({
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: "send mail",
      queuedAt: ports.now(),
      mail,
      ...(mail.source ? { blockedOnBankboi: blocked } : {}),
    });
    state.merchantQueue.push(job);
    if (blocked) stage(job, mail.source!);
    if (mail.source)
      ports.log(
        "Queued mail to " +
          mail.recipient +
          " with " +
          mail.quantity +
          " × " +
          mail.source.item.name,
        "info",
      );
    ports.persist();
    ports.dispatch();
    return job;
  }
  function collect(mail: { id: string; item?: Item | null }): void {
    if (!state.merchantCharacter) throw new Error("Configure a merchant first");
    state.merchantQueue.push(
      ports.stamp({
        id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
        target: state.merchantCharacter,
        reason: "collect mail",
        manual: true,
        queuedAt: ports.now(),
        mail: { id: mail.id, item: mail.item },
      }),
    );
    ports.persist();
    ports.dispatch();
  }
  return { entry, send, collect };
}
