// Owner 09's rows of the hook table: the call budget and the merchant's realm and hands. Only 09's
// build writes this file; runtime/hooks/registry.ts composes every owner's file into one `HOOKS`
// and one `SLOTS`.
import { doorOnly, readsOf, type DecisionRow, type PlainKind } from './row.ts';
import type { ActionRow, CallAnswer, CallQuestion, DispatchContext, HookRow, ReadRow, RetryAsk, RetryPolicy, SlotRow } from '../registry.ts';
import type { ScopeHandle } from '../../lifecycle/api.ts';
import { boundFired } from '../../status/api.ts';

const REALM = 'scripts/tests/realm-owner.test.cjs', HANDS = 'scripts/tests/gathering-equipment-restore.test.cjs';

export const HOOKS = {
  // The call budget's question: an owner asks it before each game call and makes the call in the
  // same synchronous turn on `send`. The one core answer is the character's budget. An add-on
  // makes no game call, so an add-on answer is refused at
  // load, and an add-on does not ask it.
  'calls.band': { kind: 'request', side: 'character', part: 'the call budget (09)', answers: 'one', core: true, addonMayAsk: false,
    fixture: 'scripts/tests/hook-registry.test.cjs#calls.band has one core answer and no add-on answer',
    receives: 'the band (survival, job or background), the socket method and its data', returns: 'send or not-now' },
  // The call budget's margin, the largest game round trip it measured within its window
  //. Movement waits one round trip before it re-sends a step that
  // stopped short, and cuts the try when the re-sent step's round trip passes with the character
  // still standing. An add-on may read it.
  'calls.margin': { kind: 'request', side: 'character', part: 'the call budget (09)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.margin: the add-on reads the margin while the figure holds',
    receives: 'nothing', returns: 'the margin in ms' },
  // The call budget's window, the span of game time the server counts a socket's calls over
  // (`CALL_WINDOW_MS`). The turns owner keeps each family's own replies
  // for one window.
  'calls.window': { kind: 'request', side: 'character', part: 'the call budget (09)', answers: 'one', core: true, addonMayAsk: true,
    fixture: 'scripts/tests/hook-registry.test.cjs#calls.band has one core answer and no add-on answer',
    receives: 'nothing', returns: 'the window in ms' },
  // The call budget's notices, one at each ring entry and at the
  // hold's start. The budget decides each wait, so `by` is `core:calls`; the source of a held emit
  // is unknown to it (the game client, the player, or an owner not built yet), so it says
  // `untagged`. A call admitted at once sends none.
  'calls.held': { kind: 'notice', side: 'character', part: 'the call budget (09)', answers: 'many', 
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.held: an untagged players emit under the planted figure is held',
    receives: 'character, method, cost, used, margin, source, by', returns: 'nothing' },
  'calls.released': { kind: 'notice', side: 'character', part: 'the call budget (09)', answers: 'many', 
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.released: the held players emit goes once the figure leaves',
    receives: 'character, method, cost, waitedMs, margin, sentMargin, by', returns: 'nothing' },
  'calls.waited': { kind: 'notice', side: 'character', part: 'the call budget (09)', answers: 'many', 
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.waited: a job question waits on the planted figure, then goes',
    receives: 'character, band, method, cost, waitedMs, by', returns: 'nothing' },
  'calls.raised': { kind: 'notice', side: 'character', part: 'the call budget (09)', answers: 'many', 
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.raised: a background read waits one window and goes in the job band',
    receives: 'character, method, waitedMs, by', returns: 'nothing' },
  'calls.unmatched': { kind: 'notice', side: 'character', part: 'the call budget (09)', answers: 'many', 
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.unmatched: a question with no call after it is unmatched',
    receives: 'character, method, band, by', returns: 'nothing' },
  'calls.limitdc': { kind: 'notice', side: 'character', part: 'the call budget (09)', answers: 'many', 
    fixture: 'e2e/live-calls-hooks.spec.ts#calls.limitdc: the planted overflow writes the limitdc snapshot',
    receives: 'character, total, limit, by', returns: 'nothing' },
  // P5: an add-on's answer to an owner's retry of a failure. 09 holds it because its floor is the
  // call window: each retry costs a game call or a login. the merchant jobs owner's job endings, the realm owner's
  // missed visit switch, the hunting owner's event death and rare end, and the movement owner's walk ladder wait and T5 give-up
  // ask it; another owner asks it the same way.
  'retry.policy': { kind: 'request', side: 'both', part: 'the call budget (09), retries', answers: 'many', addonMayAsk: false,
    bound: "a wait no shorter than core's and no shorter than calls.window; a failure core gives up on stays given up, and an answer may give up " +
      "sooner or count a retry core does not count, never later; with several answers the longest wait and the earliest give-up win",
    fixture: "scripts/tests/merchant-rendezvous-retry.test.cjs#P5: the add-on waits 30 s before a retry, a shorter wait keeps core's, and it gives a job up on its second failure",
    receives: "owner, subject, failure, attempt and core's own {wait, giveUp, counts}", returns: '{wait?, giveUp?, counts?} or nothing' },
  // The realm owner's requests and reads. None takes an
  // add-on answer: a want ends in a login, a game action (reason 1), and the blacklist is your setting
  // (reason 3, A3). Its requests are functions its callers import (runtime/merchant-realm/api.ts), so they have no row;
  // the two reads answer an add-on's ask on the coordinator.
  // 06's A/B exit rung (Other-side item from 06): one login to the realm the character reports now.
  'realm.reconnect': { kind: 'request', side: 'coordinator', part: "the merchant realm (09)", answers: 'one', core: true, addonMayAsk: false,
    fixture: `${REALM}#MJ91: a reconnect logs in once on the realm the character reports and adds no want`,
    receives: "a character", returns: "sent, or not-now while the merchant's own move is in flight" },
  'realm.target': { kind: 'request', side: 'coordinator', part: "the merchant realm (09)", answers: 'one', core: true, addonMayAsk: true,
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "nothing", returns: "the realm the move in flight names, or nothing" },
  'realm.moving': { kind: 'request', side: 'coordinator', part: "the merchant realm (09)", answers: 'one', core: true, addonMayAsk: true,
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "nothing", returns: "whether the merchant's move is in flight" },
  // The hands owner: `settle` is a function its callers import; the normal record is a
  // read. P12: an add-on answers it with the items it wants back after gathering, and
  // core:merchant-hands, which answers first, checks them.
  'hands.normal': { kind: 'request', side: 'character', part: "the merchant hands (09), MR10", answers: 'many', addonMayAsk: true,
    bound: "the first enabled add-on in load order that answers; an item the merchant holds that is no gathering tool and not listed for sale; the marked merchant weapon still goes first, and an answer outside the bound keeps the hand the merchant had",
    fixture: `${HANDS}#P12: the add-on's restore names its own weapon; a listed item keeps the observed hand`,
    receives: "nothing", returns: "the normal mainhand and offhand; an add-on's answer names the items to restore" },
  // A4 part 2 and S11: the realm and hands notices. They are unit rows: a realm move needs the
  // two-realm pool and a lease needs a cast, which the merchant hooks table's setup does not reach.
  'realm.move.started': { kind: 'notice', side: 'coordinator', part: "the merchant realm (09)", answers: 'many', 
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "subject (the merchant), owner (the want), code (the realm), by", returns: 'nothing' },
  'realm.move.arrived': { kind: 'notice', side: 'coordinator', part: "the merchant realm (09)", answers: 'many', 
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "subject, owner, code (the realm), by", returns: 'nothing' },
  'realm.move.failed': { kind: 'notice', side: 'coordinator', part: "the merchant realm (09)", answers: 'many', 
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "subject, owner, code (the ladder rung), by", returns: 'nothing' },
  'realm.want.refused': { kind: 'notice', side: 'coordinator', part: "the merchant realm (09), R2", answers: 'many', 
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "subject, owner, code (refused:pvp or refused:blacklisted), by", returns: 'nothing' },
  'realm.want.granted': { kind: 'notice', side: 'coordinator', part: "the merchant realm (09), R1", answers: 'many', 
    fixture: `${REALM}#A4: the realm owner's notices: a move starts, fails one window, is retried and arrives; a refused and a granted want`,
    receives: "subject, owner, code (the realm), by", returns: 'nothing' },
  'realm.switch.phase': { kind: 'notice', side: 'coordinator', part: "the merchant realm (09), the party switch (3.10.1)", answers: 'many', 
    fixture: `scripts/tests/coordinator-realm-actions.test.cjs#home-realm changes wait for the HTTP acknowledgement before dispatching the merchant`,
    receives: "subject (the switch id), code (the phase), by", returns: 'nothing' },
  'hands.lease.taken': { kind: 'notice', side: 'character', part: "the merchant hands (09)", answers: 'many', 
    fixture: `${HANDS}#A4: the hands owner's notices: a lease is taken and ended, a failed restore is told, and the normal record reads`,
    receives: "character, lease (the gathering mode), by", returns: 'nothing' },
  'hands.lease.ended': { kind: 'notice', side: 'character', part: "the merchant hands (09)", answers: 'many', 
    fixture: `${HANDS}#A4: the hands owner's notices: a lease is taken and ended, a failed restore is told, and the normal record reads`,
    receives: "character, lease, by", returns: 'nothing' },
  'hands.restore.failed': { kind: 'notice', side: 'character', part: "the merchant hands (09)", answers: 'many', 
    fixture: `${HANDS}#A4: the hands owner's notices: a lease is taken and ended, a failed restore is told, and the normal record reads`,
    receives: "character, error, by", returns: 'nothing' },
} as const satisfies Record<string, HookRow>;

