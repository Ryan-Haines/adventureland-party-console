/** Read the native catalog used by timer-only runtime staging, before login. */
export async function nativeEventSpawn(admin: (code: string) => Promise<{map:string;x:number;y:number}>, event: string) {
  return admin(`output=(()=>{const event=${JSON.stringify(event)};
    const eventMap=Object.keys(G.maps).find(name=>G.maps[name].event===event);
    if(eventMap){const p=G.maps[eventMap].spawns[0];return {map:eventMap,x:p[0],y:p[1]};}
    for(const [map,definition] of Object.entries(G.maps)){
      const spawn=(definition.monsters||[]).find(entry=>entry.type===event);
      if(!spawn)continue;
      const bounds=spawn.boundary||spawn.boundaries?.[0];if(!Array.isArray(bounds))continue;
      const offset=typeof bounds[0]==='string'?1:0;
      const x=(Number(bounds[offset])+Number(bounds[offset+2]))/2,y=(Number(bounds[offset+1])+Number(bounds[offset+3]))/2;
      if(Number.isFinite(x)&&Number.isFinite(y))return {map,x,y};
    }throw Error('Native event catalog has no staging location: '+event);})()`);
}

/** Initial fixture position near actual monster bounds, verified against native geometry. */
export async function nativeMonsterInitialPosition(admin:(code:string)=>Promise<any>,monster:string){
  return admin(`output=(()=>{const type=${JSON.stringify(monster)};
    for(const [map,definition] of Object.entries(G.maps).sort(([a],[b])=>a.localeCompare(b)))
      for(const spawn of (definition.monsters||[]).filter(entry=>entry.type===type).sort((a,b)=>{
        const first=a.boundary||a.boundaries?.[0],second=b.boundary||b.boundaries?.[0];
        const center=bound=>{const offset=typeof bound?.[0]==='string'?1:0;return (Number(bound?.[offset])+Number(bound?.[offset+2]))/2;};
        return center(first)-center(second);
      })){
      const bounds=spawn.boundary||spawn.boundaries?.[0];if(!Array.isArray(bounds))continue;
      const offset=typeof bounds[0]==='string'?1:0;
      const center={x:(Number(bounds[offset])+Number(bounds[offset+2]))/2,y:(Number(bounds[offset+1])+Number(bounds[offset+3]))/2};
      if(!Number.isFinite(center.x)||!Number.isFinite(center.y))continue;
      const entity={type:'character',map,x:center.x,y:center.y};set_base(entity);
      for(const radius of [0,32,64,96,128])for(let i=0;i<(radius?16:1);i++){
        const angle=i*Math.PI/8,x=center.x+radius*Math.cos(angle),y=center.y+radius*Math.sin(angle);
        const origin={...entity,x,y};
        if(!can_move({...origin,going_x:x,going_y:y}))continue;
        if(![[24,0],[-24,0],[0,24],[0,-24]].every(([dx,dy])=>can_move({...origin,going_x:x+dx,going_y:y+dy})))continue;
        return {map,x,y,monster:type,bounds,center,base:entity.base,selfClear:true,localClearance:24};
      }
    }throw Error('No collision-safe native monster initial position: '+type);})()`);
}

/** Announce a Halloween boss spawn `leadMs` ahead at the native server_info boundary; the boss itself stays native. */
export async function announceSpawn(live: { admin(code: string): Promise<any> }, event: string, leadMs: number) {
  return live.admin(`output=(()=>{
    const type=${JSON.stringify(event)},spawn=new Date(Date.now()+${leadMs}),announcement={live:false,spawn};
    globalThis.__e2eHalloweenAnnouncements ||= {};
    clearInterval(globalThis.__e2eHalloweenAnnouncements[type]?.timer);
    // The pinned backend deletes non-live E entries in event_loop even before
    // their timer. Declare this schedule at the native server_info read boundary;
    // actual boss creation/damage/death/movement stay entirely native.
    if(!globalThis.__e2eHalloweenNativeBroadcast){
      globalThis.__e2eHalloweenNativeBroadcast=broadcast_e;
      broadcast_e=function(dontSend){
        if(dontSend)return;
        const snapshot={...E};
        for(const [name,entry] of Object.entries(globalThis.__e2eHalloweenAnnouncements)){
          if(get_monster(name))entry.liveSeen=true;
          if(!entry.liveSeen&&Date.now()<=entry.expiresAt)snapshot[name]=entry.announcement;
        }
        broadcast('server_info',snapshot);
      };
    }
    const entry={announcement,expiresAt:spawn.getTime()+125000,liveSeen:false,timer:null};
    globalThis.__e2eHalloweenAnnouncements[type]=entry;
    const publish=()=>{
      if(get_monster(type))entry.liveSeen=true;
      if(entry.liveSeen||Date.now()>entry.expiresAt){clearInterval(entry.timer);return;}
      broadcast_e();
    };
    entry.timer=setInterval(publish,500);publish();
    return {...announcement,fixture:'immutable native server_info schedule boundary',expiresAt:spawn.getTime()+125000};
  })()`);
}
