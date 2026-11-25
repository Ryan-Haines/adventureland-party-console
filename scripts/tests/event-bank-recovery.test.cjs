// Native merchant status always reports all 42 inventory slots.
const {scenarioTable}=require('./fixtures/scenarios.cjs');
// The event rows run with the shared movement harness (fixtures/movement-owner-callers.cjs).
const { productionHarness } = require('./helpers/items-character.cjs');
const { createMovementContext } = require('./fixtures/movement-owner-callers.cjs');
const nativeInventory=(items=[])=>items.concat(Array(42-items.length).fill(null));
const test = require('node:test');
const assert = require('node:assert/strict');

test('bank ingredients schedule merchant auto-compound without an inventory triple', () => {
  const queued = [];
  const party = { merchantQueue: [], merchantCharacter: 'M', merchantAutomations: {}, autoCompounds: {
    M: [{ name: 'hpamulet', targetTier: 4, quantity: -1 }],
  }, bankSnapshot: { packs: { items0: Array.from({ length: 23 }, () => ({ item: { name: 'hpamulet', level: 0 } })) } } };
  const {createImprovementScheduler}=require('../../runtime/items/coordinator/production.ts');
  const scheduler=createImprovementScheduler(Object.assign(party,{production:party.production||{attempts:{}}}),{now:()=>100,nextCommand:()=>1,stamp:job=>job,
    log(){},persist(){},queue:names=>queued.push(names)});
  assert.equal(scheduler.compound('M', { items: nativeInventory([]) }), true);
  assert.equal(queued.length, 1);
});

// The items owner's merchantImprove (runtime/items/character/production.ts) on the items harness, with one
// automatic compound rule and the bag's free cells as its workspace. The character is no merchant, so
// compoundConfirmed calls the game's compound directly, with no production journal.
function improveRuntime({ items, bank, retrieve, compound }) {
  const character = { name: 'M', items, bank, gold: 0 };
  const h = productionHarness({ character, G: { items: { hpamulet: { compound: {} }, cscroll0: { g: 0 } }, skills: {} },
    bank: { bankRetrieveConfirmed: retrieve,
      retrieveFromBankUntil: async name => { items[items.indexOf(null)] = { name, q: 99 }; return { onPlayer: 1 }; } },
    ports: { request: async () => ({ craftProtection: { requirements: [] } }), findNpc: name => name, compound } });
  const improve = targetTier => h.production.merchantImprove({ type: 'merchant-self-improve',
    autoCompounds: [{ name: 'hpamulet', targetTier, quantity: 1 }] }, []);
  return { character, improve };
}
function batchRuntime(space, hasScroll = false) {
  const calls = [], items = Array(space).fill(null);
  if (hasScroll) items.push({ name: 'cscroll0', q: 1 });
  const r = improveRuntime({ items, bank: { items0: [
    { name: 'hpamulet', level: 0 }, { name: 'hpamulet', level: 1 },
    { name: 'hpamulet', level: 0 }, { name: 'hpamulet', level: 0 },
    { name: 'hpamulet', level: 0, l: 'l' },
  ] }, retrieve: async (pack, slot) => calls.push([pack, slot]) });
  return { r, calls };
}

test('withdraw only a matching triple and reserve the scroll slot', async () => {
  const { r, calls } = batchRuntime(4);
  await r.improve(1);
  assert.deepEqual(calls, [['items0', 0], ['items0', 2], ['items0', 3]]);
});

test('insufficient workspace fails before partial withdrawal; existing scroll needs no extra slot', async () => {
  const blocked = batchRuntime(3);
  await assert.rejects(blocked.r.improve(1), /inventory_full/);
  assert.equal(blocked.calls.length, 0);
  const ready = batchRuntime(2, true);
  ready.r.character.items.unshift({name:'hpamulet',level:0});
  await ready.r.improve(1);
  assert.equal(ready.calls.length, 2);
});

test('bank-backed improvement builds successive tiers without bulk withdrawals', async () => {
  const items = Array(8).fill(null), bank = { items0: Array.from({ length: 9 }, () => ({ name: 'hpamulet', level: 0 })) };
  let compounds = 0, withdrawals = 0;
  const r = improveRuntime({ items, bank,
    retrieve: async (pack, slot) => {
      items[items.indexOf(null)] = bank[pack][slot];
      bank[pack][slot] = null;
      withdrawals++;
    },
    compound: async (a, b, c, scroll) => {
      items[a] = { ...items[a], level: items[a].level + 1 };
      items[b] = items[c] = null;
      items[scroll] = { ...items[scroll], q: items[scroll].q - 1 };
      compounds++;
    } });
  await r.improve(2);
  assert.equal(withdrawals, 9);
  assert.equal(compounds, 4);
  assert.equal(items.filter(item => item && item.name === 'hpamulet' && item.level === 2).length, 1);
});

