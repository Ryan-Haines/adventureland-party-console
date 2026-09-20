import { classifyGameLog, defaultLogFilters, logFilters, showGameLog, type GameLog } from '../game-log-filters.ts';
interface Host {
  caracAL?: { install_game_logs?: (send: Capture['send']) => ReturnType<typeof installHostGameLogs> };
  add_log?: (message: unknown, color?: string) => unknown;
  document?: Document;
  localStorage?: Storage;
  __partyGameLogCapture?: Capture;
}
interface Capture { original: NonNullable<Host['add_log']>; wrapped: NonNullable<Host['add_log']>; queue: GameLog[]; seq:number; session:string; send:(events:GameLog[])=>Promise<unknown>; busy:boolean; filters:Record<string,boolean>; }
export function installGameLogs(host: Host, send: Capture['send']) {
  // caracAL exposes guarded, dynamically resolved methods to CODE. Installing
  // an override through that facade would make the saved add_log call itself.
  if (host.caracAL?.install_game_logs) return host.caracAL.install_game_logs(send);
  return installHostGameLogs(host, send);
}
export function installHostGameLogs(host: Host, send: Capture['send']) {
  let capture=host.__partyGameLogCapture;
  if(!host.add_log)return null;
  let filters={...defaultLogFilters};
  try{filters={...filters,...JSON.parse(host.localStorage?.getItem('party-game-log-filters') || '{}')};}catch{/* Defaults. */}
  capture ??= {original:host.add_log,wrapped:host.add_log,queue:[],seq:0,session:Date.now()+'-'+Math.random().toString(36).slice(2),send,busy:false,filters};
  capture.send=send;
  capture.filters={...defaultLogFilters,...capture.filters};
  const state=capture;
  function filterDOM(){
    host.document?.querySelectorAll<HTMLElement>('#gamelog .gameentry').forEach(entry=>{entry.style.display=showGameLog(classifyGameLog(entry.textContent || ''),state.filters)?'':'none';});
  }
  state.wrapped=function(message,color){
    const log=host.document?.getElementById('gamelog');
    const top=log?.scrollTop || 0;
    const following=!log || log.scrollHeight-top-log.clientHeight<=1;
    const viewportTop=log?.getBoundingClientRect().top || 0;
    const anchor=!following && log
      ? Array.from(log.querySelectorAll<HTMLElement>('.gameentry')).find(element=>element.getBoundingClientRect().bottom>viewportTop)
      : undefined;
    const offset=anchor ? anchor.getBoundingClientRect().top-viewportTop : 0;
    const raw=typeof message==='string'?message:String(message);
    const text=host.document?.createElement('div');if(text)text.innerHTML=raw;
    const plain=text?.textContent || raw.replace(/<[^>]*>/g,'');
    const entry:GameLog={session:state.session,seq:++state.seq,at:Date.now(),message:plain.slice(0,4000),color:color || 'white',category:classifyGameLog(plain)};
    state.queue.push(entry);if(state.queue.length>1000)state.queue.splice(0,state.queue.length-1000);
    const result=state.original.call(host,host.document ? `<span style="color:#94a3b8">${new Date(entry.at).toLocaleTimeString()} | </span>${raw}` : message,color);
    filterDOM();
    // The native renderer scrolls unconditionally. Restore the visible entry
    // after rendering/filtering, including when old entries were trimmed.
    if(log){
      log.scrollTop=following ? log.scrollHeight : anchor && log.contains(anchor)
        ? log.scrollTop+anchor.getBoundingClientRect().top-log.getBoundingClientRect().top-offset
        : top;
    }
    return result;
  };
  host.add_log=state.wrapped;host.__partyGameLogCapture=state;
  const doc=host.document, log=doc?.getElementById('gamelog');
  if(doc && log){
    doc.getElementById('party-game-log-filters')?.remove();
    let layout=doc.getElementById('party-game-log-layout');
    if(!layout){layout=doc.createElement('style');layout.id='party-game-log-layout';doc.head.appendChild(layout);}
    layout.textContent=`
      #bottomrightcorner { text-align:right; }
      #bottomrightcorner > .xpsui { margin-bottom:0 !important; vertical-align:bottom; }
      #party-game-log-panel { position:relative; max-width:100vw; margin-left:auto; padding-top:0; box-sizing:border-box; }
      #party-game-log-panel #gamelog { width:100% !important; min-width:0; cursor:text; }
      #party-game-log-panel #gamelog, #party-game-log-panel #gamelog * { user-select:text !important; -webkit-user-select:text !important; }
      #party-game-log-resize { position:absolute; left:0; top:0; bottom:0; width:6px; z-index:1; cursor:ew-resize; touch-action:none; background:#475569; border:0; padding:0; }
      #party-game-log-resize:hover, #party-game-log-resize:focus-visible { background:#38bdf8; outline:1px solid white; }
    `;
    // Keep the controls within the native log's footprint. Adding a sibling
    // above it grows the bottom-anchored UI upward into tutorial/XP controls.
    let panel=doc.getElementById('party-game-log-panel');
    if(!panel){
      const height=log.getBoundingClientRect().height || parseFloat(doc.defaultView?.getComputedStyle(log).height || '') || 200;
      panel=doc.createElement('div');panel.id='party-game-log-panel';
      panel.style.cssText=`display:grid;grid-template-rows:auto minmax(0,1fr);height:${height}px;min-height:0;overflow:hidden;`;
      log.before(panel);panel.appendChild(log);
      log.style.setProperty('height','100%','important');
      log.style.setProperty('min-height','0','important');
      log.style.boxSizing='border-box';
    }
    installLogResize(host,doc,panel);
    // Stop the game's mouse/keyboard handlers without cancelling the browser's
    // native selection, context menu, or Ctrl/Cmd+C behavior.
    const stopGameInput=(event:Event)=>event.stopPropagation();
    log.onmousedown=log.onpointerdown=log.onclick=log.oncontextmenu=stopGameInput;
    log.onkeydown=log.onkeyup=event=>event.stopPropagation();
    log.onselectstart=event=>{event.stopPropagation();return true;};
    log.tabIndex=0;
    const bar=doc.createElement('div');bar.id='party-game-log-filters';bar.className='enableclicks';bar.style.cssText='display:flex;flex-wrap:wrap;background:#020617;border:1px solid #64748b;';
    for(const filter of logFilters){const button=doc.createElement('button');button.textContent=filter.label;button.style.cssText='flex:1 0 auto;padding:4px;font:12px/20px sans-serif;white-space:nowrap;border:1px solid #475569;background:#0f172a;color:white;cursor:pointer;';
      const update=()=>{button.setAttribute('aria-pressed',String(state.filters[filter.id]));button.style.color=state.filters[filter.id]?'#fff':'#94a3b8';};update();
      button.onclick=()=>{state.filters[filter.id]=!state.filters[filter.id];try{host.localStorage?.setItem('party-game-log-filters',JSON.stringify(state.filters));}catch{}update();filterDOM();};bar.appendChild(button);}
    panel.prepend(bar);filterDOM();
  }
  return {pulse:()=>pulse(state)};
}
function installLogResize(host:Host,doc:Document,panel:HTMLElement){
  doc.getElementById('party-game-log-resize')?.remove();
  const nativeWidth=()=>doc.querySelector('.xpsui')?.getBoundingClientRect().width || doc.querySelector('.tutorialui')?.getBoundingClientRect().width || 330;
  const handle=doc.createElement('div');handle.id='party-game-log-resize';handle.className='enableclicks';
  handle.tabIndex=0;handle.setAttribute('role','separator');handle.setAttribute('aria-orientation','vertical');
  handle.setAttribute('aria-label','Resize game logs');handle.title='Drag left to widen logs. Double-click to reset.';
  const setWidth=(width:number)=>{
    const maximum=doc.defaultView?.innerWidth || 1920;
    const next=Math.min(maximum,Math.max(nativeWidth(),width));
    panel.style.width=next+'px';handle.setAttribute('aria-valuenow',String(Math.round(next)));
    handle.setAttribute('aria-valuemin',String(Math.min(nativeWidth(),maximum)));handle.setAttribute('aria-valuemax',String(maximum));
    return next;
  };
  const save=(width:number)=>{try{host.localStorage?.setItem('party-game-log-width',String(width));}catch{}};
  let saved=0;try{saved=Number(host.localStorage?.getItem('party-game-log-width'));}catch{}
  setWidth(Number.isFinite(saved)&&saved>0?saved:nativeWidth());
  let drag:{id:number;x:number;width:number}|null=null;
  handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();event.stopPropagation();drag={id:event.pointerId,x:event.clientX,width:parseFloat(panel.style.width)};handle.setPointerCapture(event.pointerId);};
  handle.onpointermove=event=>{if(drag?.id===event.pointerId)setWidth(drag.width+drag.x-event.clientX);};
  handle.onpointerup=event=>{if(drag?.id!==event.pointerId)return;save(parseFloat(panel.style.width));drag=null;handle.releasePointerCapture(event.pointerId);};
  handle.onpointercancel=()=>{if(drag)setWidth(drag.width);drag=null;};
  handle.onlostpointercapture=()=>{drag=null;};
  handle.ondblclick=event=>{event.stopPropagation();save(setWidth(nativeWidth()));};
  handle.onkeydown=event=>{if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight'&&event.key!=='Home')return;event.preventDefault();event.stopPropagation();save(setWidth(event.key==='Home'?nativeWidth():parseFloat(panel.style.width)+(event.key==='ArrowLeft'?20:-20)));};
  panel.appendChild(handle);
}
async function pulse(state:Capture){
  if(state.busy || !state.queue.length)return;
  state.busy=true;const events=state.queue.slice(0,100);
  try{await state.send(events);const last=events[events.length-1]!.seq;state.queue=state.queue.filter(e=>e.seq>last);}catch{/* Retain for the next pulse. */}finally{state.busy=false;}
}
