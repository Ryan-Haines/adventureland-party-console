import type {Frame} from '@playwright/test';
import type {LiveClient} from './live-game-client';
/** Native packet-driven snapshots; no replacement transport or gameplay timer. */
export async function observeNativeCaveCombat(clients:Record<string,LiveClient>,names:string[],point:{map:string;x:number;y:number}){
 const frames:Record<string,Frame>={},key='__e2eCaveCombatObservation';
 async function finish(){
  const result:Record<string,unknown>={};
  for(const [name,frame]of Object.entries(frames)){
   try{result[name]=await frame.evaluate(key=>{
    const game=window as any,o=game[key];if(!o)return {observationError:'Observer missing'};
    for(const event of ['player','hit','death'])o.socket.removeListener(event,o.listener);
    delete game[key];return {name:o.name,samples:o.samples,errors:o.errors};
   },key);}catch(error){result[name]={observationError:String(error),detached:frame.isDetached()};}
  }return result;
 }
 try{
  for(const name of names){
   const frame=clients[name].frame;frames[name]=frame;
   await frame.evaluate(({key,name,point})=>{
    const game=window as any;if(game[key])throw Error('Cave observer already installed');
    const o={name,socket:game.socket,samples:[] as any[],errors:[] as string[],at:0,listener:null as null|(()=>void)};
    o.listener=()=>{const now=Date.now();if(now-o.at<1000)return;o.at=now;
     try{
      const code=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any,c=game.character;
      const own={x:c.real_x,y:c.real_y,map:c.map,in:c.in,hp:c.hp,rip:c.rip,moving:c.moving,range:c.range,targets:c.targets};
      const enemies=Object.values(game.entities||{}).filter((e:any)=>e.type==='monster'&&Math.hypot((e.real_x??e.x)-point.x,(e.real_y??e.y)-point.y)<650).slice(0,12).map((e:any)=>{
       const x=e.real_x??e.x,y=e.real_y??e.y;
       return {id:String(e.id),mtype:e.mtype,x,y,visible:e.visible,dead:e.dead,hp:e.hp,target:e.target,
        distance:Math.hypot(x-c.real_x,y-c.real_y),inRange:Math.hypot(x-c.real_x,y-c.real_y)<=c.range,
        movementRay:game.can_move({map:c.map,x:c.real_x,y:c.real_y,going_x:x,going_y:y,base:c.base}),canAttack:code?.can_attack?.(e)};
      });
      const position=code?.partyCombatPosition||{},selection=code?.partyCombatState||{};
      // The latest entry of the status owner's combat trace ring on the CODE frame (runtime/status/character/rings.ts),
      // the one snapshot b9b5c91e's combatTraceSnapshot gave.
      const trace=code?.__partyCombatTrace?.at(-1);
      o.samples.push({at:now,actor:own,enemies,codeAvailable:!!code?.sharedRoutine,generation:code?.__partyRuntimeGeneration,
       selection:{selectedTarget:selection.selectedTarget,mode:selection.mode},position:{mode:position.mode,reason:position.reason,movementOwner:position.movementOwner},
       trace,movement:code?.__partyMovement?.report?.()});
      if(o.samples.length>128)o.samples.splice(16,1);
     }catch(error){o.errors.push(String(error));if(o.errors.length>8)o.errors.shift();}
    };
    game[key]=o;for(const event of ['player','hit','death'])o.socket.on(event,o.listener);o.listener();
   },{key,name,point});
  }
 }catch(error){await finish();throw error;}
 return {finish};
}
