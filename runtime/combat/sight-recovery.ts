interface Point {x:number;y:number}
interface Ports {now():number;self():Point&{speed:number};clear(p:Point):boolean;cost?(p:Point):number;move(p:Point):void;report(reason:string):void}
interface Footstep extends Point {at:number;visible:boolean}
/** Breadcrumbs and local detours only; no weapon-range circles or pathfinder. */
export function createSightRecovery(p:Ports){
  let key='',historyKey='',history:Footstep[]=[],trail:Point[]=[],side=1,progressAt=0,distance=Infinity;
  let waypoint:Point|null=null,fan=0,retryAt=0,startedAt=0,steps=0;
  const failed=new Map<string,number>(),visited=new Map<string,number>();
  const cell=(v:Point)=>Math.round(v.x/8)+','+Math.round(v.y/8);
  function reset(){key='';waypoint=null;trail=[];failed.clear();visited.clear();fan=0;}
  function observe(id:string,pos:Point,visible:boolean){
    if(historyKey!==id){historyKey=id;history=[];reset();}
    const now=p.now(),last=history.at(-1);
    if(!last||Math.hypot(last.x-pos.x,last.y-pos.y)>=4||last.visible!==visible||now-last.at>=250)
      history.push({x:pos.x,y:pos.y,at:now,visible});
    history=history.filter(v=>now-v.at<=8000).slice(-80);
    if(visible)reset();
  }
  function tick(id:string,last:Point,remembered:Point|null,observers:Point[]){
    const now=p.now(),self=p.self();
    if(key!==id){startedAt=now;steps=0;key=id;side=1;progressAt=now;distance=Infinity;waypoint=null;fan=0;retryAt=0;
      let visibleIndex=-1; if(historyKey===id)history.forEach((v,i)=>{if(v.visible)visibleIndex=i;});
      trail=visibleIndex>=0?history.slice(Math.max(0,visibleIndex-8)).reverse().map(v=>({x:v.x,y:v.y})):remembered?[remembered]:[];
    }
    if(now-startedAt>=8000||steps>=6){p.report('Search paused: bounded search exhausted; awaiting fresh coverage or target retirement');return true;}
    for(const cache of [failed,visited])for(const [k,at] of cache)if(now-at>5000)cache.delete(k);
    if(now<retryAt)return true;
    if(waypoint){const gap=Math.hypot(self.x-waypoint.x,self.y-waypoint.y);
      if(gap<distance-2){distance=gap;progressAt=now;}
      if(gap<5){visited.set(cell(waypoint),now);waypoint=null;}
      else if(!p.clear(waypoint)||now-progressAt>=1000){failed.set(cell(waypoint),now);waypoint=null;side*=-1;fan++;}
      else {p.report('Recovering sight: continuing local detour');return true;}
    }
    while(trail.length && Math.hypot(self.x-trail[0].x,self.y-trail[0].y)<7)trail.shift();
    const observer=observers.slice().sort((a,b)=>Math.hypot(a.x-self.x,a.y-self.y)-Math.hypot(b.x-self.x,b.y-self.y))[0];
    const goal=trail[0]||observer||last;
    const reason=trail.length?'retracing recent footsteps':observer?'approaching teammate who sees target':'searching from last useful sighting';
    const length=Math.max(8,Math.min(24,self.speed*0.4)),gap=Math.hypot(goal.x-self.x,goal.y-self.y);
    const heading=Math.atan2(goal.y-self.y,goal.x-self.x);
    const allowed=(v:Point)=>!failed.has(cell(v))&&!visited.has(cell(v))&&p.clear(v);
    const send=(v:Point,why:string)=>{steps++;waypoint=v;distance=Math.hypot(v.x-self.x,v.y-self.y);progressAt=now;p.report('Recovering sight: '+why);p.move(v);return true;};
    if(gap>=7){const direct={x:self.x+(goal.x-self.x)*Math.min(1,length/gap),y:self.y+(goal.y-self.y)*Math.min(1,length/gap)};
      if(allowed(direct))return send(direct,reason);
      failed.set(cell(direct),now);
    } else if(trail.length)trail.shift();
    // Keep the same side while progressing; reverse only on a stall or blocked fan.
    for(let pass=0;pass<2;pass++){
      const candidates=[30,60,90,120,150].map((degrees,index)=>{
        const angle=heading+side*degrees*Math.PI/180;
        const radius=length*(1+Math.min(2,Math.floor(fan/4))*0.25);
        return {x:self.x+Math.cos(angle)*radius,y:self.y+Math.sin(angle)*radius,index};
      }).filter(allowed).sort((a,b)=>(p.cost?.(a)||0)-(p.cost?.(b)||0)||a.index-b.index);
      if(candidates.length){fan++;return send(candidates[0],gap<7?'bounded fan search':'persistent '+(side>0?'left':'right')+' detour; '+reason);}
      side*=-1;
    }
    fan++;retryAt=now+250;p.report('Recovering sight: local steps blocked; retrying without releasing target');return true;
  }
  return {tick,reset,observe};
}
