import { type ExchangeStorageSource, exchangeStorageWorkers, queueExchangeStorage } from "./exchange-storage.ts";
import {protectedMerchantStorageStock} from './merchant-storage-stock.ts';
import type {UpgradeOffering} from '../../upgrade-offerings.ts';

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
      job: { exchanges?: ExchangeArguments[0] | null; exchangeStorageSources?: ExchangeStorageSource[] },
      shortages?: ExchangeArguments[1] | null,
    ): boolean {
      const requests =
        state.withdrawals[String(state.merchantCharacter)] ||
        (state.withdrawals[String(state.merchantCharacter)] = []);
      const sources: ExchangeStorageSource[] = [];
      const pending = queueExchangeStorage(
        job.exchanges || [],
        shortages || [],
        exchangeStorageWorkers(state),
        requests, sources,
      );
      if (pending) { job.exchangeStorageSources = sources; persist(); }
      return pending;
    },
    queueOffering(offering:UpgradeOffering,quantity=1):boolean {
      const requests=state.withdrawals[String(state.merchantCharacter)] ||= [];
      let remaining=quantity, pending=false;
      // Native bank stock precedes remote whole stacks; existing references own
      // their quantity and remain untouched across repeated requests/restarts.
      const stock=protectedMerchantStorageStock(state).filter(entry=>entry.item?.name===offering && !entry.item.l && !entry.item.b && !entry.craftLocation.startsWith('inventory:'))
        .sort((a,b)=>Number(a.craftLocation.startsWith('bankboi:'))-Number(b.craftLocation.startsWith('bankboi:')));
      for(const entry of stock){
        if(remaining<=0) break;
        if(!requests.some(request=>request.pack===entry.craftLocation && request.slot===entry.slot))
          requests.push({pack:entry.craftLocation,slot:entry.slot,item:entry.item});
        remaining-=Number(entry.item?.q)||1;pending=true;
      }
      if(pending) persist();
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
