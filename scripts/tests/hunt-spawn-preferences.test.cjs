const test = require('node:test'), assert = require('node:assert/strict');
const {coordinatorHuntDestination} = require('../../runtime/hunting/coordinator/hunt.ts');
const {huntSpawnKey} = require('../../runtime/hunting/areas.ts');
const {createHuntRoutes} = require('../../runtime/hunting/coordinator/routes.ts');
const { settingsWriter } = require('./helpers/settings-writer.cjs');
const {loadFarmingRecord} = require('../../runtime/hunting/coordinator/record.ts');
const near = {map:'main',x:10,y:10}, preferred = {map:'arena',x:384,y:-420};
const catalog = [{id:'cgoo',locations:[near,preferred]}];
function response(){return {code:200,status(n){this.code=n;return this},json(v){this.value=v;return v}};}

test('manual, unavailable and cleared Hunt preferences use normal ranking', () => {
  const state = {leader:'W',statuses:{W:near},monsterChoices:catalog};
  const route = createHuntRoutes(state,{persist(){},now:()=>1,group:()=>null,write:settingsWriter(state).write}).settings;
  route({body:{preferredSpawns:{cgoo:huntSpawnKey(preferred)}}},response());
  const restored = {...state,...loadFarmingRecord(JSON.parse(JSON.stringify(state)),{},()=>1)};
  assert.equal(coordinatorHuntDestination(restored,'cgoo',false).map,'main');
  assert.equal(coordinatorHuntDestination(restored,'cgoo',true,spawn=>spawn.map==='arena').map,'main','a spent preference does not defeat recovery');
  route({body:{preferredSpawns:{cgoo:''}}},response());
  assert.equal(coordinatorHuntDestination(state,'cgoo').map,'main');
});
