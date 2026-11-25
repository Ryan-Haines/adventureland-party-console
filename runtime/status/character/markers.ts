import {markerRadius,markerStyle} from "./marker-style.ts";
import {scope} from "../../lifecycle/api.ts";
import type {QueueMarker} from "./telemetry.ts";
/** Owned PIXI layer: never clears other CODE drawings. `queue` is the status owner's marker view (shared.js `partyStatus.character`). */
export function installQueueMarkers(queue:()=>QueueMarker[]|null){
  const host=parent as any;host.__partyQueueMarkers?.stop();
  // The layer holds one ring per drawn marker. A ring keeps its circle geometry while its radius,
  // style and the map scale stay, and each frame only moves it to its monster, so the renderer
  // rebuilds and uploads a ring's geometry only when its look changes. `shapes` is each ring's
  // look, by its place in the layer.
  let layer:any=null;const shapes:string[]=[];
  const clear=()=>{if(layer){layer.destroy({children:true});layer=null;shapes.length=0;}};
  function draw(){
    // Headless caracAL clients set no_graphics, and the game then loads a stub
    // PIXI whose Graphics draws nothing, so draw skips the queue computation
    // there. draw checks on every frame, so a renderer that appears later
    // starts drawing on its next frame.
    if(host.no_graphics||!host.PIXI?.Graphics||!host.map||host.socket?.disconnected){clear();return;}
    const markers=queue()||[];
    if(!markers.length){clear();return;}
    if(!layer||layer.destroyed||layer.parent!==host.map){clear();layer=new host.PIXI.Graphics();host.map.addChild(layer);}
    const scale=Math.abs(host.map.scale?.x)||1;
    let drawn=0;
    markers.forEach((t:any,index:number)=>{
      const e=get_entity(t.id) as any;
      if(!e||!e.visible||e.dead||t.visible===false||t.map!==character.map||t.in!==character.in)return;
      const radius=t.radius||markerRadius(e);
      const style=markerStyle(t,index),shape=[radius,style.color,style.double,scale].join('|');
      const ring=layer.children[drawn]??layer.addChild(new host.PIXI.Graphics());
      if(shapes[drawn]!==shape){
        ring.clear();
        ring.lineStyle(3/scale,style.color);
        ring.drawCircle(0,0,radius);
        if(style.double)ring.drawCircle(0,0,radius+6/scale);
        shapes[drawn]=shape;
      }
      ring.position.set(e.real_x??e.x,e.real_y??e.y);
      ring.visible=true;
      drawn++;
    });
    for(let i=drawn;i<layer.children.length;i++)layer.children[i].visible=false;
  }
  // The status owner's `observe` registration: the markers draw through a Pause.
  // The circles follow live entity positions and the queue's current entries, so they redraw on each
  // of the game's draw frames (`afterDraw`), the frame the game renders those positions in.
  const observe=scope('12','observe');let stopped=false;
  function frame(){if(stopped)return;draw();observe.afterDraw(frame);}
  observe.afterDraw(frame);
  const api={stop(){stopped=true;clear();}};host.__partyQueueMarkers=api;return api;
}
