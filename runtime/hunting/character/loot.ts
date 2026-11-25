// The character's loot client (character/loot.ts): the rare, Hunt and convoy loot passes from one
// engine. Each pass loots through the items owner's `items.loot()`. The role runner installs it
// from runtime/hunting/api.ts.
import { GAME_CHEST_REACH, huntLootId } from '../rules.ts';
import { loot as itemsLoot } from '../../items/api.ts';
import { fresh } from '../../protocol/reports.ts';
import { scope, type Emitter } from '../../lifecycle/api.ts';
import type { HuntCycle, LootProgress } from '../api.ts';
import type { installHuntingClient } from './install.ts';
// The character's place: its realm (region and server), map and instance. The loot engine and the
// rare client both build it here, since engaged() matches a rare's place byte for byte.
export function characterPlace(frame:{server_region?:string;server_identifier?:string},c:{map:string;in?:string|number}) {
  return {realm:':'+String(frame.server_region||'')+String(frame.server_identifier||''),map:c.map,in:String(c.in||c.map)};
}

// The game's refusal reason, else the error's message, else the error itself.
function reasonOf(error:unknown):string {
  if(error&&typeof error==='object') {
    if('reason' in error&&error.reason)return String(error.reason);
    if('message' in error&&error.message)return String(error.message);
  }
  return String(error);
}
// A loot pass's control: the Hunt barrier's, the convoy's or the rare kill's chest place.
export interface LootControl { id:string; realm:string; map:string; in?:string|number; x:number; y:number; after?:number }
type Place = ReturnType<typeof characterPlace> & { x:number; y:number };
interface EnginePorts {
  frame(): { entities?: Record<string, { dead?: unknown; hp?: unknown } | undefined> };
  position(): Place; cancelled(): boolean; defending(): boolean; now(): number;
  nextObservation(): Promise<void>; chests(): unknown[];
}

/** Loot completion requires a pass and a subsequent observation in the same place. */
export function createDepartureLoot(ports:EnginePorts) {
  let control:LootControl|null=null, progress:LootProgress|null=null, pending=false, retired:string|null=null, latest=0;
  // The monsters the party hit, by identity with their entity id: one counts as engaged while the
  // character's entities still list it alive, and a hit drops the ones the entities no longer list.
  const engagements=new Map<string,string>();
  const alive=(id:string)=>{const e=ports.frame().entities?.[id];return !!e&&!e.dead&&Number(e.hp)>0;};
  const identity=(t:Omit<LootControl,'x'|'y'>)=>JSON.stringify([t.realm,t.map,String(t.in??t.map),String(t.id)]);
  function samePlace(c:LootControl|null): c is LootControl {
    const s=ports.position();
    return !!c && s.realm===c.realm && s.map===c.map && String(s.in)===String(c.in) &&
      !ports.cancelled();
  }
  function valid(c:LootControl|null): c is LootControl {
    const s=ports.position();
    // The character's own position: the server's chest reach, with no report age to allow for.
    return samePlace(c) && Math.hypot(s.x-c.x,s.y-c.y)<=GAME_CHEST_REACH;
  }
  function accept(c:LootControl|null,at:number) {
    if(at<latest)return;latest=at;
    if(control && c && identity(control)===identity(c) && control.after===c.after)return;
    // The last retired control is all a newer reply can repeat, so it is the one id kept.
    if(control && control.id!==c?.id)retired=control.id;
    control=c && retired!==c.id ? c : null;
  }
  async function tick() {
    const c=control;
    if(!valid(c)||pending||ports.defending()||progress?.id===c.id&&progress.complete)return;
    pending=true;
    try {
      const result=await itemsLoot();
      if(control!==c||!valid(c)||ports.defending())return;
      // Yield past the collection result before reading the live chest cache.
      await ports.nextObservation();
      if(control!==c||!valid(c)||ports.defending())return;
      progress={id:c.id,realm:c.realm,map:c.map,in:String(c.in),observedAt:ports.now(),
        complete:result!==false && ports.chests().length===0,error:undefined};
    } catch(error) {
      if(control===c)progress={id:c.id,realm:c.realm,map:c.map,in:String(c.in),observedAt:ports.now(),complete:false,error:reasonOf(error)};
    } finally {pending=false;}
  }
  return {accept,tick,valid,samePlace,report:()=>progress,blocks:()=>{const c=control;return valid(c)&&!(progress?.id===c.id&&progress.complete);},
    hit(t:Omit<LootControl,'x'|'y'>){for(const [key,id] of engagements)if(!alive(id))engagements.delete(key);engagements.set(identity(t),String(t.id));},
    engaged(t:Omit<LootControl,'x'|'y'>){const id=engagements.get(identity(t));return id!==undefined&&alive(id);}};
}

