import type { LiveGame } from '../live-fixtures';
import { expect } from '../live-fixtures';

import {warrior as W,priest as P,merchant as M,quantity} from './hunt-lifecycle';
export {W,P,M,quantity};
export async function world(live:LiveGame) {
  let observed:any;
  await expect.poll(async()=>{
    observed=await live.admin(`output=(()=>{const names=${JSON.stringify([W,P,M])};
      if(names.some(name=>!get_player(name)))return null;
      return {anniversary:E.anniversary||null,players:Object.fromEntries(names.map(name=>{const p=get_player(name);
        return [name,{map:p.map,x:p.x,y:p.y,moving:!!p.moving,hp:p.hp,items:p.items,gold:p.gold,xp:p.xp,quest:p.s.monsterhunt||null,conditions:p.s}]}))};})()`);
    return !!observed;
  },{timeout:30_000,message:'Native Hunt world observations require all account characters to be present'}).toBe(true);
  return observed;
}

/** Real upstream rule factory; only its initial scheduling clock/selection seed is controlled.
 *  The round's target is the first eligible player in the seeded order, and the event's reward
 *  block leaves out a player under realm fatigue or hop sickness (logic/anniversary_event.js
 *  `rewardBlock`). Realm fatigue from an earlier realm change outlasts the world reset, so the host
 *  starts without either, or the round picks the next player. */
export async function beginAnniversary(live:LiveGame,host=P) {
  return live.admin(`output=(()=>{
    if(events.anniversary)throw Error('Anniversary already active');
    const hosting=get_player(${JSON.stringify(host)});
    if(hosting?.s&&(hosting.s.realmfatigue||hosting.s.hopsickness)){delete hosting.s.realmfatigue;delete hosting.s.hopsickness;resend(hosting,'u+cid');}
    const interval=anniversary_rules.INTERVAL;
    const offset=Math.ceil(Date.now()/interval)*interval-Date.now()+100;
    let first=true;
    anniversary_controller=anniversary_rules.createEvent({
      now:()=>{const now=Date.now()+offset;if(first){first=false;return now-interval;}return now;},
      random:()=>0,players:()=>Object.values(players).sort((a,b)=>Number(b.name===${JSON.stringify(host)})-Number(a.name===${JSON.stringify(host)})),
      active:anniversary_is_active,reachable:anniversary_reachable,realm:region+' '+server_name,homeRealm:region+server_name,
      addCondition:add_condition,resend,distance
    });
    events.anniversary=true;anniversary_tick();broadcast_e();
    return {seed:'upstream createEvent with initial round boundary and deterministic eligible-player order',clockOffset:offset,round:E.anniversary};
  })()`);
}
export async function endAnniversary(live:LiveGame) {
  await live.admin(`events.anniversary=false;anniversary_tick();anniversary_controller=null;broadcast_e();output=true`);
}
/** Native monster creation with explicit initial difficulty; never seed death or loot. */
export async function spawnRare(live:LiveGame,type:string,hp=12000) {
  return live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),type=${JSON.stringify(type)},original=G.monsters[type];
    globalThis.__e2eHuntRareOriginal ||= {};if(globalThis.__e2eHuntRareOriginal[type])throw Error('Duplicate seeded rare');
    globalThis.__e2eHuntRareOriginal[type]=original;
    // Tiny P's native self-healing makes inflated HP a different combat task on
    // slower clients. Keep its real HP; socket hit receipts prove even short fights.
    const requestedHp=type==='tinyp'?original.hp:${hp},observableCombatSeconds=type==='tinyp'?0:5;
    const partyDps=${JSON.stringify([W,P])}.reduce((total,name)=>{const fighter=get_player(name);return total+fighter.attack*fighter.frequency;},0);
    const initialHp=Math.max(requestedHp,Math.ceil(partyDps*observableCombatSeconds));
    try {
      G.monsters[type]={...original,hp:initialHp,attack:1,speed:1,charge:1,aggro:0,range:1};
      let point;for(let i=0;i<16;i++){const a=i*Math.PI/8,x=p.x+90*Math.cos(a),y=p.y+90*Math.sin(a);if(can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base})){point={x,y};break;}}
      if(!point)throw Error('No native reachable encounter point');
      const monster=new_monster(p.in,{type,count:1,boundary:[point.x,point.y,point.x+1,point.y+1]},{temp:1});
      // Native recalculation reads zone_stats before the global definition.
      // Bound this workflow's initial difficulty without changing other bees or
      // fabricating an attack outcome; native 99.9% avoidance is a separate gap.
      if(type==='cutebee') {monster.zone_stats={...G.monsters[type],avoidance:0};calculate_monster_stats(monster);}
      monster.drops=[[1000000,'gem0',1]];monster.e2eHunt=true;return {id:monster.id,type,map:monster.map,x:monster.x,y:monster.y,requestedHp,partyDps,observableCombatSeconds,initialHp:monster.hp,originalHp:original.hp,originalAvoidance:original.avoidance||0,initialAvoidance:monster.avoidance||0,instanceDifficulty:!!monster.zone_stats,originalRespawn:original.respawn,temporary:!!monster.temp,initialDrops:monster.drops};
    } finally {
      G.monsters[type]=original;
      delete globalThis.__e2eHuntRareOriginal[type];
    }
  })()`);
}
export async function cleanupEvents(live:LiveGame) {
  await endAnniversary(live);
  await live.admin(`output=(()=>{for(const instance of Object.values(instances))for(const monster of Object.values(instance.monsters||{}))if(monster.type==='fieldgen0'&&monster.owner===${JSON.stringify(W)})remove_monster(monster,{silent:true});return true})()`);
  await live.admin(`output=(()=>{
    for(const instance of Object.values(instances))for(const monster of Object.values(instance.monsters||{}))if(monster.e2eHunt)remove_monster(monster,{silent:true});
    // Legacy crash recovery only: new setup restores the definition synchronously.
    for(const [type,definition] of Object.entries(globalThis.__e2eHuntRareOriginal||{})) {
      for(const key of Object.keys(G.monsters[type]))if(!Object.hasOwn(definition,key))delete G.monsters[type][key];
      Object.assign(G.monsters[type],definition);
    }
    delete globalThis.__e2eHuntRareOriginal;return true;
  })()`);
}
// The pinned server ends Halloween at design/event_flags.js `event_ends.halloween`
// (2026-11-03T00:00:00.000Z), and its event_loop (server_functions.js season_end_logic) sets
// events.halloween back to false within a second once the clock passes that time. The row moves
// the end a day past its own clock and opens the season, so the tour runs on any date; the undo
// restores the flag before the end time, so season_end_logic never runs halloween_season_end.
export async function holdHalloweenSeason(live:LiveGame){
  const previous=await live.admin(`output=(()=>{const previous={enabled:!!events.halloween,published:!!E.halloween,end:event_ends.halloween??null};
    event_ends.halloween=new Date(Date.now()+86400000).toISOString();events.halloween=true;E.halloween=true;broadcast_e();return previous;})()`);
  // The restore also ends the season inside a row that must see the end's return finish; running it
  // twice restores the same values.
  const restore=()=>live.admin(`output=(()=>{const previous=${JSON.stringify(previous)};
    events.halloween=previous.enabled;if(!previous.published)delete E.halloween;
    if(previous.end==null)delete event_ends.halloween;else event_ends.halloween=previous.end;broadcast_e();return true;})()`);
  live.undo('Halloween season hold',restore);
  return restore;
}
