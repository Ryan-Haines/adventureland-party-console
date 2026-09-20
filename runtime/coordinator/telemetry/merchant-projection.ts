import type { AccountCharacter } from "../characters/roster-projection.ts";
import { routineFor } from '../merchant/routines.ts';

interface MerchantJob {
  [key: string]: unknown;
  reason?: string;
  routine?: string;
  manual?: boolean;
  bidItemId?: string;
  target?: string | null;
  aldataKey?: unknown;
}
interface JobProjectionPorts<T extends MerchantJob> {
  stamp(job: T): T;
  slots(name: string | null | undefined): number;
  threshold(): number;
  nearby(name: string | null | undefined): boolean;
}

/** Publish queue metadata without exposing the ALData credential carried by a job. */
export function projectMerchantJob<T extends MerchantJob>(
  job: T | null | undefined,
  ports: JobProjectionPorts<T>,
) {
  if (!job) return null;
  const safe: MerchantJob = { ...ports.stamp(job) };
  safe.routine = routineFor({ ...safe, reason: safe.reason || '' });
  if (job.reason === "marked items") {
    const slots = ports.slots(job.target),
      threshold = ports.threshold() || 1;
    safe.collectionSlots = slots;
    safe.collectionThreshold = threshold;
    safe.collectionNearby = ports.nearby(job.target);
    safe.collectionLabel = slots < threshold ? "nearby collection" : "marked items";
  }
  delete safe.aldataKey;
  return safe;
}

interface Bankboi {
  name: string;
  items?: unknown;
  [key: string]: unknown;
}
interface Transaction {
  bankboi?: string;
  phase?: unknown;
  mode?: unknown;
}
export function projectBankbois(
  bankbois: Record<string, Bankboi>,
  transaction: Transaction | null | undefined,
  accountCharacter?: (name: string) => Pick<AccountCharacter, "type" | "level"> | undefined,
) {
  return Object.values(bankbois)
    .map((entry) => {
      const character = accountCharacter?.(entry.name);
      return {
        ...entry,
        ...(character ? { ctype: character.type, level: character.level } : {}),
        items: Array.isArray(entry.items) ? entry.items : [],
        transaction:
          transaction && transaction.bankboi === entry.name
            ? { phase: transaction.phase, mode: transaction.mode }
            : null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
