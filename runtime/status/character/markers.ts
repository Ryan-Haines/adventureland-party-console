import {markerRadius,markerStyle} from "./marker-style.ts";
import {scope} from "../../lifecycle/api.ts";
import type {QueueMarker} from "./telemetry.ts";
/** Owned PIXI layer: never clears other CODE drawings. `queue` is the status owner's marker view (shared.js `partyStatus.character`). */
export function installQueueMarkers(queue:()=>QueueMarker[]|null){
  const host=parent as any;host.__partyQueueMarkers?.stop();
  let graphics:any=null;
  const clear=()=>{if(graphics){graphics.destroy();graphics=null;}};
  function draw(){
    // Headless caracAL clients set no_graphics, and the game then loads a stub
    // PIXI whose Graphics draws nothing, so draw skips the queue computation
    // there. draw checks on every frame, so a renderer that appears later
    // starts drawing on its next frame.
    if(host.no_graphics||!host.PIXI?.Graphics||!host.map||host.socket?.disconnected){clear();return;}
    const markers=queue()||[];
    if(!markers.length){clear();return;}
    if(!graphics||graphics.destroyed||graphics.parent!==host.map){clear();graphics=new host.PIXI.Graphics();host.map.addChild(graphics);}
    graphics.clear();
    const scale=Math.abs(host.map.scale?.x)||1;
    markers.forEach((t:any,index:number)=>{
      const e=get_entity(t.id) as any;
      if(!e||!e.visible||e.dead||t.visible===false||t.map!==character.map||t.in!==character.in)return;
      const radius=t.radius||markerRadius(e);
      const style=markerStyle(t,index);
      graphics.lineStyle(3/scale,style.color);
      graphics.drawCircle(e.real_x??e.x,e.real_y??e.y,radius);
      if(style.double)graphics.drawCircle(e.real_x??e.x,e.real_y??e.y,radius+6/scale);
    });
  }
  // The status owner's `observe` registration: the markers draw through a Pause.
  // The circles follow live entity positions and the queue's current entries, so they redraw on each
  // of the game's draw frames (`afterDraw`), the frame the game renders those positions in.
  const observe=scope('12','observe');let stopped=false;
  function frame(){if(stopped)return;draw();observe.afterDraw(frame);}
  observe.afterDraw(frame);
  const api={stop(){stopped=true;clear();}};host.__partyQueueMarkers=api;return api;
}
