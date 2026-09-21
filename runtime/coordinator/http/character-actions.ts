import { createOfferingCommands } from '../inventory/upgrade-offerings.ts';
import { createFocusSelection, type FocusState } from '../navigation/focus.ts';
import { createCharacterCommandRoute } from "./character-command.ts";
import { createUpgradeCommands } from "../inventory/upgrade-commands.ts";
import { createCompoundCommands } from "../inventory/compound-commands.ts";
import { createTransferCommands } from "../inventory/transfer-commands.ts";
import { createMarkCommands } from "../inventory/mark-commands.ts";
import { createMerchantItemCommands } from "../inventory/merchant-item-commands.ts";
import { createStatScrollCommands } from "../inventory/stat-scroll-commands.ts";
import { createClearItemMarks } from "../inventory/clear-item-marks.ts";
import type { Item } from "../contracts/item.ts";
import type { CommandOutcome } from "../navigation/manual-commands.ts";

type CommandState = FocusState & Parameters<typeof createOfferingCommands>[0] & Parameters<typeof createCharacterCommandRoute>[0] &
  Parameters<typeof createClearItemMarks>[0] &
  Parameters<typeof createUpgradeCommands>[0] &
  Parameters<typeof createCompoundCommands>[0] &
  Parameters<typeof createTransferCommands>[0] &
  Parameters<typeof createMarkCommands>[0] &
  Parameters<typeof createMerchantItemCommands>[0] &
  Parameters<typeof createStatScrollCommands>[0] & { nextCommandId: number };
type CompoundPorts = Parameters<typeof createCompoundCommands>[1];
type MerchantItemPorts = Parameters<typeof createMerchantItemCommands>[1];
interface CharacterActionPorts {
  farmingState?(name: string): FocusState;
  navigation: (body: Record<string, unknown>) => CommandOutcome;
  farmingLocation: Parameters<typeof createCharacterCommandRoute>[1]["farmingLocation"];
  key: (item: Item) => string;
  mode: (rules: Record<string, unknown>, item: Item) => unknown;
  persist: () => void;
  persistBank: () => void;
  queue: (names: string[], reason: string) => void;
  reconcileUpgrades: Parameters<typeof createUpgradeCommands>[1]["reconcile"];
  reconcileMarks: Parameters<typeof createMarkCommands>[1]["reconcile"];
  scheduleCompound: (...args: Parameters<CompoundPorts["schedule"]>) => void;
  scheduleExchange: (...args: Parameters<MerchantItemPorts["scheduleExchange"]>) => void;
  log: (message: string, level: string, details?: unknown) => void;
  removeReservations: (name: string, slot: number, item: Item) => void;
  clearIncoming: (name: string, item: Item) => void;
  sameItem: (first: Item, second: Item) => boolean;
  identity: (item: Item | null | undefined) => string;
  bankboi: () => Promise<unknown>;
  marksCleared?: () => void;
}

/** Keep shared validation and command precedence in one place, ahead of every inventory mutation. */
export function createCoordinatorCharacterCommands(
  state: CommandState,
  workers: Record<string, unknown>,
  ports: CharacterActionPorts,
) {
  const managed = (name: unknown) =>
    Object.prototype.hasOwnProperty.call(workers, name as PropertyKey);
  const upgrades = createUpgradeCommands(state, {
    key: ports.key,
    persist: ports.persist,
    queue: ports.queue,
    reconcile: ports.reconcileUpgrades,
  });
  const compounds = createCompoundCommands(state, {
    queue: ports.queue,
    persist: ports.persist,
    schedule: ports.scheduleCompound,
    log: ports.log,
  });
  const transfers = createTransferCommands(state, {
    managed,
    nextCommand: () => state.nextCommandId++,
    removeReservations: ports.removeReservations,
    clearIncoming: ports.clearIncoming,
    sameItem: ports.sameItem,
    identity: ports.identity,
    persist: ports.persist,
    persistBank: ports.persistBank,
    bankboi: ports.bankboi,
    log: ports.log,
  });
  const marks = createMarkCommands(state, {
    key: ports.key,
    mode: ports.mode,
    reconcile: ports.reconcileMarks,
    persist: ports.persist,
  });
  const merchantItems = createMerchantItemCommands(state, {
    persist: ports.persist,
    scheduleExchange: ports.scheduleExchange,
  });
  const stats = createStatScrollCommands(state, { persist: ports.persist, queue: ports.queue });
  return createCharacterCommandRoute(state, {
    managed,
    farmingFocus: (name, ids) => {
      // A validated farming destination always supplies nonempty focus; clearing
      // focus (the only operation that invalidates navigation) is not possible here.
      createFocusSelection(ports.farmingState?.(name) || state, { members: () => [], invalidate: () => {} })
        .select(name, [...new Set(ids)], undefined, undefined);
      ports.persist();
    },
    farmingLocation: ports.farmingLocation,
    handlers: [
      createOfferingCommands(state, ports.persist),
      createClearItemMarks(state, { persist: ports.persist, changed: () => ports.marksCleared?.() }),
      ports.navigation,
      upgrades.handle,
      stats.handle,
      merchantItems.handle,
      compounds.handle,
      transfers.handle,
      marks.handle,
    ],
  });
}
