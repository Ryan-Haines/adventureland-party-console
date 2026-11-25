const test = require('node:test'), assert = require('node:assert/strict');
const {createPartyConvoys} = require('../../runtime/movement/coordinator/walk.ts');
const {createHuntMode} = require('../../runtime/tasks/coordinator/slots.ts');

// modes.ts `authorize`: with no place known the walk stays released, since farm.ts would save an
// empty place as the party's.
test('Hunt entry with an exhausted destination and no quest id authorizes no walk', () => {
  const calls = [], state = {leader: 'L', combatMode: 'auto', monsterHunt: null,
    monsterHunterLocation: null, statuses: {}, monsterFocus: [], monsterFocusByCharacter: {}};
  const {createHuntEntry} = require('../../runtime/hunting/coordinator/modes.ts');
  const mode = createHuntMode(state, {write:require('./helpers/settings-writer.cjs').settingsWriter(state).write, entry: createHuntEntry(state, {participants: () => ['L'], release: () => {}, clear: () => {},
    monsterDestination: id => {calls.push(['destination', id]); return undefined;},
    authorize: (names, location, shared) => calls.push(['authorize', names, location, shared]),
    begin: () => {}})});
  mode.select({targetMode:'hunt'}, null, undefined, false);
  assert.deepEqual(calls, [['destination', undefined]]);
});

test('convoy replacement history retains each destination and navigation revision',()=>{
 let sequence=1;
 const state={leader:'L',merchantCharacter:null,followers:{},statuses:{L:{map:'main',x:0,y:0,seenAt:1000,speed:60}},
  activeConvoy:null,commands:{},combatLogs:{},navigationEpoch:0,monsterHunt:{stage:'mission-travel',target:'cgoo'}};
 const convoys=createPartyConvoys(state,{now:()=>1000,nextCommand:()=>sequence++,activeNames:()=>['L'],
  intent:()=>({revision:7}),resolve:x=>x,persist(){},live:()=>({kind:'hunt-mission',tier:'hunt-mission',owner:'hunt'})});
 convoys.start({map:'arena',x:384,y:-420},'hunt cgoo',undefined,'monster-hunt');
 const first=state.activeConvoy.id;
 convoys.start({map:'main',x:100,y:200},'next hunt',undefined,'monster-hunt');
 const entries=state.combatLogs.L;
 assert.deepEqual(entries.map(e=>e.message),['Convoy started','Convoy cancelled','Convoy started']);
 assert.equal(entries[0].details.destination.map,'arena');assert.equal(entries[1].details.convoyId,first);
 assert.equal(entries[2].details.replacedConvoyId,first);assert.equal(entries[2].details.destination.map,'main');
 assert.equal(entries[2].details.revisions.L,7);
});