// The add-on capability tables: each game call the call budget owner's code makes, offered
// through its door or closed with a code, and each state an add-on may read with the door export
// that answers it.
export const ACTIONS = {
  // 12 and 50 calls each (call-budget.ts:243,:245); C3 reads the call budget owner's cached copies.
  players: { events: ['players'], functions: [], closed: 'CL', cite: 'runtime/characters/call-budget.ts:243' },
  tracker: { events: ['tracker'], functions: [], closed: 'CL', cite: 'runtime/characters/call-budget.ts:245' },
  // A realm move is the realm owner's login (3.10); an add-on asks for a realm through a job's listing realm.
  // The hands owner sends every equip and unequip (runtime/merchant-hands/character/api.ts
  // handsSend); an add-on wears an item through 10's item.equip and item.unequip, which pass 10's fates first.
  hands: { events: [], functions: ['equip', 'unequip'], closed: 'FW', cite: "rows/10-items.ts ACTIONS item.equip and item.unequip, 10's doors over 09's hands door" },
  'realm.change': { events: [], functions: ['change_server'], closed: 'FW', cite: 'runtime/merchant-realm/rules.ts#wantRank' },
} as const satisfies Record<string, ActionRow>;
// C3's tables (addon-capabilities.md "The completeness rule"): each export of the call budget owner's doors is a
// read an add-on may ask, or a write, a port or a command only core calls.
const REALM_DOOR = 'runtime/merchant-realm/api.ts', HANDS_DOOR = 'runtime/merchant-hands/api.ts';
export const READS = {
  ...readsOf('hands', 'both', HANDS_DOOR, { DASHBOARD_EQUIPMENT_TYPES: "string[]" }),
  // The game server's call limit per window, which the dashboard's CC meter fills to.
  ...readsOf('calls', 'both', HANDS_DOOR, { CALL_LIMIT: "number" }),
  ...readsOf('hands', 'character', 'runtime/merchant-hands/rules.ts', { gatheringTools: "string[]", settleAnswer: "SettleAnswer" }),
  ...readsOf('realm', 'coordinator', REALM_DOOR, { merchantRealmErrors: "the realm owner's errors", connectionRealm: "string", characterHomeRealm: "string", accountHomeRealm: "string", realmOperationOwnsCharacter: "boolean", realmOperationDestination: "string | null" }),
  ...readsOf('realm', 'both', REALM_DOOR, { normalizedRealm: "string", realmRefusal: "string | undefined", realmRequestArrived: "boolean" }),
} as const satisfies Record<string, ReadRow>;
export const DOOR_ONLY = {
  ...doorOnly(REALM_DOOR, 'port', ['createMerchantRealmOwner', 'createMerchantRealmRoutes', 'createMerchantHomeCommand', 'createCoordinatorRealmActions', 'createPartyRealmCheck', 'merchantRealmSource', 'nextRealmReport']),
  ...doorOnly(REALM_DOOR, 'write', ['migrateHeadlessRealms']),
  ...doorOnly('runtime/merchant-hands/character/api.ts', 'port', ['handsSend']),
};

