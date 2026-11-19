// The character routes: the
// character command, the roster creation, and BankBoi creation and deletion.
import { requestObject, requestText, type HttpRequest, type HttpResponse } from '../../../lifecycle/api.ts';
import { accountRequest, createBankboiDeletion, createCharacterCreationAnswers, type AccountRequestPorts, type DeletionState,
  type DeletionPorts, type CreationState, type CreationRoutePorts } from '../storage.ts';
import { send, asyncRoute } from './answer.ts';
import { createOfferingCommands, createUpgradeCommands, createCompoundCommands, createStatScrollCommands } from '../production.ts';
import type { createFarmingCommand, FocusState } from '../../../hunting/coordinator/api.ts';
import { createTransferCommands } from '../fates.ts';
import { createMerchantItemCommands } from '../market.ts';
import type { Item } from '../../../coordinator/contracts/item.ts';
import type { CommandOutcome } from '../../../movement/api/coordinator.ts';
import { createMarkCommands, createClearItemMarks, replaceAutomaticAction } from '../fates.ts';
import type { AutomaticAction } from '../../rules.ts';
import { commerceRuleKey } from '../../identity.ts';
import { FREE_CHARACTER_SLOTS } from '../../rules.ts';
import type { SettingsDraft, SettingsWrite, SettingsWriteResult } from '../../../settings/api.ts';
import type { EnqueueAsk, EnqueueAnswer, JobReason } from '../../../merchant-jobs/api.ts';

type AccountState = Parameters<typeof createCharacterCreationRoutes>[0] &
  Parameters<typeof createBankboiDeleteRoute>[0];
type CreationPorts = Parameters<typeof createCharacterCreationRoutes>[1];
type AccountPorts = Omit<CreationPorts, "request" | "includedSlots"> & AccountRequestPorts;

/** Account mutations use storage.ts's one account request; route policies retain slot and storage guards. */
export function createCoordinatorAccountCharacterActions(state: AccountState, ports: AccountPorts) {
  async function request(method: string, body: Record<string, unknown>) {
    const response = await accountRequest(ports, method, body);
    return { ok: response.ok, statusText: response.statusText, payload: await response.json() };
  }
  const creation = createCharacterCreationRoutes(state, {
    ...ports,
    includedSlots: FREE_CHARACTER_SLOTS,
    request: (name, characterClass, look) =>
      request("create_character", { name, char: characterClass, look }),
  });
  const deletion = createBankboiDeleteRoute(state, {
    now: () => ports.now(),
    owned: (name) => ports.owned(name),
    persist: () => ports.persistBank(),
    refresh: () => ports.refresh(),
    request: (name) => request("delete_character", { name }),
  });
  return { creation, deletion };
}

export function createBankboiDeleteRoute(state: DeletionState, ports: DeletionPorts) {
  const deletion = createBankboiDeletion(state, ports);
  return async function deleteBankboi(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    return send(res, await deletion(req.params.name!));
  };
}
export function createCharacterCreationRoutes(state: CreationState, ports: CreationRoutePorts) {
  const creation = createCharacterCreationAnswers(state, ports);
  return { roster: asyncRoute(creation.roster), bankboi: asyncRoute(creation.bankboi) };
}

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
  navigation: (body: Record<string, unknown>) => CommandOutcome;
  farming: CommandPorts['farming'];
  key: (item: Item) => string;
  persist: () => void;
  persistBank: () => void;
  queue: (names: string[], reason: JobReason) => void;
  enqueue: (ask: EnqueueAsk) => EnqueueAnswer;
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
  // The settings writer: each command family writes
  // the settings it changes through it.
  write: (batch: SettingsWrite) => SettingsWriteResult;
}

