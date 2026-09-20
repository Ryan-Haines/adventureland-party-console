import { queueExchangeStorage } from "./exchange-storage.ts";

type ExchangeArguments = Parameters<typeof queueExchangeStorage>;
interface StorageState {
  merchantCharacter: string | null;
  withdrawals: Record<string, ExchangeArguments[3]>;
  bankbois?: Record<string, ExchangeArguments[2][number]> | null;
}

/** Keep withdrawal initialization and persistence at the coordinator boundary. */
export function createCoordinatorStorageService(state: StorageState, persist: () => void) {
  return {
    queueExchange(
      job: { exchanges?: ExchangeArguments[0] | null },
      shortages?: ExchangeArguments[1] | null,
    ): boolean {
      const requests =
        state.withdrawals[String(state.merchantCharacter)] ||
        (state.withdrawals[String(state.merchantCharacter)] = []);
      const pending = queueExchangeStorage(
        job.exchanges || [],
        shortages || [],
        Object.values(state.bankbois || {}),
        requests,
      );
      if (pending) persist();
      return pending;
    },
  };
}

/** Exchange identity deliberately excludes quantity and unrelated item metadata. */
export function coordinatorStorageIdentity(input?: unknown): string {
  // Mail requests are untrusted. Preserve JS property access (including primitive
  // boxing and inherited getters), without validating or copying their payload.
  const item = input as { name?: unknown; level?: unknown; stat_type?: unknown } | null | undefined;
  return JSON.stringify([
    (item && item.name) || "",
    Number(item && item.level) || 0,
    (item && item.stat_type) || null,
  ]);
}

export function coordinatorRestockPolicy<Policy>(
  policies: Record<string, Policy>,
  name: string | null,
) {
  return (
    policies[String(name)] || {
      hp: { min: 5, max: 20, item: "hpot1" },
      mp: { min: 0, max: 0, item: "mpot1" },
    }
  );
}
