import type { initializeCoordinatorEnvironment } from "../lifecycle/coordinator/start.ts";
import type { ObservedCharacterStatus } from "../status/api.ts";
import { type createManualOrders, type createCoordinatorCharacterCommands, type createCoordinatorInventoryActions,
  type createMailJobs, type createNpcSaleRoute, type queueExchangeStorage,
  type reconcileCoordinatorUpgradeMarks, type createStaleOrderRoute, type StandBid, type WithdrawalRequest, type StoredBankboi,
  type BankboiInventory, type loadCoordinatorBankVaults, type StandMark, type initialALDataState, type PublicListing,
  type createReservedBankboiCargo, type createImprovementScheduler } from "../items/coordinator/api.ts";
import { type initialMerchantRuntime, type initialGatheringState, type initialEventState, type initialCommandState,
  type initialRecoveryState, type createInitialCoordinatorState, type initialMerchantSales } from "../settings/coordinator/api.ts";
import type { createMerchantControlRoutes } from "../merchant-jobs/api.ts";
import type { createMerchantCompletionRoute } from "../merchant-jobs/coordinator/api.ts";
import type { createTransferCommands } from "../items/coordinator/api.ts";
import type { createHunt } from "../hunting/coordinator/api.ts";
import type { Catalog } from "../hunting/api.ts";
import type { createCoordinatorNavigationActions, PartyConvoy } from "../movement/api/coordinator.ts";
import type {
  coordinatorMerchantPriority,
  coordinatorPrioritizedBids,
} from "../merchant-jobs/api.ts";
import type {
  CoordinatorAccount,
  CoordinatorConfiguration,
} from "../lifecycle/coordinator/platform-contracts.ts";
import type { initialHeadlessSlots, initialSteamRoster } from "../lifecycle/roster/initial-roster.ts";
import type { initialBankState } from "../items/coordinator/api.ts";
import type { MerchantWork } from "../merchant-jobs/api.ts";
import type { loadFarmingRecord } from "../hunting/coordinator/api.ts";
import type { HuntCycle } from "../hunting/api.ts";
import type { EventRecovery, EventReturnState } from "../events/api.ts";
import type { createAnniversarySuppliesRoute } from "../events/coordinator/api.ts";
import type { initialAnniversaryState } from "../events/coordinator/api.ts";
import type { createAnniversaryReturns } from "../events/coordinator/api.ts";
import type { createAnniversaryNavigationRoutes } from "../events/coordinator/api.ts";
import type { createWorkers } from "../lifecycle/coordinator/workers.ts";
import type { CharacterBlock } from "../lifecycle/api.ts";
import type { initialCollectionState } from "../items/coordinator/api.ts";
import type { ItemMark } from "./contracts/item.ts";
import type { initialItemIntents, ItemIntents } from "../items/coordinator/api.ts";
import type { createCoordinatorEventReturns } from "../events/coordinator/api.ts";
import type { createEventObservations } from "../events/coordinator/api.ts";
import type { PartyEscape, PartyRecovery } from "./survival/api.ts";
import type { CharacterWork, MerchantCommand } from "../merchant-jobs/api.ts";
import type { createRestockRoute } from "../items/coordinator/api.ts";
import type { HuntConvoy } from "../hunting/api.ts";
import type { recoverMerchantQueue } from "../merchant-jobs/api.ts";
import type { ABStrategy } from "../events/api.ts";
import type { NavigationIntent } from "../movement/api/coordinator.ts";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Assert<T extends true> = T;
type Store = { set: (key: string, value: unknown) => void };
type Environment = Awaited<
  ReturnType<
    typeof initializeCoordinatorEnvironment<
      Store,
      number,
      CoordinatorConfiguration,
      CoordinatorAccount
    >
  >
>;

