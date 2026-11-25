// The storage routes: the bank
// actions, vault unlocks and restock policies.
import { createBankboiStorageRoutes, createVaultUnlock, type UnlockState, type UnlockPorts } from '../storage.ts';
import { createRestockWrite, type RestockWriteState, type RestockWritePorts } from '../needs.ts';
import { requestObject, type HttpRequest, type HttpResponse } from '../../../lifecycle/api.ts';
import { send } from './answer.ts';

type BankState<Transaction extends { bankboi: string }> = Parameters<
  typeof createBankboiStorageRoutes<Transaction>
>[0] &
  Parameters<typeof createBankUnlockRoute>[0] &
  Parameters<typeof createRestockRoute>[0] & { nextCommandId: number };
type StoragePorts<Transaction extends { bankboi: string }> = Parameters<
  typeof createBankboiStorageRoutes<Transaction>
>[1];
type BankPorts<Transaction extends { bankboi: string }> = Omit<StoragePorts<Transaction>, "persist" | "persistJobs"> &
  Omit<Parameters<typeof createBankUnlockRoute>[1], "nextCommand"> &
  Parameters<typeof createRestockRoute>[1] & { persistBank: () => void };

/** Storage receipts persist bank snapshots; bank requests and restock settings use settings persistence. */
export function createCoordinatorBankActions<Transaction extends { bankboi: string }>(
  state: BankState<Transaction>,
  ports: BankPorts<Transaction>,
) {
  const storage = createBankboiStorageRoutes(state, { ...ports, persist: () => ports.persistBank(), persistJobs: () => ports.persist() });
  const unlock = createBankUnlockRoute(state, {
    ...ports,
    nextCommand: () => state.nextCommandId++,
  });
  const restock = createRestockRoute(state, ports);
  return { storage, unlock, restock };
}

export function createBankUnlockRoute(state: UnlockState, ports: UnlockPorts) {
  const unlock = createVaultUnlock(state, ports);
  return function unlockRoute(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    return send(res, unlock(body.pack, body.kind));
  };
}
export function createRestockRoute(state: RestockWriteState, ports: RestockWritePorts) {
  const restock = createRestockWrite(state, ports);
  return function restockRoute(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    return send(res, restock(body.character, body.hp, body.mp, body.elixir));
  };
}
