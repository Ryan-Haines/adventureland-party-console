import type { initializeCoordinatorEnvironment } from "./environment.ts";
import type { ObservedCharacterStatus } from "./status/observed-status.ts";
import type { createManualOrders } from "./commerce/manual-orders.ts";
import type { createMerchantControlRoutes } from "./http/merchant-control.ts";
import type { createTransferCommands } from "./inventory/transfer-commands.ts";
import type { createCoordinatorCharacterCommands } from "./http/character-actions.ts";
import type { createCoordinatorHunt } from "./hunt/composition.ts";
import type { Catalog } from "../../dashboard/lib/farming-zones.ts";
import type { createCoordinatorInventoryActions } from "./http/inventory-actions.ts";
import type { createCoordinatorMerchantDeliveryActions } from "./http/merchant-delivery-actions.ts";
import type { createMailJobs } from "./commerce/mail-jobs.ts";
import type { createNpcSaleRoute } from "./http/npc-sale.ts";
import type { queueExchangeStorage } from "./inventory/exchange-storage.ts";
import type { reconcileCoordinatorUpgradeMarks } from "./inventory/mark-reconciliation.ts";
import type { createStaleOrderRoute } from "./http/stale-orders.ts";
import type { createCoordinatorNavigationActions } from "./http/navigation-actions.ts";
import type {
  coordinatorMerchantPriority,
  coordinatorPrioritizedBids,
} from "./merchant/job-policy.ts";
import type { StandBid } from "./commerce/bids.ts";
import type {
  CoordinatorAccount,
  CoordinatorConfiguration,
} from "./infrastructure/platform-contracts.ts";
import type { initialHeadlessSlots, initialSteamRoster } from "./characters/initial-roster.ts";
import type { initialMerchantRuntime } from "./merchant/initial-runtime.ts";
import type { initialBankState } from "./inventory/initial-bank.ts";
import type { MerchantWork } from "./merchant/work.ts";
import type { WithdrawalRequest } from "./inventory/exchange-storage.ts";
import type { initialFarmingState } from "./navigation/initial-farming.ts";
import type { initialGatheringState } from "./merchant/initial-gathering.ts";
import type { initialEventState } from "./initial-core.ts";
import type { HuntCycle } from "./hunt/contracts.ts";
import type { EventRecovery, EventReturnState } from "./events/return-types.ts";
import type { StoredBankboi } from "./inventory/storage-contracts.ts";
import type { BankboiInventory } from "./inventory/bankboi-completion.ts";
import type { createAnniversarySuppliesRoute } from "./http/anniversary-supplies.ts";
import type { initialAnniversaryState } from "./anniversary/initial-state.ts";
import type { createAnniversaryReturns } from "./anniversary/returns.ts";
import type { createAnniversaryNavigationRoutes } from "./http/anniversary-navigation.ts";
import type { createWorkerSetup } from "./characters/worker-setup.ts";
import type { CharacterBlock } from "./characters/types.ts";
import type { initialCollectionState } from "./inventory/initial-collection.ts";
import type { initialCommandState } from "./navigation/initial-commands.ts";
import type { PartyConvoy } from "./navigation/convoy.ts";
import type { ItemMark } from "./contracts/item.ts";
import type { initialItemIntents, ItemIntents } from "./inventory/initial-intents.ts";
import type { createCoordinatorEventReturns } from "./events/return-composition.ts";
import type { createEventObservations } from "./events/observations.ts";
import type { initialRecoveryState } from "./initial-core.ts";
import type { CombatRecovery, EscapeRecovery } from "./navigation/recovery-contracts.ts";
import type { CharacterWork, MerchantCommand } from "./merchant/work.ts";
import type { createInitialCoordinatorState } from "./initial-state.ts";
import type { SavedServiceSettings } from "./persistence/settings-contracts.ts";
import type { HuntConvoy } from "./hunt/contracts.ts";
import type { loadCoordinatorBankVaults } from "./infrastructure/game-data.ts";
import type { coordinatorGenerationPorts } from "./characters/runtime-lifecycle.ts";
import type { initialMerchantSales } from "./merchant/initial-settings.ts";
import type { StandMark } from "./merchant/stand-marks.ts";
import type { recoverMerchantQueue } from "./merchant/restart-queue.ts";
import type { ABStrategy } from "./events/abtesting.ts";
import type { initialALDataState } from "./commerce/initial-aldata.ts";
import type { PublicListing } from "./commerce/market-types.ts";
import type { NavigationIntent } from "./navigation/selection-contracts.ts";
import type { createReservedBankboiCargo } from "./inventory/reserved-cargo.ts";
import type { createImprovementScheduler } from "./merchant/improvement-scheduler.ts";

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
      typeof createCoordinatorHunt
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
      typeof createCoordinatorMerchantDeliveryActions
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
  Assert<
    CharacterBlock extends Parameters<typeof coordinatorGenerationPorts>[0][string] ? true : false
  >,
  Assert<PartyConvoy extends HuntConvoy ? true : false>,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["merchantDeliveries"],
      NonNullable<SavedServiceSettings["merchantDeliveries"]>
    >
  >,
  Assert<
    Equal<
      ReturnType<typeof createInitialCoordinatorState<string>>["restockPolicies"],
      NonNullable<SavedServiceSettings["restockPolicies"]>
    >
  >,
  Assert<Equal<ReturnType<typeof initialRecoveryState>["combatRecovery"], CombatRecovery | null>>,
  Assert<Equal<ReturnType<typeof initialRecoveryState>["escape"], EscapeRecovery | null>>,
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
  Assert<Equal<ReturnType<typeof initialFarmingState>["monsterHunt"], HuntCycle | null>>,
  Assert<Equal<ReturnType<typeof initialFarmingState>["scatterMonsterTypes"], string[]>>,
  Assert<Equal<ReturnType<typeof initialFarmingState>["partyFarmingMonsterType"], string | null>>,
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
  Assert<Equal<ReturnType<ReturnType<typeof createWorkerSetup>["ensure"]>, CharacterBlock>>,
  Assert<Equal<ReturnType<typeof initialCollectionState>["threshold"], number>>,
  Assert<Equal<ReturnType<typeof initialCommandState>["activeConvoy"], PartyConvoy | null>>,
  Assert<Equal<ReturnType<typeof initialCollectionState>["marked"], Record<string, ItemMark[]>>>,
];
