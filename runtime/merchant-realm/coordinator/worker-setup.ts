// The worker setup's realm reads: the realm a
// worker connects to, the account's and a character's native home, and the headless workers' load
// migration. They read the realm owner's saved request and the party switch; they decide no move.
import { normalizedRealm, type RealmRequest } from '../rules.ts';

// `realm.target()` for the worker setup: a party switch participant connects to the switch's realm,
// the merchant to its move in flight. Nothing is deleted here; the realm owner ends its own moves.
function realmTarget(state: {
  merchantCharacter?: string | null;
  merchantRealmRequests?: Record<string, RealmRequest | undefined>;
  realmSwitch?: { phase: string; realm: string; participants: string[]; homeTargets?: string[] } | null;
}, name: string): string | undefined {
  const switching = state.realmSwitch;
  if (switching && ['switching', 'retrying', 'rolling-back', 'setting-home'].includes(switching.phase) &&
      (switching.participants.includes(name) || switching.homeTargets?.includes(name)) && name !== state.merchantCharacter)
    return switching.realm;
  const current = state.merchantRealmRequests?.[name];
  return current && !current.exhausted ? current.realm : undefined;
}

// The realm a worker connects to (MRG-009, the worker setup's ask): the target of a move or switch
// in flight; else a running worker's own realm; else the character's native home, or the console's
// configured realm.
export function connectionRealm(state: Parameters<typeof realmTarget>[0], name: string, running: string | undefined,
  home: string | null, configured: string): string {
  return realmTarget(state, name) || running || home || configured;
}
// A character's native home as a realm key: the account's one home when every character shares it,
// else the character's own.
export function characterHomeRealm(accountHome: string | null, ownHome: string | null | undefined): string | null {
  return normalizedRealm(accountHome || ownHome);
}
// The account's home realm: the one home every character of the account reports, else none.
export function accountHomeRealm(account: { response: { characters: { home?: string | null }[] } }): string | null {
  const homes = account.response.characters.map(entry => normalizedRealm(entry.home));
  return homes.length && homes[0] && homes.every(home => home === homes[0]) ? homes[0] : null;
}

// The headless workers' load migration, moved from runtime/coordinator/characters/
// migrate-selections.ts when the events owner took that file's event half.
interface HeadlessSlotState {
  headlessSlots: (string | null)[];
  bankbois: Record<string, unknown>;
  activeRealm: string;
}

/** Known occupied headless slots, BankBoi excluded, inherit the active realm at load. */
export function migrateHeadlessRealms(
  state: HeadlessSlotState,
  workers: Record<string, { realm?: string } | undefined>,
): void {
  for (const name of state.headlessSlots) {
    if (!name || state.bankbois[name]) continue;
    const worker = workers[name];
    if (worker) worker.realm = state.activeRealm;
  }
}