// None for add-ons: the realm list and the hands are core rows of the merchant card.
export const SLOTS = {} as const satisfies Record<string, SlotRow>;

// The registry's dispatch of the call budget owner's rows.
export function dispatch(ctx: DispatchContext) {
  const band = (question: CallQuestion): CallAnswer => ctx.one('calls.band').hooks['calls.band']!(question);
  const margin = (): number => Number(ctx.one('calls.margin').hooks['calls.margin']!());
  const callWindow = (): number => ctx.one('calls.window').hooks['calls.window']!();
  // The band wait every owner's job call uses, once. A job call asks the
  // band and waits a call window while it answers "not now"; the wait sleeps on the caller's own
  // `act` handle, so it holds with the character and resumes at release. The wait has no cap: the
  // server's call cost ends it. A closed connection sends no more of that figure, so the wait ends
  // when the game's socket disconnects or the game replaces it (game.js `init_socket`), and the
  // call fails as `disconnected`.
  async function wait(question: CallQuestion, act: Pick<ScopeHandle, 'sleep'>): Promise<void> {
    const game = () => (globalThis as { parent?: { socket?: { connected?: boolean } | null } }).parent, socket = game()?.socket;
    while (band(question) !== 'send') {
      await act.sleep(callWindow());
      const now = game()?.socket;
      if (socket && (now !== socket || socket.connected === false))
        throw Object.assign(Error(`The connection closed while ${question.method} waited for its call budget`), { reason: 'disconnected' });
    }
  }
  // A job call whose reply the server sends from inside its handler: it waits for
  // its send band, and a reply that has not come within `bound` (the call margin, unless the
  // caller's window is shorter) rejects as timed out and tells 12's bound record under `owner`: a
  // reply lost on the network.
  async function marginCall<T>(owner: string, act: Pick<ScopeHandle, 'sleep' | 'setTimeout' | 'clearTimeout'>, method: string,
    call: () => Promise<T>, label: string, data?: unknown, bound = margin()): Promise<T> {
    await wait({ band: 'job', method, data }, act);
    return new Promise<T>((resolve, reject) => {
      const timer = act.setTimeout(() => {
        boundFired({ bound: 'callMargin', owner, state: { method, label, ms: bound } });
        reject(Object.assign(Error(label + ' timed out'), { reason: 'timeout' }));
      }, bound);
      call().then(value => { act.clearTimeout(timer); resolve(value); }, error => { act.clearTimeout(timer); reject(error); });
    });
  }
  const calls = { band, margin, window: callWindow, wait, marginCall };
  // P5: core's retry as every enabled add-on's answer changes it, inside the bound. A realm with no
  // call budget makes no game call, so its floor is core's own wait.
  function policy(ask: Omit<RetryAsk, 'core'>, core: RetryPolicy): RetryPolicy {
    const floor = Math.max(core.wait, Number(ctx.answering('calls.window')[0]?.hooks['calls.window']!()) || 0);
    return ctx.answers('retry.policy', r => r.hooks['retry.policy']!({ ...ask, core }, ctx.settings(r.name))).reduce<RetryPolicy>((merged, { answer }) => ({
      wait: typeof answer.wait === 'number' && answer.wait > merged.wait ? Math.max(answer.wait, floor) : merged.wait,
      giveUp: merged.giveUp || answer.giveUp === true,
      counts: merged.counts || answer.counts === true,
    }), core);
  }
  return {
    // The call budget's question and margin, answered by the
    // character's budget (runtime/characters/call-budget.ts `callsRegistration`), which each install
    // publishes. A realm with no budget makes no game call, so a question there fails naming
    // the row instead of sending a call no budget counted.
    calls,
    retry: { policy },

    // The realm owner's reconnect: the events owner's A/B exit
    // rung asks it once per return cycle. With no answer nothing logs in, which the rung reports.
    // P12: the first enabled add-on's `hands.normal` answer. core:merchant-hands checks each hand
    // against the bound before it restores it.
    hands: {
      restore(): { mainhand?: unknown; offhand?: unknown } | undefined {
        for (const r of ctx.answering('hands.normal')) if (r.folder === 'addons') {
          const answer = ctx.call(r, 'hands.normal', () => r.hooks['hands.normal']!());
          if (answer) return answer;
        }
        return undefined;
      },
    },
    realm: {
      reconnect(character: string): 'sent' | 'not-now' { return ctx.answering('realm.reconnect')[0]?.hooks['realm.reconnect']!(character) ?? 'not-now'; },
    },
  };
}

