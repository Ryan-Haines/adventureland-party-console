const test=require('node:test'),assert=require('node:assert/strict');
const {rememberCharacterAppearance}=require('../../runtime/coordinator/status/character-appearance.ts');
const {initialSteamRoster}=require('../../runtime/coordinator/characters/initial-roster.ts');
const {selectSnapshot,rosterFields}=require('../../runtime/coordinator/persistence/snapshots.ts');
const {createStatusIngestion}=require('../../runtime/coordinator/status/ingestion.ts');
const image={url:'https://adventure.land/images/character.png',tileSize:24,columns:4,rows:4,x:0,y:0};
const report={name:'Offline',skin:'actual-skin',characterSprite:image,characterDollHtml:'<img src="https://adventure.land/images/character.png">'};

test('appearance survives roster serialization and coordinator restart without restoring live status',()=>{
 const state={statuses:{},headlessSlots:[],nativeOwner:null,steamMembers:[],steamSwitch:null};
 assert.equal(rememberCharacterAppearance(state,report,100),true);
 const saved=JSON.parse(JSON.stringify(selectSnapshot(state,rosterFields)));
 const restored=initialSteamRoster(saved);
 assert.deepEqual(restored.characterAppearances.Offline,state.characterAppearances.Offline);
 assert.deepEqual(restored.lifecycle,{});assert.equal(restored.statuses,undefined);
 assert.equal(rememberCharacterAppearance(restored,report,200),false);
 assert.equal(restored.characterAppearances.Offline.updatedAt,100);
});
test('missing appearance does not erase a doll; changes refresh it without mixing different skins',()=>{
 const state={};rememberCharacterAppearance(state,report,100);
 assert.equal(rememberCharacterAppearance(state,{name:'Offline',characterDollHtml:null},200),false);
 assert.equal(rememberCharacterAppearance(state,{...report,characterDollHtml:'<img src="new-cosmetic.png">'},300),true);
 assert.equal(state.characterAppearances.Offline.updatedAt,300);
 rememberCharacterAppearance(state,{...report,skin:'new-skin',characterSprite:{...image,x:1},characterDollHtml:null},400);
 assert.equal(state.characterAppearances.Offline.characterDollHtml,null);
 assert.equal(state.characterAppearances.Offline.characterSprite.x,1);
 assert.equal(rememberCharacterAppearance(state,{name:'NeverSeen',characterSprite:{}},500),false);
 assert.equal(state.characterAppearances.NeverSeen,undefined);
});
test('full authenticated heartbeats persist appearance once and unknown reporters cannot populate the cache',()=>{
 const state={statuses:{},headlessSlots:[],steamMembers:[],steamSwitch:null,nativeOwner:null,merchantCharacter:null};let saves=0;
 const ports=new Proxy({now:()=>100,known:n=>n==='Offline',persistRoster:()=>saves++,oneShots:()=>[],huntSnapshot:()=>'',response:()=>({ok:true})},{get:(o,k)=>o[k]||(()=>{})});
 const api=createStatusIngestion(state,ports),res={status(){return this;},json(){}};
 api.handle({body:{...report}},res);assert.equal(saves,1);assert.ok(state.characterAppearances.Offline);
 api.handle({body:{...report}},res);assert.equal(saves,1);
 api.handle({body:{...report,name:'Stranger'}},res);assert.equal(state.characterAppearances.Stranger,undefined);
 delete state.statuses.Offline;assert.ok(state.characterAppearances.Offline);
});
