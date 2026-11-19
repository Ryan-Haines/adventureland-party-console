import {expect} from './network-clock';
import type {LiveClient} from './live-game-client';
import type {LiveGame} from './live-fixtures';
import {fighters} from './game/hunt-lifecycle';
import {scriptSeconds,spendWindow,TURNS_METER,meterDelta} from './turns-rows';

// The combat movers of characters/shared.js. A native move whose stack holds one of them
// is a combat move; a combat move to where the character stands is a combat stop packet.
export const COMBAT=/\b(sendCombatMove|groupedMovement|recoverFarmApproach|separateFromParty|holdFormation|resetCombatMovement|solveFormationMove)\b/;

const ROUTINES_OFF={priorities:{},enabled:{'merchant idle':false,'stand maintenance':false}};
const fresh=(report:any)=>report?.runtime==='native'&&Date.now()-report.seenAt<3000;

// Setup posts (/formation, /focus) change a character's navigation revision, and the
// heartbeat that delivers it ends any journey already walking (applyNavigationIntent).
// The scripted calls start only after the client holds the revision of a heartbeat
// sent after setup.
export async function settleNavigation(client:LiveClient,name:string){
  const revisions:number[]=[];
  // Observes responses without handling them, so fixture routes keep their order.
  const observe=(response:any)=>{
    if(!response.url().endsWith('/party-api/status'))return;
    let body:any;
    try{body=response.request().postDataJSON();}catch{return;}
    // All native clients share this page; the body names its character.
    if(body?.name!==name)return;
    response.json().then((json:any)=>{if(typeof json?.navigationIntent?.revision==='number')revisions.push(json.navigationIntent.revision);},()=>{});
  };
  client.page.on('response',observe);
  try{
    // A character sends one heartbeat at a time, so the second response answers a
    // heartbeat sent after this observer started.
    await expect.poll(async()=>revisions.length>1&&
      await client.run('globalThis.__partyNavigationIntent?.revision')===revisions.at(-1),{timeout:15_000}).toBe(true);
  }finally{client.page.off('response',observe);}
  return revisions.at(-1);
}

// rowSetup readies one character for a scripted movement row: the merchant's routines off
// unless the row keeps them, the character leading the formation with no focus, its native
// report fresh, and its client holding the revision those posts made. It returns the client.
export async function rowSetup(live:LiveGame,name:string,{keepRoutines=false}={}){
  if(!keepRoutines)await live.post('/merchant/routine-priorities',ROUTINES_OFF);
  await live.post('/formation',{leader:name});
  await live.post('/focus',{monsterFocus:[]});
  await expect.poll(async()=>fresh((await live.state()).characters[name]),{timeout:30_000}).toBe(true);
  const client=live.clients[name]!;
  await settleNavigation(client,name);
  return client;
}

// fightersReady turns the merchant's routines off and waits for both fighters' native reports.
export async function fightersReady(live:LiveGame){
  await live.post('/merchant/routine-priorities',ROUTINES_OFF);
  await expect.poll(async()=>{const state=await live.state();return fighters.every(name=>fresh(state.characters[name]));},{timeout:30_000}).toBe(true);
}

export const clock=async(live:LiveGame,name:string)=>await live.clients[name]!.run('Date.now()') as number;
export const lastEvent=async(live:LiveGame,name:string)=>Math.max(0,...(await live.clients[name]!.events()).map((event:any)=>Number(event.sequence)||0));
const ACCEPTED='globalThis.partyCombatState?.attackTiming?.accepted ?? 0';

// windowStart reads what a farming window measures from, for each fighter.
export async function windowStart(live:LiveGame){
  return Object.fromEntries(await Promise.all(fighters.map(async name=>[name,{at:await clock(live,name),event:await lastEvent(live,name),
    owner:await live.clients[name]!.run('__partyMovement.ownerReport()'),script:await scriptSeconds(live,name),
    accepted:await live.clients[name]!.run(ACCEPTED) as number,meter:await live.clients[name]!.run(TURNS_METER)}]))) as
    Record<string,{at:number;event:number;owner:any;script:number;accepted:number;meter:any}>;
}

// turnsWindow measures one window: its spends, and the controller's own
// accepted count.
export async function turnsWindow(live:LiveGame,name:string,start:{at:number;script:number;accepted:number;meter:any},end:number){
  return {...await spendWindow(live,name,start.at,end,{from:start.script,to:await scriptSeconds(live,name)}),
    controllerAccepted:(await live.clients[name]!.run(ACCEPTED) as number)-start.accepted,
    meter:meterDelta(start.meter,await live.clients[name]!.run(TURNS_METER))};
}