// The hook coverage (addon:check rule 8):
// each decision of the files below with its hook or core-only reason, and each other export's plain kind.
export const RULE_FILES = ['runtime/characters/call-budget-limits.ts', 'runtime/merchant-realm/rules.ts', 'runtime/merchant-hands/rules.ts'] as const;
export const DECISIONS = {
  'send now or not now': { site: 'runtime/characters/call-budget.ts:707', core: 'call-budget', cite: 'runtime/characters/call-budget-limits.ts:5' },
  'margin and band limits': { at: 'runtime/characters/call-budget-limits.ts#bandLimits', core: 'call-budget', cite: 'runtime/characters/call-budget-limits.ts:5' },
  'which owner\'s realm want wins': { at: 'runtime/merchant-realm/rules.ts#wantRank', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'a job wants the realm': { at: 'runtime/merchant-realm/rules.ts#jobWant', core: 'tier-table', cite: 'runtime/protocol/ranks.ts:12' },
  'an add-on job\'s realm': { site: 'runtime/hooks/rows/08-merchant.ts:19', hook: 'merchant.jobKind' },
  'realm blacklist refusal': { at: 'runtime/merchant-realm/rules.ts#realmRefusal', hook: 'settings.overlay' },
  'normal equipment restore': { at: 'runtime/merchant-hands/rules.ts#normalItem', hook: 'hands.normal' },
} satisfies Record<string, DecisionRow>;
export const PLAIN = {
  // Facts the game fixes, which the console reads; an add-on's answer cannot change them.
  realmRequestArrived: 'read', gatheringTools: 'read', settleAnswer: 'read',
  validRealmBlacklist: 'validator',
} satisfies Record<string, PlainKind>;
