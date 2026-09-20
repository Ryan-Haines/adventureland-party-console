const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '../..');
const dashboard = require('./helpers/dashboard-source.cjs')();
const shared = fs.readFileSync(path.join(root, 'characters/shared.js'), 'utf8');
const coordinator = require('./helpers/coordinator-source.cjs').coordinatorSource();

test('monster achievement telemetry preserves the account score owner', () => {
  assert.match(shared, /monsterAchievementProgress/);
  assert.match(shared, /owner: accountOwner/);
  assert.match(dashboard, /High score: \{progress\.owner\}/);
});

test('bestiary uses the shared popup instead of a selected-monster sidebar', () => {
  const bestiary = dashboard.slice(dashboard.indexOf('function BestiaryDialog('),
    dashboard.indexOf('function MonsterAchievementProgress('));
  assert.doesNotMatch(bestiary, /<aside/);
  assert.match(bestiary, /onInspectMonster\(monster\)/);
  assert.match(dashboard, /function MonsterDetailsDialog\(/);
});

test('manual monster navigation is an atomic auto-mode convoy override', () => {
  const {createMonsterSelection}=require('../../runtime/coordinator/navigation/monster-selection.ts');
  const party={leader:'L',followers:{F:true},monsterFocusByCharacter:{F:['bat']},scatterEpoch:1,commands:{L:{type:'party-monster-travel'}}};
  let cleared=0,authorized;
  const service=createMonsterSelection(party,{release(){},clearHunt:()=>cleared++,members:()=>['L','F'],authorize:(...args)=>authorized=args,
    start:()=>true,stopPhoenix(){},persist(){}});
  const location={map:'main',x:1,y:2};service.select('goo',location);
  assert.equal(party.farmingPolicy,'auto');assert.deepEqual(party.monsterFocus,['goo']);assert.equal(cleared,1);
  assert.equal(party.commands.L.manualMonsterOverride,true);assert.deepEqual(authorized,[['L','F'],location,true]);
});

test('monster picker defers checked-first ordering until it closes', () => {
  const picker = dashboard.slice(dashboard.indexOf('function MonsterFocusPicker('),
    dashboard.indexOf('function Meter('));
  assert.match(picker, /if \(!nextOpen\)/);
  assert.match(picker, /selectionDraft\.includes\(id\)/);
});