/** Compile-time regression checks: startup must expose mutable domain types, not empty-object/null literals. */
export type InitializationContractChecks = [
  // The existing composition still requires a selected merchant. Nullable
  // initialization is checked separately until that application path is migrated.
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<null>>["merchantCharacter"],
      string | null
    >
  >,
  Assert<
    Equal<ReturnType<typeof createInitialCoordinatorState<string>>["merchantCharacter"], string>
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createHunt
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createCoordinatorCharacterCommands
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createManualOrders
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createMerchantControlRoutes
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createTransferCommands
    >[0]
      ? true
      : false
  >,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["statuses"],
      Record<string, ObservedCharacterStatus>
    >
  >,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["monsterChoices"],
      Catalog | null
    >
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createCoordinatorInventoryActions
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createMerchantCompletionRoute
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createMailJobs
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createNpcSaleRoute
    >[0]
      ? true
      : false
  >,
  Assert<
    NonNullable<MerchantWork["exchanges"]> extends Parameters<typeof queueExchangeStorage>[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof reconcileCoordinatorUpgradeMarks
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createStaleOrderRoute
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof createCoordinatorNavigationActions
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof createInitialCoordinatorState<string>> extends Parameters<
      typeof coordinatorMerchantPriority
    >[0]
      ? true
      : false
  >,
  Assert<Equal<ReturnType<typeof coordinatorPrioritizedBids<StandBid>>[number][1], StandBid>>,
  Assert<
    ReturnType<typeof initialBankState>["bankboiQueue"] extends Parameters<
      typeof createReservedBankboiCargo
    >[0]["bankboiQueue"]
      ? true
      : false
  >,
  Assert<
    ItemIntents["autoExchanges"] extends NonNullable<
      Parameters<typeof createImprovementScheduler>[0]["autoExchanges"]
    >
      ? true
      : false
  >,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["navigationIntents"],
      Record<string, NavigationIntent | undefined>
    >
  >,
  Assert<Equal<ReturnType<typeof initialALDataState>["marketListings"], PublicListing[]>>,
  Assert<Equal<ReturnType<typeof initialALDataState>["marketBuyOrders"], PublicListing[]>>,
  Assert<Equal<ReturnType<typeof initialEventState>["abtestingStrategy"], ABStrategy | null>>,
  Assert<
    Equal<
      ReturnType<typeof initialMerchantRuntime>["merchantCargo"],
      Parameters<typeof recoverMerchantQueue>[0]["merchantCargo"]
    >
  >,
  Assert<
    ReturnType<typeof initialMerchantSales>["standListings"][number] extends StandMark
      ? true
      : false
  >,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["bankVaults"],
      ReturnType<typeof loadCoordinatorBankVaults>
    >
  >,
  Assert<PartyConvoy extends HuntConvoy ? true : false>,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["merchantDeliveries"],
      Parameters<typeof createTransferCommands>[0]["merchantDeliveries"]
    >
  >,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["restockPolicies"],
      Parameters<typeof createRestockRoute>[0]["restockPolicies"]
    >
  >,
  Assert<Equal<ReturnType<typeof initialRecoveryState>["combatRecovery"], PartyRecovery | null>>,
  Assert<Equal<ReturnType<typeof initialRecoveryState>["escape"], PartyEscape | null>>,
  Assert<Equal<ReturnType<typeof initialRecoveryState>["groupedCombatResetAt"], number>>,
  Assert<
    NonNullable<ItemIntents["statScrolls"][string]> extends CharacterWork["statScrolls"]
      ? true
      : false
  >,
  Assert<Equal<MerchantCommand["purpose"], string | null | undefined>>,
  Assert<Equal<ReturnType<typeof initialItemIntents>, ItemIntents>>,
  Assert<Equal<Environment["workers"], CoordinatorConfiguration["characters"]>>,
  Assert<Equal<Environment["account"], CoordinatorAccount>>,
  Assert<Equal<ReturnType<typeof initialHeadlessSlots>, (string | null)[]>>,
  Assert<Equal<ReturnType<typeof initialSteamRoster>["steamMembers"], string[]>>,
  Assert<Equal<ReturnType<typeof initialMerchantRuntime>["merchantCurrent"], MerchantWork | null>>,
  Assert<
    Equal<ReturnType<typeof initialBankState>["withdrawals"], Record<string, WithdrawalRequest[]>>
  >,
  Assert<Equal<ReturnType<typeof initialBankState>["bankObserver"], string | null>>,
  Assert<Equal<ReturnType<typeof loadFarmingRecord>["monsterHunt"], HuntCycle | null>>,
  Assert<Equal<ReturnType<typeof loadFarmingRecord>["scatterMonsterTypes"], string[]>>,
  Assert<Equal<ReturnType<typeof loadFarmingRecord>["partyFarmingMonsterType"], string | null>>,
  Assert<Equal<ReturnType<typeof initialGatheringState>["gatheringModes"], string[]>>,
  Assert<Equal<ReturnType<typeof initialEventState>["eventReturn"], EventRecovery | null>>,
  Assert<Equal<ReturnType<typeof initialEventState>["eventReturnLast"], EventReturnState["last"]>>,
  Assert<StoredBankboi extends BankboiInventory ? true : false>,
  Assert<
    StoredBankboi extends NonNullable<
      Parameters<typeof createAnniversarySuppliesRoute>[0]["bankbois"]
    >[string]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof initialAnniversaryState> extends Parameters<
      typeof createAnniversaryReturns
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof initialAnniversaryState> extends Parameters<
      typeof createAnniversaryNavigationRoutes
    >[0]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof initialAnniversaryState> extends Parameters<
      typeof createCoordinatorEventReturns
    >[0]["anniversary"]
      ? true
      : false
  >,
  Assert<
    ReturnType<typeof initialAnniversaryState> extends Parameters<
      typeof createEventObservations
    >[0]["anniversary"]
      ? true
      : false
  >,
  Assert<Equal<ReturnType<ReturnType<typeof createWorkers>["ensure"]>, CharacterBlock>>,
  Assert<Equal<ReturnType<typeof initialCollectionState>["threshold"], number>>,
  Assert<Equal<ReturnType<typeof initialCommandState>["activeConvoy"], PartyConvoy | null>>,
  Assert<Equal<ReturnType<typeof initialCollectionState>["marked"], Record<string, ItemMark[]>>>,
];