function eventRuntime() {
  const names = ['Q', 'D', 'H'];
  const cycle = { target: 'Q', endsAt: 2000, combatEvent: 'crabxx', combatHandoffAt: 1 };
  const destination = { map: 'cave', x: -194, y: -461 };
  const party = { leader: 'Q', combatMode: 'default', anniversary: { eventCycle: cycle },
    statuses: Object.fromEntries(names.map(name => [name, { map: 'main', x: 0, y: 0 }])),
    commands: {}, eventSessions: {}, deferredEventReturns: {}, eventReturn: { event: 'crabxx', pending: [], participants: names, checkpoint: destination } };
  let now = 1000, starts = 0;
  Object.assign(party, { nextCommandId: 1, merchantCharacter: 'M', followers: { D: true, H: true },
    location: destination, characterLocations: {}, navigationIntents: {} });
  Object.values(party.statuses).forEach(status => { status.seenAt = 1000; });
  const r = createMovementContext({ party, Date: { now: () => now }, activeNames: () => names,
    eventsEnabledFor: () => true, eventCheckpoint: () => destination,
    anniversaryCombatParticipants: () => names, selectedMonsterDestination: () => null,
    persistSettings() {}, startPartyMonsterConvoy: () => { starts++; party.activeConvoy = { id: 'convoy' }; return true; },
    beginEventReturn: () => { throw new Error('unexpected orphan recovery'); } });
  r.farmingNavigation = require('./helpers/farming-navigation.cjs')(party, { names: () => names, activeNames: () => names,
    now: () => now, persist() {}, log() {}, cancelConvoy: () => { party.activeConvoy = null; },
    startConvoy: (...args) => r.startPartyMonsterConvoy(...args) });
  Object.assign(r, require('./helpers/coordinator-events.cjs').eventService(r));
  return { party, r, setTime: value => now = value, starts: () => starts };
}

scenarioTable('an event return runs over the event runtime',eventRuntime,[
 ['combat handoff skips featured waiting, retains ownership until arrival, then clears it',t => {
  assert.equal(t.r.finishEventReturnIfReady(), true);
  assert.ok(t.party.eventReturn);
  t.setTime(2001);
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 1);
  assert.ok(t.party.eventReturn.convoyId);
  t.party.activeConvoy = null;
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 1, 'no retry before a member reports after the dispatch (K6 re-issue)');
  t.setTime(4002);
  Object.values(t.party.statuses).forEach(status => { status.seenAt = 4002; });
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 2, 'the party still in town retries together, without waiting for someone at the farm');
  assert.equal(t.party.activeConvoy.id,t.party.eventReturn.convoyId);
  t.party.activeConvoy = null;
  Object.values(t.party.statuses).forEach(status => Object.assign(status, { map: 'cave', x: -194, y: -461 }));
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn, null);
  assert.equal(t.party.anniversary.eventCycle.returnCompletedAt, 4002);
}],
 ['reload restores missing town commands without overwriting another command',t => {
  t.party.nextCommandId = 1;
  t.party.eventReturn.pending = ['Q', 'D'];
  t.party.eventReturn.cycleId = 'return';
  t.party.commands.D = { type: 'existing-work' };
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.commands.Q.type, 'event-return-town');
  assert.equal(t.party.commands.Q.cycleId, 'return');
  assert.equal(t.party.commands.D.type, 'existing-work');
}],
 ['old orphaned anniversary handoff reconstructs the combat return',t => {
  t.setTime(2001);
  t.party.eventReturn = null;
  // EV12: the handoff's captured list is used as captured, so the members return though
  // none reports the ended event any more.
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn.event, 'crabxx');
  assert.equal(t.party.eventReturn.pending.length, 3);
  t.party.eventReturn = null;
  t.party.statuses.D.serverLiveEvents = [{ name: 'crabxx' }];
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn, null, 'a still-live combat event retains control');
}],
 ['a new featured round regroups every participant and resumes only after expiry',t => {
  t.party.nextCommandId = 1;
  t.party.eventReturn.startedAt = 10;
  t.party.eventReturn.cycleId = 'return';
  t.party.eventReturn.convoyId = 'old';
  t.party.activeConvoy = { id: 'old' };
  Object.assign(t.party.anniversary.eventCycle, { id: 'new-round', stagedAt: 20 });
  delete t.party.anniversary.eventCycle.combatHandoffAt;
  delete t.party.anniversary.eventCycle.combatEvent;
  t.r.cancelActiveConvoy = () => { t.party.activeConvoy = null; };
  t.r.reconcileCombatEventReturn();
  assert.equal(t.party.eventReturn.pending.length, 3);
  assert.equal(Object.values(t.party.commands).filter(command => command.type === 'event-return-town').length, 3);
  t.party.eventReturn.pending = [];
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 0);
  t.setTime(2001);
  t.r.reconcileCombatEventReturn();
  assert.equal(t.starts(), 1);
}],
// The return half: the merchant leaves an event on its
// own return, a Town and a walk of its own, and is never a participant of the party's return.
 ['the merchant leaves an event on its own return, outside the party return',t => {
  t.party.eventReturn = null; t.party.anniversary = {};
  t.party.statuses.M = { map: 'halloween', x: 0, y: 0, seenAt: 1000 };
  t.r.activeNames = () => ['Q', 'D', 'H', 'M'];
  const recovery = t.r.beginEventReturn('mrpumpkin');
  assert.ok(recovery, 'precondition: the party return starts');
  assert.equal(recovery.participants.includes('M'), false, 'the merchant is no participant of the party return');
  assert.equal(recovery.pending.includes('M'), false, 'the party return never waits for the merchant');
  assert.equal(t.party.deferredEventReturns.M?.phase, 'merchant-return', 'the merchant has its own return');
}],
]);

