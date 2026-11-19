const test=require('node:test'), assert=require('node:assert/strict');
const {validPassivePatch}=require('../../runtime/hunting/saved-fields.ts');
const {createMonsterSelectionRoutes}=require('../../runtime/hunting/coordinator/routes.ts');
function fixture(){
 let code=200,response,writes=0;
 const party={passiveRareHunts:{tinyp:true,phoenix:false,goldenbat:false,cutebee:false}};
 const route=createMonsterSelectionRoutes(party,{validPassive:validPassivePatch,
  setPassive(settings){Object.assign(party.passiveRareHunts,settings);writes++;return {ok:true};}}).passive;
 return {party,writes:()=>writes,post(body){code=200;response=null;const res={status(value){code=value;return res;},json(value){response=value;return res;}};route({body},res);return {code,response};}};
}
test('invalid passive settings are rejected without changing saved preferences',()=>{
 const f=fixture();const before={...f.party.passiveRareHunts};
 for(const body of [{boar:true},{goldenbat:'true'},{cutebee:1},['goldenbat'],{tinyp:true,unknown:false}])assert.equal(f.post(body).code,400);
 assert.deepEqual(f.party.passiveRareHunts,before);assert.equal(f.writes(),0);
 // A valid patch is the control: the route answers 200 and hands the writer the one change.
 assert.equal(f.post({goldenbat:true}).code,200);
 assert.equal(f.writes(),1);assert.equal(f.party.passiveRareHunts.goldenbat,true);assert.deepEqual(f.party.passiveRareHunts,{...before,goldenbat:true});
});

// The hunting owner's load migration (runtime/hunting/coordinator/record.ts `migrateRareRules`).
test('an old save\'s rare switches become rules through one writer write, and a migrated save writes nothing',()=>{
 const {migrateRareRules}=require('../../runtime/hunting/coordinator/record.ts');
 const writes=[],logs=[];
 const write=batch=>{writes.push(batch);for(const c of batch.changes)party[c.field]=c.value;return {ok:true};};
 const party={passiveRareHunts:{phoenix:true,tinyp:false}};
 migrateRareRules(party,write,m=>logs.push(m));
 assert.equal(writes.length,1);assert.equal(writes[0].by,'console:hunting');
 assert.deepEqual(writes[0].changes.map(c=>c.field),['passiveHunting','passiveRareHunts']);
 assert.equal(party.passiveHunting.version,1);assert.equal(party.passiveHunting.rules.phoenix.enabled,true);
 migrateRareRules(party,write,m=>logs.push(m));
 assert.equal(writes.length,1,'a migrated save writes nothing');assert.deepEqual(logs,[]);
});
