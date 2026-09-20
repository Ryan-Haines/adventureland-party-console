const test=require('node:test');
const assert=require('node:assert/strict');
const {consumeStatusCatalogs,consumeBankVaults,consumeOneShotReports}=require('../../runtime/coordinator/status/catalogs.ts');
const {consumeBankReport}=require('../../runtime/coordinator/status/bank.ts');
const {consumePontyReport}=require('../../runtime/coordinator/status/ponty.ts');

test('catalog discovery removes report payloads while retaining prior nonempty catalogs',()=>{
 const state={travelPlaces:['existing'],bestiaryCatalog:[],skillCatalog:[],monsterChoices:[],monsterHunterLocation:null,appearanceChoices:null,merchantCatalog:null,merchantCatalogVersion:null,bankVaults:['old']};
 const body={name:'P',travelPlaces:[],monsterChoices:[{id:'goo'}],monsterLocationsVersion:'4',monsterHunterLocation:{map:'main',x:'10',y:'20'},
  merchantCatalog:{version:12},skillCatalog:[{id:'attack'}],bankVaults:[],hp:100};
 consumeStatusCatalogs(body,state);assert.deepEqual(state.travelPlaces,['existing']);assert.equal(state.monsterLocationsVersion,4);
 assert.deepEqual(state.monsterHunterLocation,{map:'main',x:10,y:20});assert.equal(state.merchantCatalogVersion,12);
 assert.deepEqual(body,{name:'P',bankVaults:[],hp:100});consumeBankVaults(body,state);assert.deepEqual(state.bankVaults,[]);
 assert.deepEqual(body,{name:'P',hp:100});
});

test('scatter learning respects epochs, validates IDs, and strips one-shot fields',()=>{
 const state={types:['goo'],epoch:2};
 const stale={oneShotMonsterTypes:['rat'],oneShotEpoch:1};consumeOneShotReports(stale,state);assert.deepEqual(state.types,['goo']);
 const body={oneShotMonsterTypes:['goo','rat','bad type',1,'rat'],oneShotEpoch:2};assert.deepEqual(consumeOneShotReports(body,state),['rat','rat']);
 assert.deepEqual(state.types,['goo','rat','rat']);assert.deepEqual(body,{});
});

test('bank observation deduplicates unchanged content but adopts staging before persistence on a change',()=>{
 const state={snapshot:null,observer:null},effects=[];
 const ports={now:()=>100,adoptReservedCargo:()=>effects.push(['adopt',state.snapshot.character]),persist:()=>effects.push('persist')};
 const report=()=>({name:'M',bank:{packs:{items1:[]},gold:10}});
 const first=report();consumeBankReport(first,state,ports);assert.deepEqual(first,{name:'M'});assert.deepEqual(effects,[['adopt','M'],'persist']);
 consumeBankReport(report(),state,ports);assert.equal(effects.length,2);consumeBankReport({name:'M'},state,ports);assert.equal(state.observer,null);
 consumeBankReport(report(),state,ports);assert.equal(effects.length,4);
});

test('local Ponty reports preserve realm keys, reject invalid offers, and do not overwrite an error-free observation on an error',()=>{
 const body={name:'M',server:'USII',ponty:{updatedAt:100,listings:[{rid:'r',item:{name:'coat'},price:50},{rid:'bad',item:{name:'coat'},price:0}]}};
 const result=consumePontyReport(body,'M',item=>item.name);assert.deepEqual(result.report,{realm:'US:II',seenAt:100});
 assert.equal(result.listings.length,1);assert.equal(result.listings[0].key,'US:II:r');assert.equal(body.ponty,undefined);
 const failed=consumePontyReport({name:'M',ponty:{error:'offline'}},'M',item=>item.name);assert.equal(failed.report,undefined);
 const other={name:'P',ponty:{listings:[]}};assert.equal(consumePontyReport(other,'M',item=>item.name),null);assert.equal(other.ponty,undefined);
});
