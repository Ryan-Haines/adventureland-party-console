const test=require('node:test'),assert=require('node:assert/strict');
const {validateCatalog,createCatalogValidation}=require('../../runtime/coordinator/status/catalog-validation.ts');
const {consumeStatusCatalogs}=require('../../runtime/coordinator/status/catalogs.ts');
const definitions={monsters:{bee:{hp:300,achievements:[[10,'stat','dex',1]]}},skills:{attack:{cooldown:100}},items:{sword:{name:'Sword',upgrade:{attack:1},g:10}}};
const bestiary=[{id:'bee',definition:{...definitions.monsters.bee,max_hp:300}}];
const skills=[{id:'shared',skills:[{id:'attack',definition:definitions.skills.attack}]}];
const items={allItems:[{id:'sword',meta:{definition:{name:'Sword',g:10,id:'sword'}}}]};
test('unavailable installed definitions block catalogs and recover when readable',()=>{
 const {createInstalledCatalogValidation}=require('../../runtime/coordinator/status/catalog-validation.ts');
 let available=false;const messages=[];
 const validate=createInstalledCatalogValidation(12,()=>{if(!available)throw Error('missing');return definitions},m=>messages.push(m));
 assert.equal(validate('bestiaryCatalog',bestiary,12),false);assert.equal(messages.length,1);
 available=true;assert.equal(validate('bestiaryCatalog',bestiary,12),true);
});
test('all three catalogs validate their complete installed definitions, allowing game-derived fields',()=>{
 for(const [key,value] of [['bestiaryCatalog',bestiary],['skillCatalog',skills],['merchantCatalog',items]])assert.equal(validateCatalog(key,value,definitions),null);
});
test('missing, unknown, duplicate and changed definitions are rejected',()=>{
 assert.match(validateCatalog('bestiaryCatalog',[],definitions),/missing/);
 assert.match(validateCatalog('skillCatalog',[{skills:[]}],definitions),/missing/);
 assert.match(validateCatalog('merchantCatalog',{allItems:[]},definitions),/missing/);
 assert.match(validateCatalog('bestiaryCatalog',[{id:'ghost'}],definitions),/unknown/);
 assert.match(validateCatalog('bestiaryCatalog',[...bestiary,...bestiary],definitions),/duplicate/);
 assert.match(validateCatalog('bestiaryCatalog',[{id:'bee',definition:{hp:301}}],definitions),/mismatch/);
 assert.match(validateCatalog('skillCatalog',[{skills:[{id:'attack',definition:{cooldown:200}}]}],definitions),/mismatch/);
 assert.match(validateCatalog('merchantCatalog',{allItems:[{id:'sword',meta:{definition:{name:'Sword',g:11}}}]},definitions),/mismatch/);
});
test('shared class skills may repeat but every definition is checked',()=>{
 assert.equal(validateCatalog('skillCatalog',[...skills,...skills],definitions),null);
});
test('ingestion retains good catalogs, accepts corrections, and rejects unversioned or old clients',()=>{
 const messages=[],state={bestiaryCatalog:bestiary,validateCatalog:createCatalogValidation(12,definitions,m=>messages.push(m))};
 consumeStatusCatalogs({clientVersion:12,bestiaryCatalog:[]},state);assert.equal(state.bestiaryCatalog,bestiary);
 const corrected=structuredClone(bestiary);
 consumeStatusCatalogs({clientVersion:11,bestiaryCatalog:corrected},state);assert.equal(state.bestiaryCatalog,bestiary);
 consumeStatusCatalogs({bestiaryCatalog:corrected},state);assert.equal(state.bestiaryCatalog,bestiary);
 consumeStatusCatalogs({clientVersion:12,bestiaryCatalog:corrected},state);assert.equal(state.bestiaryCatalog,corrected);
 assert.ok(messages.some(m=>m.includes('validated')));
});
test('invalid startup catalogs remain absent so the normal catalog request continues',()=>{
 const state={bestiaryCatalog:null,skillCatalog:null,merchantCatalog:null,validateCatalog:createCatalogValidation(12,definitions,()=>{})};
 consumeStatusCatalogs({clientVersion:12,bestiaryCatalog:[],skillCatalog:[],merchantCatalog:{allItems:[]}},state);
 assert.equal(state.bestiaryCatalog,null);assert.equal(state.skillCatalog,null);assert.equal(state.merchantCatalog,null);
 consumeStatusCatalogs({clientVersion:12,bestiaryCatalog:bestiary,skillCatalog:skills,merchantCatalog:items},state);
 assert.equal(state.bestiaryCatalog,bestiary);assert.equal(state.skillCatalog,skills);assert.equal(state.merchantCatalog,items);
});
