import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import type { InventoryEntry } from "../contracts/item.ts";
import type { MerchantWork } from "../merchant/work.ts";

interface Vault {
  pack: string;
  floor: string;
  gold: number;
  key?: { id: string } | null;
}
interface UnlockState {
  merchantCharacter: string | null;
  bankVaults?: Vault[];
  bankSnapshot?: { packs?: Record<string, (InventoryEntry | null)[] | undefined> } | null;
  statuses: Record<string, { items?: (InventoryEntry | null)[] } | undefined>;
  merchantCurrent: MerchantWork | null;
  merchantQueue: MerchantWork[];
}
interface UnlockPorts {
  now(): number;
  nextCommand(): number;
  stamp(job: MerchantWork): MerchantWork;
  publicJob(job: MerchantWork): unknown;
  log(message: string, level: string, details: unknown): void;
  persist(): void;
  dispatch(): void;
}
interface Failure {
  status: number;
  error: string;
  key?: string | null;
}
export function createBankUnlockRoute(state: UnlockState, ports: UnlockPorts) {
  function ownsKey(key: string): boolean {
    const inventories = [
      state.statuses[String(state.merchantCharacter)]?.items,
      ...Object.values(state.bankSnapshot?.packs || {}),
    ];
    return inventories.some((entries) =>
      (entries || []).some((entry) => entry?.item?.name === key),
    );
  }
  function access(vault: Vault, kind: unknown, unlocked: Set<string>): Failure | null {
    const accessible =
      vault.floor === "bank" ||
      (state.bankVaults || []).some(
        (entry) => entry.floor === vault.floor && entry.gold === 0 && unlocked.has(entry.pack),
      );
    const key = vault.key && vault.key.id;
    if (!accessible && kind !== "key")
      return { status: 409, error: "unlock the bank floor first", key };
    if (kind === "key") {
      if (!key) return { status: 400, error: "this floor has no access key" };
      if (!ownsKey(key)) return { status: 409, error: "required bank key is not owned", key };
    } else if (!vault.gold) return { status: 409, error: "this vault opens with floor access" };
    return null;
  }
  function queue(vault: Vault, kind: unknown): MerchantWork {
    const job = ports.stamp({
      id: "merchant-" + ports.now() + "-" + ports.nextCommand(),
      target: state.merchantCharacter,
      reason: "bank unlock",
      pack: vault.pack,
      floor: vault.floor,
      gold: kind === "key" ? 0 : vault.gold,
      key: kind === "key" ? vault.key?.id : null,
      queuedAt: ports.now(),
    });
    state.merchantQueue.push(job);
    ports.log(kind === "key" ? "Bank floor unlock queued" : "Bank vault unlock queued", "info", {
      floor: vault.floor,
      pack: vault.pack,
      key: job.key,
      gold: job.gold,
    });
    ports.persist();
    ports.dispatch();
    return job;
  }
  return function unlock(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!state.merchantCharacter)
      return res.status(409).json({ error: "no merchant is configured" });
    const vault = (state.bankVaults || []).find((entry) => entry.pack === body.pack);
    if (!vault) return res.status(400).json({ error: "unknown bank vault" });
    const unlocked = new Set(Object.keys(state.bankSnapshot?.packs || {}));
    if (unlocked.has(vault.pack))
      return res.status(409).json({ error: "bank vault is already unlocked" });
    const failure = access(vault, body.kind, unlocked);
    if (failure) {
      const { status, ...payload } = failure;
      return res.status(status).json(payload);
    }
    if (
      [state.merchantCurrent, ...state.merchantQueue].some((job) => job?.reason === "bank unlock")
    )
      return res.status(409).json({ error: "a bank unlock is already queued" });
    return res.json({ ok: true, job: ports.publicJob(queue(vault, body.kind)) });
  };
}
