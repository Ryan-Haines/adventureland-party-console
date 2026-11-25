// The character's farm reunion slice over a three-member party (a shared setup lives in the harness).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createMovementContext } = require('./movement-owner-callers.cjs');
const { installCrossings, installReunion } = require('../helpers/crossings.cjs');
const { drivePositions, targetingModule } = require('../helpers/targeting-module.cjs');
function runtime() {
  let now = 100000;
  const calls = [];
  // `lastDeathInfo` is shared.js's own variable (null until a death), which the slice leaves out.
  const r = createMovementContext({ root: {}, dungeonOwned: () => false, escapeOwns: () => false, lastDeathInfo: null, Date: { now: () => now }, coordinatorClockOffset: 0,
    character: { name: 'R', ctype: 'warrior', map: 'main', x: 0, y: 0, mp: 2000, max_mp: 3000, c: {} },
    parent: { server_region: 'US', server_identifier: 'II' },
    G: { maps: { main: {}, winterland: {}, bank: {}, arena: { event: 'test' } }, skills: { blink: { mp: 1600 }, magiport: { mp: 900 } } },
    partyLocation: { map: 'winterland', x: 20, y: -1109 }, desiredPartyMembers: ['R', 'M'], leader: 'M',
    farmingTravelToken: null, farmingMode:'default', farmingEntryPoint: location=>location,
    navigationIntent: { revision: 1 },
    runtimeCurrent: () => true, eventAttend: { active: () => null, joined: () => null, traveling: () => null }, engagedMonster: () => null, combatRecoveryHolds: () => false,
    is_transporting: () => false, is_on_cooldown: () => false, can_use: () => true, can_move_to: () => true,
    banking: false, bankQueued: false, stocking: false, upgrading: false, forceTraveling: false,
    townTraveling: false, partyTownActive: false, partyConvoyActive: false, groupWalk: {travel:null},
    kiteState: {}, eventRecoveryState: {}, stop: async () => calls.push('stop'), game_log() {},
    send_cm: async (name, data) => calls.push({ name, data }),
    use_skill: async (skill, target) => calls.push({ skill, target }),
    accept_magiport: async name => calls.push({ accepted: name }),
    sleep: async ms => { now += ms; }, nextReport: () => new Promise(() => {}),
    smart_move: async destination => { calls.push({ destination }); r.character.map = destination.map; },
    sharedPartyWalk: async destination => { calls.push({ destination, shared:true }); r.character.map = destination.map; },
    request: async () => {}, get_entity: id => r.parent.entities?.[id],
  });
  // The targeting owner's attacker rule (threat.ts `isAttackingPartyMember`) reads the party list on the tasks owner's door.
  targetingModule(r, {}, { tasks: { partyList: () => ['R', 'M'] } });
  drivePositions(r, [{ name: 'M', ctype: 'mage', map: 'winterland', x: 20, y: -1109, server: 'USII', seenAt: now, hp: 100 }]);
  // The death recovery's walk identity is survival's (recovery-member.ts), which the reunion reads.
  require('../helpers/survival-recovery.cjs').plantRecovery(r);
  r.deathRecoveryRequest = () => r.survivalCharacter.recovery.request();
  installCrossings(r);
  installReunion(r);
  return { r, calls, advance: ms => { now += ms; } };
}

module.exports = { runtime };