// The hunting owner's run scope handles: the departure loot's pass is `act`; the `drop` and
// `entities` records it waits on are `observe`, so a drop during a Pause is not missed. The reply's
// parts the loot client reads.
interface LootReply {
  serverNow:number; targetMode?:string; monsterHunt?:HuntCycle|null;
  convoySignal?:{ phase?:string; loot?:LootControl|null }|null;
  rareControl?:{ kind:string; id:string; killedAt?:number; target:Omit<LootControl,'id'|'after'> }|null;
}
type LootGamePorts = ReturnType<ReturnType<typeof installHuntingClient>['lootPorts']>;
// The lifecycle owner's roles.ts hands the role runner's global, which targeting's CombatRoot types
// without the loot client, and the hunting owner's character door (shared.js `partyHunting`), whose loot ports the
// client reads.
export function installLootClient(root:any,hunting:{lootPorts():LootGamePorts}) {
  root.partyLootClient?.stop();
  const act=scope('07','act'),observed=scope('07','observe');
  const game:LootGamePorts=hunting.lootPorts();
  // The loot facts from the routine's reads: the console's clock, a member's fresh quest, the
  // merchant cleanout's capacity block and the character's place, whether the pass is cancelled. A
  // member's reported quest counts while its report is fresh by movement's `report` reading.
  const now=()=>Date.now()+game.clockOffset();
  const ports={...game,now,
    capacityBlocked:()=>!!root.partyLootStatus?.capacityBlocked,
    questFor:(name:string)=>game.positions().find(p=>p.name===name&&fresh(p.seenAt,now(),'report'))?.monsterHunt,
    position:()=>{const c=game.character();return {...characterPlace(game.frame(),c),x:c.x,y:c.y};},
    cancelled:()=>game.navigationCancelled()||!!game.character().rip||game.escaping()||game.eventJoined(),
    // A pass reads the chest cache on the character's next game `drop` or `entities` update.
    nextObservation:()=>new Promise<void>(resolve=>{
      const socket=game.socket();
      const observe=()=>{observed.off(socket,'drop',observe);observed.off(socket,'entities',observe);observed.afterDraw(resolve);};
      observed.on(socket,'drop',observe);observed.on(socket,'entities',observe);
    })};
  let convoySuspended=false;
  const rare=createDepartureLoot(ports),hunt=createDepartureLoot(ports),
    convoy=createDepartureLoot({...ports,defending:()=>convoySuspended || ports.defending()});
  let convoyHold=false;
  // The final Hunt kill holds the mission's loot until its chest's `drop` arrives
  // (`finalKillDropped`) or the next reply carries the coordinator's loot control.
  let lastState=0,lastRare:LootReply['rareControl']=null,mission:HuntCycle|null|undefined=null,finalKill:string|null=null,finalKillDropped=false;
  const dropped=()=>{if(finalKill)finalKillDropped=true;};
  observed.on(ports.socket(),'drop',dropped);
  const activeMission=(m:HuntCycle|null|undefined):m is HuntCycle=>!!m && !['backup-travel','backup-farming'].includes(m.stage);
  let retired:string|null=null;
  // v1.5.0's pass rate (runtime/combat/departure-loot.ts:61). The game sends no
  // event when the character's own steps bring a chest into reach, so the passes poll at the
  // earlier console's 100 ms.
  const timer=act.setInterval(()=>{void rare.tick();void hunt.tick();void convoy.tick();},100);
  const owners=(m:HuntCycle)=>m.missions?.[m.currentIndex]?.owners||[];
  const participant=(m:HuntCycle)=>m.participants?.includes(ports.name()) || owners(m).includes(ports.name());
  const ownerDone=(m:HuntCycle,limit:number)=>owners(m).length>0 && owners(m).every(name=>{
    const q=name===ports.name()?ports.quest():ports.questFor(name);return q?.id===m.target&&Number(q.count)<=limit;
  });
  const api={rare,hunt,convoy,
    finalKill(mtype:string){
      const m=mission;
      if(m && participant(m) && ['farming','mission-travel'].includes(m.stage) && mtype===m.target &&
          ownerDone(m,1)) { finalKill=huntLootId(m);finalKillDropped=false; }
    },
    huntPending(){
      if(convoyHold&&!ports.cancelled())return true;
      const m=mission;
      if(!activeMission(m) || !participant(m) || ports.cancelled())return false;
      // Capacity recovery is asynchronous. Keep trying chests, but do not freeze
      // farming while the merchant makes room and collects the party's bags.
      if(m.stage==='farming' && ports.capacityBlocked())return false;
      return !!(hunt.blocks() || m.batchPickup || ['returning','at-daisy'].includes(m.stage) ||
        m.loot?.id===huntLootId(m) || finalKill===huntLootId(m) ||
        ['farming','mission-travel'].includes(m.stage)&&ownerDone(m,0));
    },
    accept(state:LootReply){
      if(state.serverNow<lastState)return lastRare;
      lastState=state.serverNow;
      // Recovery retains the coordinator's loot identity. Suspend its pass rather
      // than retiring it, so restored defense can retry a native opening error.
      const signal=state.convoySignal,convoyPhase=signal?.phase,loot=signal?.loot||null;
      convoyHold=!!(convoyPhase && ['defending','communication-hold','observing'].includes(convoyPhase) && loot);
      convoySuspended=convoyHold && convoyPhase!=='defending';
      convoy.accept(convoyHold?loot:null,state.serverNow);
      mission=state.monsterHunt;
      if (state.targetMode && state.targetMode!=='hunt') mission=null;
      if (!activeMission(mission)) { mission=null;finalKill=null; }
      if(finalKill && finalKillDropped && !mission?.loot && !(mission && ownerDone(mission,0)))finalKill=null;
      if(!mission || finalKill!==huntLootId(mission) || mission.loot?.complete)finalKill=null;
      let c=state.rareControl;
      if(lastRare && lastRare.id!==c?.id)retired=lastRare.id;
      // The loot owner must be able to approach a kill made by a distant peer.
      // Proximity gates the actual loot pass, not acceptance of its movement.
      if(c && (retired===c.id||c.kind==='loot'&&!rare.samePlace({...c.target,id:c.id})))c=null;
      lastRare=c;
      rare.accept(c?.kind==='loot'?{...c.target,id:c.id,after:c.killedAt}:null,state.serverNow);
      hunt.accept(mission?.loot&&!mission.loot.complete?mission.loot:null,state.serverNow);
      return c;
    },stop(){act.clearInterval(timer);observed.off(ports.socket(),'drop',dropped);}};
  root.partyLootClient=api;return api;
}
