import {createContext,runInContext} from 'node:vm';
import path from 'node:path';
// The saved character inspection route: the character's saved profile read from the game's account
// API. Moved from runtime/coordinator/characters/inspection.ts into the lifecycle owner's coordinator folder.
import {requestObject,type HttpHandler} from '../http.ts';
import type {Item} from '../../coordinator/contracts/item.ts';
import { hiddenValue } from '../../settings/coordinator/api.ts';
import { boundFired } from '../../status/coordinator/api.ts';
import {maximumItemLevel} from '../../items/api.ts';
import {reportedStats} from '../../status/api.ts';

interface NativeProjection { game:Record<string,unknown>; project(type:string,level:number,slots:Record<string,unknown>,map:string):Record<string,unknown>; properties(item:Item):Record<string,unknown> }
type ProfileFetch=(url:string,options:{method:string;headers:Record<string,string>;body:string;signal:AbortSignal})=>Promise<{ok:boolean;json():Promise<unknown>}>;
export interface InspectionPorts {
 owned(name:string):boolean; now():number; version():number; directory:string;
 read(file:string):string;
 // The account session and the HTTP client the game's account API takes.
 session():string|undefined;
 loadFetch():Promise<ProfileFetch>;
 // The status owner's merchant catalog, whose items carry each item's card data.
 catalog():unknown;
 // The coordinator log, which records why an inspection shows no derived stats or item properties.
 log(message:string):void;
}
const reason=(error:unknown)=>error instanceof Error?error.message:String(error);
/** Native sources are the installed game's own cached assets, evaluated once
 * per version. Projection intentionally omits temporary effects/private boosts. */
