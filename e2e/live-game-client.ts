import {isLoopback} from './game/addresses.cjs';
import type { BrowserContext, Page, Frame } from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {installCompanionGraphicsDiagnostic} from './native-graphics-diagnostic.ts';

export interface LiveClientOptions {
  webUrl: string;
  coordinatorUrl: string;
  name: string;
  region: string;
  server: string;
  primary?: LiveClient;
}

export interface LiveClient {
  page: Page;
  frame: Frame;
  errors: string[];
  snapshot(): Promise<any>;
  events(): Promise<any[]>;
  disconnects(): ReadonlyArray<Record<string, unknown>>;
  run(expression: string): Promise<any>;
}

/** Connect an unmodified upstream client and run the maintained production CODE loader. */
export async function launchGameClient(context: BrowserContext, options: LiveClientOptions): Promise<LiveClient> {
  for (const address of [options.webUrl, options.coordinatorUrl]) {
    if (!isLoopback(new URL(address).hostname)) throw new Error('Live E2E requires loopback services');
  }
  const page = options.primary?.page || await context.newPage();
  if(!options.primary)await installCompanionGraphicsDiagnostic(context,options,process.env.E2E_COMPANION_NO_GRAPHICS==='1');
  const errors: string[] = options.primary?.errors || [];
  const disconnectJournal:Array<Record<string,unknown>>=[];
  const disconnectBinding='nativeDisconnect_'+randomUUID().replaceAll('-','');
  await page.exposeBinding(disconnectBinding, (_source, entry:Record<string,unknown>)=>{
    if(entry?.name!==options.name)return;
    disconnectJournal.push(entry);
    if(disconnectJournal.length>32)disconnectJournal.shift();
  });
  let native: Frame;
  if (options.primary) {
    // /steam/action login asks the production bridge to use native start_character_runner.
    const handle = await page.waitForSelector('#ichar' + options.name.toLowerCase(), { state: 'attached', timeout: 90_000 });
    const frame = await handle.contentFrame();
    if (!frame) throw Error('Native companion frame missing: ' + options.name);
    native = frame;
  } else {
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(({ coordinator }) => {
      (window as any).__partyServer = coordinator;
    }, { coordinator: options.coordinatorUrl });
    await page.goto(`${options.webUrl}/character/${encodeURIComponent(options.name)}/in/${options.region}/${options.server}/`, { waitUntil: 'domcontentloaded' });
    native = page.mainFrame();
  }
  await native.waitForFunction(name => {
    const game = window as any;
    return game.character?.name === name && game.socket?.connected && typeof game.start_runner === 'function';
  }, options.name, { timeout: 90_000, polling: 100 }).catch(async error=>{
    const observation=await native.evaluate(()=>{
      const game=window as any,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
      return {at:Date.now(),url:location.href,visibility:document.visibilityState,name:game.character?.name,
        connected:game.socket?.connected,startRunner:typeof game.start_runner,codeStatus:runner?.__partyStatusSuccessAt};
    }).catch(String);
    throw Error(String(error)+'\nNative readiness observation: '+JSON.stringify({expected:options.name,observation}));
  });
  await installNativeObservers(native);
  await native.evaluate(({ coordinator, primary }) => {
    const game = window as any;
    if (!primary) game.start_runner('maincode', `$.getScript(${JSON.stringify(coordinator + '/CODE/adventure_land/universal-loader.js')});`);
  }, { coordinator: options.coordinatorUrl, primary: !!options.primary });
  await native.waitForFunction(() => {
    const runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
    return runner?.__partyStatusSuccessAt > 0 && runner?.partyRoleRunner;
  }, undefined, { timeout: 90_000, polling: 100 }).catch(async error=>{
    const diagnostic=await native.evaluate(()=>{
      const w=window as any,r=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
      const clock=(c:any)=>c&&({now:c.now(),errors:c.errors,state:c.state,rate:c.rate});
      return {gameClock:clock(w.__e2eChronalClock),codeClock:clock(r?.__e2eChronalClock),codeLocation:r?.location?.href,role:!!r?.partyRoleRunner,status:r?.__partyStatusSuccessAt};
    }).catch(String);
    throw Error(String(error)+'\nNative startup observations: '+JSON.stringify(diagnostic));
  });
  const eventLedger:Array<{sequence:number;[key:string]:unknown}>=[];
  const eventKeys:string[]=[];
  const seenEvents=new Set<string>();
  let lastEventGeneration='',lastEventSequence=0;
  async function installNativeObservers(frame:Frame):Promise<void> {
    await frame.evaluate(({generation,disconnectBinding,name})=>{
      const game=window as any,socket=game.socket;
      if(!game.character || !socket)throw Error('Native game not initialized');
      game.__e2eEvents ||= [];
      game.__e2eObserverGeneration ||= generation;
      game.__e2eEventSequence ||= 0;
      const observed:WeakSet<object>=game.__e2eObservedSockets ||= new WeakSet();
      if(observed.has(socket))return;
      observed.add(socket);
      const socketGeneration=game.__e2eSocketObservationGeneration=(game.__e2eSocketObservationGeneration||0)+1;
      socket.on('disconnect',(reason:unknown)=>{
        // Node retains this real event after native auto-reload retires the frame.
        // Diagnostics must never change or interrupt Socket.IO/reload dispatch.
        try{
          const runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          let manuallyStopped=false;
          try{manuallyStopped=localStorage.getItem('party-code-stopped:'+name)==='1';}catch{}
          const scalar=(value:unknown)=>typeof value==='string'||typeof value==='number'||typeof value==='boolean'?value:null;
          const entry={at:Date.now(),name,reason:typeof reason==='string'?reason:null,
            observerGeneration:game.__e2eObserverGeneration,socketGeneration,connected:!!socket.connected,
            autoReload:scalar(game.auto_reload),reloadState:scalar(game.reload_state),reloadTimer:scalar(game.reload_timer),
            characterToLoad:typeof game.character_to_load==='string'?game.character_to_load:null,
            manuallyStopped,path:location.pathname,runtimeGeneration:scalar(runner?.__partyRuntimeGeneration),
            eventReturnCycleId:scalar(runner?.__partyEventRecoveryCycleId)};
          Promise.resolve(game[disconnectBinding](entry)).catch(()=>{});
        }catch{}
      });
      const observeOutgoing=(event:string,...args:any[])=>{
        if(event==='leave' && game.__e2eObserveTransitions && game.socket===socket && game.character?.name){
          if((game.__e2eObservedLeaveCount||0)>=32)return;game.__e2eObservedLeaveCount=(game.__e2eObservedLeaveCount||0)+1;
          const c=game.character,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          const owner=runner?.__partyMovement?.report?.()?.owner;
          game.__e2eEvents.push({sequence:++game.__e2eEventSequence,at:Date.now(),event:'leave-issued',
            data:{actor:c.name,map:c.map,in:c.in,x:c.real_x??c.x,y:c.real_y??c.y,owner}});
          if(game.__e2eEvents.length>2000)game.__e2eEvents.shift();return;
        }
        if(event==='move'){
          if(!game.__e2eObserveMoves||game.socket!==socket||!game.character?.name||!args[0]||typeof args[0]!=='object')return;
          if((game.__e2eObservedMoveCount||0)>=200)return;
          game.__e2eObservedMoveCount=(game.__e2eObservedMoveCount||0)+1;
          const c=game.character,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
          const p=args[0],code=runner?.character;
          const body=(o:any)=>o?{name:o.name,map:o.map,in:o.in,x:o.x,y:o.y,real_x:o.real_x,real_y:o.real_y,
            moving:o.moving,going_x:o.going_x,going_y:o.going_y,base:o.base&&{h:o.base.h,v:o.base.v,vn:o.base.vn}}:null;
          let clear:any;
          try{clear=runner?.can_move?.({map:c.map,x:p.x,y:p.y,going_x:p.going_x,going_y:p.going_y,base:c.base});}catch(error){clear={error:String(error)};}
          let approachGoal:any;
          const approachPosition=runner?.partyCombatPosition,destination=approachPosition?.destination,enemy=game.entities?.[approachPosition?.target];
          if(approachPosition?.mode==='independent-approach'&&destination&&enemy){
            try{approachGoal={sight:runner.can_move({map:c.map,x:destination.x,y:destination.y,going_x:enemy.real_x??enemy.x,going_y:enemy.real_y??enemy.y,base:c.base})};}catch(error){approachGoal={error:String(error)};}
          }
          let independentRoute:any;
          try{const r=runner?.partyQueueClient?.independent?.report?.();independentRoute=r&&{id:r.id,target:r.target,direct:r.direct,level:r.level,phase:r.phase,point:r.point&&{x:r.point.x,y:r.point.y},prediction:r.prediction&&{at:r.prediction.at,target:{...r.prediction.target},destination:{...r.prediction.destination},targetSpeed:r.prediction.targetSpeed,own:{...r.prediction.own},ownSpeed:r.prediction.ownSpeed,reach:r.prediction.reach,horizon:r.prediction.horizon},ownSpeed:c.speed,nativeTarget:enemy&&{id:String(enemy.id),x:enemy.real_x??enemy.x,y:enemy.real_y??enemy.y,moving:!!enemy.moving,speed:enemy.speed,going_x:enemy.going_x,going_y:enemy.going_y,inRange:runner?.is_in_range?.(enemy)}};}catch(error){independentRoute={error:String(error)};}
          game.__e2eEvents.push({sequence:++game.__e2eEventSequence,at:Date.now(),event:'move-issued',
            data:{x:p.x,y:p.y,going_x:p.going_x,going_y:p.going_y,m:p.m},
            motion:{parent:body(c),code:body(code),clear,approachGoal,independentRoute,owner:runner?.__partyCombatOwner,
              recovery:runner?.__partyGroupedCombat?.formationRecovery&&{id:runner.__partyGroupedCombat.formationRecovery.id,
                target:runner.__partyGroupedCombat.formationRecovery.target,mover:runner.__partyGroupedCombat.formationRecovery.mover,
                phase:runner.__partyGroupedCombat.formationRecovery.phase,attempt:runner.__partyGroupedCombat.formationRecovery.attempt},
              position:runner?.partyCombatPosition&&{mode:runner.partyCombatPosition.mode,reason:runner.partyCombatPosition.reason,
                target:runner.partyCombatPosition.target,issuedAt:runner.partyCombatPosition.issuedAt,movementOwner:runner.partyCombatPosition.movementOwner,
                destination:runner.partyCombatPosition.destination&&{x:runner.partyCombatPosition.destination.x,y:runner.partyCombatPosition.destination.y},
                approachId:runner.partyCombatPosition.approachId,radius:runner.partyCombatPosition.radius,phase:runner.partyCombatPosition.phase},runtimeGeneration:runner?.__partyRuntimeGeneration,
              codeHash:runner?.__partyCodeHash,observerGeneration:game.__e2eObserverGeneration}});
          if(game.__e2eEvents.length>2000)game.__e2eEvents.shift();
          return;
        }
        const hostileSkill=event==='skill'&&game.__e2eObserveMoves&&game.G?.skills?.[args[0]?.name]?.hostile===true;
        if(event!=='attack'&&!hostileSkill)return;
        const c=game.character,runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        if(!c?.name || game.socket!==socket || !hostileSkill&&args[0]?.id==null)return;
        const payload=args[0]||{},ids=hostileSkill?[...(payload.id==null?[]:[payload.id]),...(Array.isArray(payload.ids)?payload.ids:[]),...(Array.isArray(payload.targets)?payload.targets.map((value:any)=>Array.isArray(value)?value[0]:value):[])].map(String):undefined;
        const attackTarget=game.entities?.[String(payload.id??runner?.__partyGroupedCombat?.target?.id)];
        let candidate:any,convoy:any;
        try { candidate=runner?.sharedRoutine?.getWalkingPassiveTarget?.(true);convoy=runner?.sharedRoutine?.combatTraceSnapshot?.(); } catch { return; }
        let independent:any;
        if(game.__e2eObserveMoves&&(game.__e2eIndependentObservedAttackCount||0)<100){
          const group=runner?.__partyGroupedCombat;
          const targetKey=String(group?.target?.id),observed=game.__e2eIndependentObservedTargets||(game.__e2eIndependentObservedTargets={});
          if(group?.independentApproach&&(observed[targetKey]||0)<3&&(Object.keys(observed).length<10||targetKey in observed)){
            observed[targetKey]=(observed[targetKey]||0)+1;
            game.__e2eIndependentObservedAttackCount=(game.__e2eIndependentObservedAttackCount||0)+1;
            const codeAt=typeof runner?.Date?.now==='function'?runner.Date.now():undefined;
            independent={selection:group.selection,target:String(group.target?.id),committed:group.committed,confirmation:group.independentConfirmation,handoffTiming:group.handoffTiming,
              // The production readiness gate executes in CODE, not its game
              // parent, which can occupy an adjacent acknowledged clock window.
              gameAt:Date.now(),codeAt,
              serverAt:codeAt===undefined?undefined:codeAt+Number(runner?.sharedRoutine?.queueClockOffset?.()||0),
              ready:group.independentReadiness&&Object.fromEntries(Object.entries(group.independentReadiness).map(([name,value]:[string,any])=>[name,
                value&&{selection:value.selection,target:value.target,at:value.at,ready:value.ready,confirmation:value.confirmation}]))};
          }
        }
        const attackDue=Number(game.next_skill?.attack),group=runner?.__partyGroupedCombat;
        const handoff=(runner?.__partyHandoffTrace||[]).filter((e:any)=>e.selection===group?.selection&&String(e.target)===String(group?.target?.id)&&['committed','attempt','blocked','range-commit-received'].includes(e.stage)).slice(-6).map((e:any)=>({at:e.at,stage:e.stage,target:e.target,selection:e.selection,reason:e.reason,confirmation:e.confirmation,cooldownReadyAt:e.cooldownReadyAt,frequency:e.frequency,timerLatenessMs:e.timerLatenessMs}));
        game.__e2eEvents.push({sequence:++game.__e2eEventSequence,at:Date.now(),event:hostileSkill?'offensive-skill-issued':'attack-issued',
          data:{id:payload.id==null?undefined:String(payload.id),actor:c.name,ids,skill:hostileSkill?String(payload.name):undefined},motion:{map:c.map,in:c.in??c.map,server:String(game.server_region||'')+String(game.server_identifier||''),
            x:c.real_x??c.x,y:c.real_y??c.y,moving:!!c.moving,owner:runner?.__partyCombatOwner,
            inRange:runner?.is_in_range?.(attackTarget),range:c.range,nativeAttack:{dueAt:Number.isFinite(attackDue)?attackDue:undefined,canAttack:runner?.can_attack?.(attackTarget)},handoff,attackTarget:attackTarget&&{id:String(attackTarget.id),x:attackTarget.real_x??attackTarget.x,y:attackTarget.real_y??attackTarget.y},
            independent,convoyId:convoy?.convoy,convoyPhase:convoy?.convoyPhase,convoyEpoch:convoy?.convoyEpoch,
            candidate:candidate&&{id:String(candidate.id),mtype:candidate.mtype}}});
        if(game.__e2eEvents.length>2000)game.__e2eEvents.shift();
      };
      if(typeof socket.onAnyOutgoing==='function'){
        game.__e2eOutgoingObservation='onAnyOutgoing';
        socket.onAnyOutgoing((event:string,...args:any[])=>{try{observeOutgoing(event,...args);}catch{}});
      }else{
        // Older native clients lack outgoing listeners. Preserve one original
        // call, its receiver/arguments/result/errors, and never replay packets.
        game.__e2eOutgoingObservation='native emit';
        const emit=socket.emit;
        socket.emit=function(...args:any[]){
          try{observeOutgoing(args[0],...args.slice(1));}catch{}
          return emit.apply(this,args);
        };
      }
      // Incoming observations only; no synthetic packets.
      for(const event of ['hit','death','game_response','game_log','chest_opened','disappear','new_map','party_update','player'])socket.on(event,(data:unknown)=>{
        const runner=(document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        const c=runner?.character,command=event==='player'&&game.socket===socket?
          runner?.__partyDungeonRuntime?.commandIdentity?.():undefined;
        const caveOwner=command&&c?{command,runtimeGeneration:runner.__partyRuntimeGeneration,
          codeHash:runner.__partyCodeHash,name:c.name,map:c.map,in:c.in,
          run:c.cave?.run,floor:c.cave?.floor,hp:c.hp,rip:c.rip}:undefined;
        game.__e2eEvents.push({sequence:++game.__e2eEventSequence,at:Date.now(),event,
          data:JSON.parse(JSON.stringify(data ?? null)),caveOwner});
        if(game.__e2eEvents.length>2000)game.__e2eEvents.shift();
      });
    },{generation:randomUUID(),disconnectBinding,name:options.name});
  }
  async function retainEvents(frame:Frame):Promise<void> {
    const observed=await frame.evaluate(({generation,sequence})=>{
      const game=window as any;
      const current=String(game.__e2eObserverGeneration);
      const events=game.__e2eEvents as Array<{sequence:number;[key:string]:unknown}>;
      return {generation:current,events:events.filter(event=>current!==generation || event.sequence>sequence)};
    },{generation:lastEventGeneration,sequence:lastEventSequence});
    if(observed.generation!==lastEventGeneration)lastEventSequence=0;
    lastEventGeneration=observed.generation;
    for(const event of observed.events){
      lastEventSequence=Math.max(lastEventSequence,event.sequence);
      const key=observed.generation+':'+event.sequence;
      if(seenEvents.has(key))continue;
      seenEvents.add(key);eventKeys.push(key);eventLedger.push(event);
      if(eventLedger.length>2000){eventLedger.shift();seenEvents.delete(eventKeys.shift()!);}
    }
  }
  function currentGameFrame(): Frame {
    const prefix='/character/'+encodeURIComponent(options.name)+'/';
    const frame=page.frames().find(candidate=>{
      try{return new URL(candidate.url()).pathname.startsWith(prefix);}catch{return false;}
    });
    if(!frame)throw Error('Native character window unavailable for '+options.name);
    native=frame;return frame;
  }
  async function observe<T>(read:(frame:Frame)=>Promise<T>):Promise<T> {
    const deadline=Date.now()+30_000;
    let last:unknown;
    do {
      try{
        const frame=currentGameFrame();await installNativeObservers(frame);
        return await read(frame);
      }
      catch(error){
        if(page.isClosed() || !/Execution context was destroyed|Cannot find context|Frame was detached|Native character window unavailable|Native game not initialized|Native CODE runner missing/.test(String(error)))throw error;
        last=error;await new Promise(resolve=>setTimeout(resolve,100));
      }
    }while(Date.now()<deadline);
    throw last;
  }
  return {
    page, get frame(){return currentGameFrame();}, errors,
    async snapshot() {
      return observe(frame=>frame.evaluate(() => {
        const game = window as any, c = game.character;
        if(!c || !game.socket)throw Error('Native game not initialized');
        const runner = (document.getElementById('maincode') as HTMLIFrameElement)?.contentWindow as any;
        const transport=runner?.__partyTravelTransport;
        const timing=(value:any)=>value&&({at:value.at,durationMs:value.durationMs,
          processingMs:value.processingMs,networkMs:value.networkMs,eventLoopMaxMs:value.eventLoopMaxMs});
        const walk=runner?.__partySharedWalking;
        const http=runner?.__partyConvoyHttp;
        const diagnostics=(runner?.__partyStatusDiagnostics||[]).slice(-6).map((entry:any)=>({
          at:entry.at,phase:entry.details?.phase,error:String(entry.details?.error||'').slice(0,240),
          request:entry.details?.request,repeats:entry.details?.repeats,lastAt:entry.details?.lastAt}));
        const commandObservation={at:Date.now(),attemptAt:runner?.__partyStatusAttemptAt,
          successAt:runner?.__partyStatusSuccessAt,lastCommandId:runner?.__partyLastCommand,
          navigationIntent:runner?.__partyNavigationIntent,eventReturnCycleId:runner?.__partyEventRecoveryCycleId,
          eventReturnOwnerAt:runner?.__partyEventRecoveryOwnerAt,travelSignalAt:runner?.__partyTravelSignalAt,
          transport:{full:timing(transport?.full),fast:timing(transport?.fast),clock:transport?.clock},
          walk:walk&&({activity:walk.activity,key:walk.key,parentCommandId:walk.parentCommandId,
            revision:walk.revision,token:walk.token,convoyId:walk.convoyId,cancelled:walk.cancelled}),
          convoyHttp:http&&({responseAt:http.responseAt,failure:http.failure}),observedMono:performance.now(),diagnostics};
        return JSON.parse(JSON.stringify({ name: c.name, map: c.map, x: c.real_x, y: c.real_y, hp: c.hp, mp: c.mp,
          gold: c.gold, xp: c.xp, rip: c.rip, items: c.items, slots: c.slots, s: c.s, party: c.party,
          connected: game.socket.connected, codeActive: game.code_active, statusAt: runner?.__partyStatusSuccessAt,
          runtimeGeneration: runner?.__partyRuntimeGeneration, commandObservation }));
      }));
    },
    disconnects() { return disconnectJournal.map(entry=>({...entry})); },
    async events() { return observe(async frame=>{await retainEvents(frame);return [...eventLedger];}); },
    async run(expression) {
      // Reacquire before evaluation; never replay a potentially mutating expression.
      const frame=await observe(async game=>{
        // The current native DOM owns CODE. A retired named /runner frame may
        // remain discoverable during replacement, so resolve this exact iframe.
        const element=await game.$('#maincode');
        let code:Frame|null=null;
        try{code=await element?.contentFrame()??null;}finally{await element?.dispose();}
        if(!code || code.isDetached() || !await code.evaluate(()=>!!(globalThis as any).sharedRoutine && !!(globalThis as any).partyRoleRunner))
          throw Error(`Native CODE runner missing for ${options.name}`);
        return code;
      });
      return frame.evaluate(expression);
    },
  };
}
