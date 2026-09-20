const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {loadCoordinatorBankVaults,createCoordinatorGameData}=require('../../runtime/coordinator/infrastructure/game-data.ts');
function ports(read){const calls=[],warnings=[];return {calls,warnings,read,evaluate:(source,context,filename)=>{calls.push({context,filename});return vm.runInNewContext(source,context,filename?{filename}:undefined);},warn:(...args)=>warnings.push(args)};}
test('vault data preserves numeric ordering, floor keys and price coercion',()=>{
 let path;const p=ports(value=>{path=value;return 'var bank_packs={items10:["bank_u","25",2],items2:["bank",0,"bad"],items3:["bank_b",1,0]}; var character_slots=[];';});
 const result=loadCoordinatorBankVaults(123,p);assert.equal(path,'./game_files/123/old_common_functions.js');assert.deepEqual(result.map(x=>x.pack),['items2','items3','items10']);
 assert.equal(result[0].shells,0);assert.equal(result[0].key,null);assert.equal(result[1].key.id,'bkey');assert.equal(result[2].gold,25);assert.equal(result[2].key.id,'ukey');assert.equal(Object.getPrototypeOf(p.calls[0].context),null);
});
test('invalid vault sources warn and return an empty list',()=>{
 for(const read of [()=>'',()=>{throw Error('missing');},()=> 'var bank_packs={oops:}; var character_slots=[];']){const p=ports(read);assert.deepEqual(loadCoordinatorBankVaults('v',p),[]);assert.equal(p.warnings.length,1);}
});
test('game map loading caches success and retains the original path and diagnostic filename',()=>{
 const paths=[],p=ports(path=>{paths.push(path);return 'var G={geometry:{main:{min_x:1}}};';});
 const loader=createCoordinatorGameData('/host','v',p),data=loader.load();assert.equal(loader.load(),data);assert.equal(data.geometry.main.min_x,1);assert.deepEqual(paths,['/host/../game_files/v/data.js']);assert.equal(p.calls[0].filename,'game_files/v/data.js');
});
test('failed game loads retry while an absent G caches an empty catalog',()=>{
 let attempts=0;const p=ports(()=>{if(++attempts===1)throw Error('missing');return '';});const loader=createCoordinatorGameData('/host',1,p);
 assert.throws(()=>loader.load(),/missing/);const data=loader.load();assert.deepEqual(data,{});assert.equal(loader.load(),data);assert.equal(attempts,2);
});
