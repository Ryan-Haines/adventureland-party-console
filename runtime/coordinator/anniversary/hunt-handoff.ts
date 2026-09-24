import type {AnniversaryCycle} from './contracts.ts';
interface State {
  farmingPolicy?:string;
  monsterHunt?:{stage:string;resumeStage?:string;convoyId?:string|null;message:string;exitMode?:string|null};
  eventReturn?:unknown;
  townCycle?:unknown;
  activeConvoy?:{id:string;phase:string;communicationHold?:unknown;merchantInterruption?:unknown;participants:string[]};
  statuses:Record<string,{seenAt:number;hp?:number;rip?:boolean;activeEvent?:unknown;joinedEvent?:unknown;mapEvent?:unknown;anniversaryVisit?:unknown;
    groupedCombat?:{currentAttackersAt?:number;currentAttackers?:unknown[];lootPending?:boolean}}>;
  commands:Record<string,{id?:number;convoyId?:string;cycleId?:string}>;
  deferredEventReturns:Record<string,{cycleId?:string;checkpoint?:unknown}>;
}
interface Ports {
  now():number;
  persist():void;
  navigation:{intent(name:string):{revision:number;cancelled?:boolean};finish?:(cycle:AnniversaryCycle,reason:string)=>void};
}
function pending(s:State,cycle:AnniversaryCycle):boolean {
  return !!s.monsterHunt && (s.farmingPolicy==='hunt' || !!s.monsterHunt.exitMode) &&
    ![s.eventReturn,s.townCycle,cycle.returnCompletedAt,cycle.supersededAt,cycle.combatHandoffAt].some(Boolean);
}
function convoyReady(s:State,cycle:AnniversaryCycle):boolean {
  const c=s.activeConvoy;
  if(!c)return true;
  if(c.communicationHold || c.merchantInterruption || ['defending','observing'].includes(c.phase))return false;
  return Object.values(cycle.returnRoutes||{}).some(r=>r.convoyId===c.id);
}
function commandOwned(s:State,cycle:AnniversaryCycle,n:string):boolean {
  const command=s.commands[n],route=cycle.returnRoutes?.[n];
  if(!command)return true;
  return command.cycleId===cycle.id || !!route?.commandId && command.id===route.commandId ||
    !!route?.convoyId && command.convoyId===route.convoyId;
}
function observationReady(status:State['statuses'][string]|undefined,now:number):boolean {
  if(!status || now-status.seenAt>3000 || status.seenAt>now+500)return false;
  if([status.rip,status.hp===0,status.activeEvent,status.joinedEvent,status.mapEvent,status.anniversaryVisit].some(Boolean))return false;
  return combatClear(status,now);
}
function combatClear(status:State['statuses'][string],now:number):boolean {
  const g=status.groupedCombat;
  if(!g?.currentAttackersAt || now-g.currentAttackersAt>3000 || g.currentAttackersAt>now+500)return false;
  return Array.isArray(g.currentAttackers) && !g.currentAttackers.length && !g.lootPending;
}
function memberReady(s:State,cycle:AnniversaryCycle,n:string,ports:Ports):boolean {
  if((s.deferredEventReturns[n]||{}).cycleId===cycle.id)return true;
  const intent=ports.navigation.intent(n), route=(cycle.returnRoutes||{})[n];
  const saved=route || (cycle.waypoints||{})[n];
  if(intent.cancelled || !saved || saved.revision!==intent.revision)return false;
  return commandOwned(s,cycle,n) && observationReady(s.statuses[n],ports.now());
}
function resume(s:State,cycle:AnniversaryCycle,ports:Ports):void {
  for(const n of cycle.participants||[])if(s.deferredEventReturns[n]?.cycleId===cycle.id)s.deferredEventReturns[n].checkpoint=null;
  const h=s.monsterHunt!;
  h.convoyId=null;
  if(h.stage==='paused-event')h.stage=h.resumeStage||'checking-quests';
  h.message='Anniversary visit complete; resuming current Hunt';
  ports.persist();
}
/** A finished anniversary visit hands back to current Hunt policy, not its old farm. */
export function handoffAnniversaryToHunt(input:unknown,cycle:AnniversaryCycle,ports:Ports):boolean {
  const s=input as State;
  if(!pending(s,cycle) || !ports.navigation.finish || !convoyReady(s,cycle))return false;
  const names=cycle.participants||[];
  if(!names.length || !names.every(n=>memberReady(s,cycle,n,ports)))return false;
  ports.navigation.finish(cycle,'Anniversary visit complete; resuming current Hunt');
  resume(s,cycle,ports);
  return true;
}