/** Keep shared validation and command precedence in one place, ahead of every inventory mutation. */
export function createCoordinatorCharacterCommands(
  state: CommandState,
  workers: Record<string, unknown>,
  ports: CharacterActionPorts,
) {
  const managed = (name: unknown, body?: Record<string, unknown>) =>
    Object.prototype.hasOwnProperty.call(workers, name as PropertyKey) || merchantRuleSelection(state, name, body);
  // The rules a choice replaces that are settings change in the request's draft, which the
  // command writes with its own change.
  const selectAction = (item: Item, name: string, action: AutomaticAction, draft: SettingsDraft, added = false) => {
    const hadStandRule = !!state.autoStandMarks?.[commerceRuleKey(item)];
    replaceAutomaticAction(state, name, item, action, draft, added);
    if (hadStandRule && action !== 'stand') ports.marksCleared?.();
  };
  const upgrades = createUpgradeCommands(state, {
    selectAction: (item, name, draft) => selectAction(item, name, 'upgrade', draft),
    key: ports.key,
    persist: ports.persist,
    write: ports.write,
    queue: ports.queue,
    reconcile: ports.reconcileUpgrades,
  });
  const compounds = createCompoundCommands(state, {
    selectAction: (item, name, draft) => selectAction(item, name, 'compound', draft),
    queue: ports.queue,
    persist: ports.persist,
    write: ports.write,
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
    write: ports.write,
  });
  const marks = createMarkCommands(state, {
    selectAction,
    reconcile: ports.reconcileMarks,
    persist: ports.persist,
    write: ports.write,
  });
  const merchantItems = createMerchantItemCommands(state, {
    selectAction: (item, name, draft) => selectAction(item, name, 'exchange', draft),
    persist: ports.persist,
    enqueue: ports.enqueue,
    scheduleExchange: ports.scheduleExchange,
    write: ports.write,
  });
  const stats = createStatScrollCommands(state, { persist: ports.persist, queue: ports.queue });
  return createCharacterCommandRoute(state, {
    managed,
    farming: ports.farming,
    handlers: [
      createOfferingCommands(state, ports.write),
      createClearItemMarks(state, { persist: ports.persist, persistBank: ports.persistBank, changed: () => ports.marksCleared?.(), write: ports.write }),
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

function merchantRuleSelection(state: CommandState, name: unknown, body?: Record<string, unknown>): boolean {
  if (!state.merchantCharacter || name !== state.merchantCharacter) return false;
  // The merchant takes bank intents and shared rules while offline; each handler checks the
  // selected source before it changes anything.
  if (typeof body?.pack === 'string' && ['withdraw', 'clear-item-marks'].includes(String(body.type))) return true;
  return typeof body?.type === 'string' && ['auto-item-mark', 'auto-exchange', 'auto-upgrade-mark', 'auto-compound-mark'].includes(body.type);
}

interface CommandRouteState {
  marked: Record<string, unknown>;
  merchantMarked: Record<string, unknown>;
  autoItemMarks: Record<string, unknown>;
  upgrades: Record<string, unknown>;
  statScrolls: Record<string, unknown>;
  compounds: Record<string, unknown>;
  withdrawals: Record<string, unknown>;
}
interface CommandPorts {
  managed(name: unknown, body?: Record<string, unknown>): boolean;
  // The hunting owner's half of the command (hunting/coordinator/routes.ts createFarmingCommand): the farm area
  // check, the preferred spot and the farming focus.
  farming: ReturnType<typeof createFarmingCommand>;
  handlers: ((body: Record<string, unknown>) => CommandOutcome)[];
}
/** Keeps shared request validation and acknowledgements separate from domain commands. */
export function createCharacterCommandRoute(state: CommandRouteState, ports: CommandPorts) {
  function result(name: string): Record<string, unknown> {
    return {
      ok: true,
      marked: state.marked[name] || [],
      merchantMarked: state.merchantMarked[name] || [],
      autoItemMarks: state.autoItemMarks[name] || {},
      upgrades: state.upgrades[name] || [],
      statScrolls: state.statScrolls[name] || [],
      compounds: state.compounds[name] || [],
      withdrawals: state.withdrawals[name] || [],
    };
  }
  return function command(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!ports.farming.valid(body))
      return res.status(400).json({ error: "The selected farming area is no longer available" });
    if (!ports.managed(body.character, body)) return res.status(400).json({ error: "unknown character" });
    ports.farming.place(body);
    for (const handler of ports.handlers) {
      const outcome = handler(body);
      if (outcome === undefined) continue;
      if (!outcome || outcome.status < 400) ports.farming.focus(body);
      if (outcome) return res.status(outcome.status).json(outcome.body);
      return res.json(result(requestText(body.character)));
    }
    return res.status(400).json({ error: "invalid command" });
  };
}
