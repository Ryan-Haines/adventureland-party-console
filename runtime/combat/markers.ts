import {markerStyle} from "./marker-style.ts";
/** Owned PIXI layer: never clears other CODE drawings. */
export function installQueueMarkers(root:any,shared:any){
  const host=parent as any;host.__partyQueueMarkers?.stop();
  let graphics:any=null;
  const clear=()=>{if(graphics){graphics.destroy();graphics=null;}};
  function draw(){
    const markers=shared.queueMarkers()||[];
    if(!host.PIXI?.Graphics||!host.map||!markers.length||host.socket?.disconnected){clear();return;}
    if(!graphics||graphics.destroyed||graphics.parent!==host.map){clear();graphics=new host.PIXI.Graphics();host.map.addChild(graphics);}
    graphics.clear();
    const scale=Math.abs(host.map.scale?.x)||1;
    markers.forEach((t:any,index:number)=>{
      const e=get_entity(t.id) as any;
      if(!e||!e.visible||e.dead||t.visible===false||t.map!==character.map||t.in!==character.in)return;
      const radius=t.radius||Math.max(18,(Number(e.awidth)||24)/2+4);
      const style=markerStyle(t,index);
      graphics.lineStyle(3/scale,style.color);
      graphics.drawCircle(e.real_x??e.x,e.real_y??e.y,radius);
      if(style.double)graphics.drawCircle(e.real_x??e.x,e.real_y??e.y,radius+6/scale);
    });
  }
  const timer=setInterval(draw,50);
  const api={stop(){clearInterval(timer);clear();}};host.__partyQueueMarkers=api;return api;
}
