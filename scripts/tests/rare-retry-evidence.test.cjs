const test=require('node:test'),assert=require('node:assert/strict');
// The hunting owner's rare service keeps its rejections (coordinator/rares.ts `reject`, `renewed`) and the load
// projects old saved ones (record.ts `loadRareRejections`).
const {rareRejection}=require('../../runtime/hunting/coordinator/rares.ts');
const {loadFarmingRecord}=require('../../runtime/hunting/coordinator/record.ts');
const {fixture}=require('./fixtures/rare-hunting-scenario.cjs');
test('rejection receipts project heartbeat positions and the load trims bloated saved receipts',()=>{
 const sight={id:'phoenix',mtype:'phoenix',map:'main',x:10,y:0,hp:100,seenAt:1000,realm:':USII',in:'main',reporter:'P'};
 const heartbeat={map:'main',x:0,y:0,items:[{meta:'x'.repeat(1000000)}],combatTrace:[],groupedCombat:{}};
 const loaded=loadFarmingRecord({rareRetryEvidence:{legacy:{sight:{...sight,extra:heartbeat},origin:heartbeat}}},{},()=>1).rareRetryEvidence;
 assert.deepEqual(loaded.legacy.origin,{map:'main',x:0,y:0});assert.ok(JSON.stringify(loaded).length<1000);
 const kept=rareRejection(sight,heartbeat);heartbeat.x=99;sight.hp=1;
 assert.deepEqual([kept.origin.x,kept.sight.hp],[0,100]);
});
// A rejected rare is tried again only on a newer sighting with less HP, newly engaged by the party or
// newly in reach, on the group's map; an unchanged or older sighting leaves it rejected.
test('unchanged rejected rare evidence stays rejected; a newer sighting with less HP admits it again',()=>{
 const r=fixture(),key=':USII|main|main|phoenix';
 r.party.rareRetryEvidence={[key]:{sight:{id:'phoenix',mtype:'phoenix',map:'main',in:'main',realm:':USII',x:20,y:10,hp:5600,seenAt:r.time()},origin:{map:'main',x:0,y:0}}};
 r.advance(1000);r.sight();assert.equal(r.controller.encounter(),false);assert.ok(r.party.rareRetryEvidence[key]);
 r.advance(1000);r.sight('phoenix','W',{hp:5500});assert.equal(r.party.rareRetryEvidence[key],undefined);
});

// HN21: the retry rejection keys on the end code the encounter sets, never on its message text.
test('HN21 only a released or no-progress end rejects the rare', () => {
 const {rareEndRejects,rareEndLabel}=require('../../runtime/hunting/rules.ts');
 for (const code of ['released','no-progress']) assert.equal(rareEndRejects(code),true,code);
 for (const code of ['killed','died','disabled','claimed','interrupted']) assert.equal(rareEndRejects(code),false,code);
 assert.match(rareEndLabel('no-progress','Phoenix'),/no progress/);
});
