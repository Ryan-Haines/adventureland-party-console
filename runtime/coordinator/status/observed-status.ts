import type { HeartbeatStatus } from "./response-types.ts";
import type { InventoryEntry, Item } from "../contracts/item.ts";
import type { HuntStatus } from "../hunt/contracts.ts";
import type { AnniversaryMerchantStatus } from "../merchant/anniversary-control.ts";
import type { AnniversaryBuffStatus } from "../anniversary/return-contracts.ts";
import type { createMerchantObservation } from "./merchant-observation.ts";
import type { Member } from "../../combat/grouped.ts";

type MerchantObservation = Parameters<ReturnType<typeof createMerchantObservation>["observe"]>[0];

/** inventoryOperationEntry emits either an occupied indexed slot or null. */
export interface ObservedInventoryEntry extends InventoryEntry {
  slot: number;
  item: Item;
}

/** Latest character heartbeat after ingestion stamps its coordinator observation time. */
export interface ObservedCharacterStatus extends HeartbeatStatus, AnniversaryMerchantStatus {
  upgradePreviewSession?: string;
  upgradeInventoryBusy?: boolean;
  seenAt: number;
  clientVersion?: number;
  clientInstance?: string;
  map: string;
  x: number;
  y: number;
  ctype?: string;
  gold: number;
  level: number;
  owner?: string | number | null;
  anniversaryState?: AnniversaryMerchantStatus["anniversaryState"] &
    AnniversaryBuffStatus["anniversaryState"] &
    MerchantObservation["anniversaryState"];
  hp: number;
  rip?: boolean;
  items?: (ObservedInventoryEntry | null)[];
  monsterHunt?: HuntStatus["monsterHunt"];
  huntLoot?: HuntStatus["huntLoot"];
  activeCombatTarget?: HuntStatus["activeCombatTarget"];
  combatSelection?: NonNullable<Member["status"]>["combatSelection"];
  groupedCombat?: NonNullable<Member["status"]>["groupedCombat"];
}
