import type { MerchantWork } from "./work.ts";
import type { recoverMerchantQueue } from "./restart-queue.ts";
import type { createMerchantItemCommands } from "../inventory/merchant-item-commands.ts";

import { initialBankSort, type BankSortState } from "./bank-sort.ts";

interface SavedMerchant extends Partial<BankSortState> {
  luckyUpgradeSlots?: Record<string, number | null>;
  merchantCharacter?: string | null;
  merchantForceStand?: unknown;
  merchantWeapon?: Parameters<typeof createMerchantItemCommands>[0]["merchantWeapon"];
  merchantQueue?: MerchantWork[] | null;
  merchantCurrent?: MerchantWork | null;
  merchantCargo?: Parameters<typeof recoverMerchantQueue>[0]["merchantCargo"] | null;
}

/** Restore pending merchant work before the restart recovery service reconciles it. */
export function initialMerchantRuntime<DefaultMerchant extends string | null = string>(
  saved: SavedMerchant,
  defaultMerchant?: DefaultMerchant,
) {
  const merchantCharacter: string | DefaultMerchant =
    saved.merchantCharacter || (defaultMerchant === undefined ? "GoldMajesty" : defaultMerchant);
  return {
    ...initialBankSort(saved),
    merchantCharacter,
    luckyUpgradeSlots: saved.luckyUpgradeSlots || { GoldMajesty: 7 },
    merchantForceStand: saved.merchantForceStand === true,
    merchantWeapon: saved.merchantWeapon || null,
    merchantQueue: Array.isArray(saved.merchantQueue) ? saved.merchantQueue : [],
    merchantCurrent: saved.merchantCurrent || null,
    merchantHomeReturnAt: 0,
    merchantCargo: saved.merchantCargo || { bank: [], gold: 0 },
  };
}