function nativeProjection(ports:InspectionPorts):NativeProjection {
 const directory=path.resolve(ports.directory,'../game_files',String(ports.version()));
 const context=createContext({Place:'client'},{codeGeneration:{strings:false,wasm:false}});
 const timeout=hiddenValue('gameScriptEvalMs');
 for(const filename of ['data.js','old_common_functions.js','stats.js'])runInContext(ports.read(path.join(directory,filename)),context,{filename,timeout});
 runInContext('process_game_data(); var inspectionHelpers=ProgressionStats.helpers(G,{characterSlots:character_slots,doublehandTypes:doublehand_types});var inspectionProject=ProgressionStats.create(G,inspectionHelpers);',context,{timeout});
 return {game:context.G,project:(type,level,slots,map)=>JSON.parse(JSON.stringify(context.inspectionProject(type,level,slots,map))),properties:item=>JSON.parse(JSON.stringify(context.inspectionHelpers.itemProperties(item)))};
}
const itemKeys=['name','level','q','l','b','p','stat_type','rid','gift','expires','acl'];
function item(raw:unknown):(Item & {name:string})|null {const value=requestObject(raw);if(typeof value.name!=='string')return null;return Object.fromEntries(itemKeys.filter(key=>key in value).map(key=>[key,value[key]])) as Item & {name:string};}
const number=(value:unknown)=>Number.isFinite(Number(value))?Number(value):0;
// The saved profile from the game's account API. A game server that never answers is an outside
// failure: inspectionFetchBoundMs (fields.ts) ends the read and tells the status owner's bound record.
async function fetchProfile(ports:InspectionPorts,name:string):Promise<unknown>{
 const fetch=await ports.loadFetch(),signal=AbortSignal.timeout(hiddenValue('inspectionFetchBoundMs'));
 try{
  const response=await fetch('https://adventure.land/api/mainframe_get_character',{method:'POST',headers:{Cookie:'auth='+ports.session(),'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({character:name}).toString(),signal});
  if(!response.ok)throw Error('Could not read saved character from the game');
  return await response.json();
 }catch(error){
  // The bound's own signal says it tripped: node-fetch rejects an aborted request as `AbortError`,
  // never as the signal's `TimeoutError`.
  if(signal.aborted)boundFired({bound:'inspectionFetchBoundMs',owner:'13',subject:name,state:{name}});
  throw error;
 }
}
// The catalog's items, or none while the catalog holds no item list.
function catalogItems(ports:InspectionPorts):unknown[]{const entries=requestObject(ports.catalog()).allItems;return Array.isArray(entries)?entries:[];}
export function characterInspectionRoute(ports:InspectionPorts):HttpHandler {
 const cache=new Map<string,{at:number;value:unknown}>(),pending=new Map<string,Promise<unknown>>();
 let preparedVersion:number|undefined,native:NativeProjection|undefined;
 function prepare(){
  if(preparedVersion===ports.version())return;
  preparedVersion=ports.version();
  try{native=nativeProjection(ports);}
  catch(error){
   native=undefined;
   // gameScriptEvalMs (fields.ts): the game's cached files ran past the bound, so the inspection
   // shows the saved profile without derived stats; the firing is a finding to trace.
   if((error as {code?:string})?.code==='ERR_SCRIPT_EXECUTION_TIMEOUT')
    boundFired({bound:'gameScriptEvalMs',owner:'13',subject:String(ports.version()),state:{version:ports.version()}});
   // A missing or broken game file leaves every inspection of this version without derived stats.
   else ports.log('game '+ports.version()+' files gave no stat projection: '+reason(error));
  }
 }
 async function inspect(name:string){
  const cached=cache.get(name);if(cached && ports.now()-cached.at<hiddenValue('inspectionReuseMs'))return cached.value;
  if(pending.has(name))return pending.get(name);
  const operation=(async()=>{
   const reply=requestObject(await fetchProfile(ports,name)),profile=requestObject(reply.profile);
   if(reply.success!==true || profile.name!==name || typeof profile.class!=='string' || !Array.isArray(profile.inventory) || !profile.equipment)throw Error('The game did not return an owned saved character profile');
   const ctype=profile.class;
   prepare();
   const equipment=Object.fromEntries(Object.entries(requestObject(profile.equipment)).map(([slot,entry])=>[slot,item(entry)]));
   let calculated:Record<string,unknown>|undefined;
   try{calculated=native?.project(ctype,number(profile.level),equipment,String(profile.map||'main'));}
   catch(error){calculated=undefined;ports.log(name+"'s saved stats did not project: "+reason(error));}
   function entry(raw:unknown,slot?:number){const owned=item(raw);if(!owned)return null;const known=catalogItems(ports).find(entry=>requestObject(entry).id===owned.name);const knownMeta=requestObject(known).meta;let meta=requestObject(knownMeta);if(native){const definition=requestObject(requestObject(native.game.items)[owned.name]);try{meta={...meta,definition,properties:native.properties(owned),upgradeable:!!definition.upgrade,compoundable:!!definition.compound,scaling:definition.upgrade || definition.compound || {},maxLevel:maximumItemLevel(definition)};}
    // The card keeps the catalog's data for this item; the log says why it has no game properties.
    catch(error){ports.log(name+"'s "+owned.name+' has no game properties: '+reason(error));}}return{...(slot===undefined?{}:{slot}),item:owned,meta};}
   const stats=calculated || {},base={name,ctype,level:number(profile.level),xp:number(profile.xp),max_xp:number(requestObject(native?.game.levels)[String(profile.level)]),
    hp:number(profile.hp),mp:number(profile.mp),gold:number(profile.gold),map:String(profile.map||'unknown'),x:number(profile.x),y:number(profile.y),
    rip:profile.rip===true,banking:false,seenAt:0,updatedAt:ports.now(),
    items:profile.inventory.map((raw,slot)=>entry(raw,slot)),slots:Object.fromEntries(Object.entries(equipment).map(([slot,raw])=>[slot,entry(raw)])),
    max_hp:number(stats.max_hp),max_mp:number(stats.max_mp),
    inspection:{source:'account-snapshot',calculated:!!calculated,synchronizedAt:typeof profile.synchronized_at==='string'?profile.synchronized_at:null,note:calculated?'Calculated from saved level and equipment; temporary effects and private account bonuses are not included.':'Derived stats unavailable for this saved profile.'}};
   // The saved profile's stats carry the report's names through the status owner's one mapping (reportedStats).
   const value={character:{...base,primaryStat:requestObject(requestObject(native?.game.classes)[ctype]).main_stat,...(calculated?{...reportedStats(calculated),speed:number(calculated.speed)}:{})}};
   cache.set(name,{at:ports.now(),value});return value;
  })();pending.set(name,operation);try{return await operation;}finally{pending.delete(name);}
 }
 return async(req,res)=>{
  const name=req.params.name;
  if(!name || !ports.owned(name))return res.status(404).json({error:'Character is not owned by this account'});
  try{return res.json(await inspect(name));}
  catch(error){return res.status(502).json({error:error instanceof Error?error.message:'Could not read saved character'});}};
}
