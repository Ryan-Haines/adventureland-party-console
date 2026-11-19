"use client";
import { AddonSlot } from '../../../runtime/hooks/dashboard/slots';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { domainOptions, useVisible } from './query-cache';
import { logFilters, defaultLogFilters, showGameLog, classifyGameLog } from '../../../runtime/status/game-log.ts';
import type { PartyState } from './party-state';
import {useSessionState} from './session-state';
import {useCharacterData} from './dashboard-live';
import {useStoredJson} from '@/hooks/use-stored-boolean';
import {STATUS_PICKS} from '../../../runtime/status/rules.ts';
// The game log lines the coordinator keeps per character (the status owner's `gameLogLines`), which bound the list too.
const shownLines=STATUS_PICKS.gameLogLines;
const noSavedFilters:Record<string,boolean>={};
export function LogSidebar({state,width,onWidth,onClose}:{state:PartyState;width:number;onWidth:(n:number)=>void;onClose:()=>void}){
  const client=useQueryClient(),visible=useVisible();
  const query=useQuery({...domainOptions(client,'logs'),enabled:visible});
  const [tab,setTab]=useSessionState<'game'|'dashboard'>('logs-tab','game'),[source,setSource]=useSessionState('logs-source','all');
  const [excludedCharacters,setExcludedCharacters]=useSessionState<Record<string,boolean>>('logs-characters',{});
  const [saved,setFilters]=useStoredJson<Record<string,boolean>>('party-log-filters',noSavedFilters);
  const filters=useMemo(()=>({...defaultLogFilters,...saved}),[saved]);
  const scroller=useRef<HTMLDivElement>(null),following=useRef(true);
  const gameLogs=query.data?.gameLogs,combatLogs=query.data?.combatLogs,merchantActivity=query.data?.merchantActivity,settingsChanges=query.data?.settingsChanges;
  const game=useMemo(()=>Object.entries(gameLogs||{}).flatMap(([name,events])=>events.map(e=>({...e,category:classifyGameLog(e.message),name,source:'game',key:name+e.session+e.seq}))),[gameLogs]);
  const combat=useMemo(()=>Object.entries(combatLogs||{}).flatMap(([name,events])=>events.map((e,i)=>({at:e.at,message:e.message,name,source:'combat',category:e.type,key:`combat:${name}:${e.at}:${i}`,color:''}))),[combatLogs]);
  const merchant=useMemo(()=>(merchantActivity||[]).map((e,i)=>({at:e.at,message:e.message,name:state.merchantCharacter||'',source:'merchant',category:e.level,key:`merchant:${e.at}:${i}`,color:''})),[merchantActivity,state.merchantCharacter]);
  // The settings owner's audit lines: who changed which setting, from what to what.
  const settings=useMemo(()=>(settingsChanges||[]).map((e,i)=>({at:e.at,message:`${e.addon?e.addon+' ':''}${e.key??e.field}${e.character?` (${e.character})`:''}: ${JSON.stringify(e.old??null)} -> ${JSON.stringify(e.new??null)} by ${e.by}`,name:e.character||'',source:'settings',category:'settings',key:`settings:${e.at}:${i}`,color:''})),[settingsChanges]);
  const anniversary=useMemo(()=>(state.anniversary?.activity||[]).map((e,i)=>({at:e.at,message:e.message,name:'',source:'anniversary',category:e.level,key:`anniversary:${e.at}:${i}`,color:''})),[state.anniversary?.activity]);
  const entries=useMemo(()=>(tab==='game'?game:[...combat,...merchant,...anniversary,...settings]).filter(e=>!excludedCharacters[e.name]&&(tab==='game'?showGameLog(e.category||'other',filters):source==='all'||source===e.source)).sort((a,b)=>a.at-b.at).slice(-shownLines),[tab,game,combat,merchant,anniversary,settings,excludedCharacters,source,filters]);
  useEffect(()=>{if(following.current && scroller.current)scroller.current.scrollTop=scroller.current.scrollHeight;},[entries]);
  const names=useMemo(()=>Array.from(new Set([...Object.keys(state.characters),...Object.keys(gameLogs||{}),...Object.keys(combatLogs||{}),...(state.bankbois||[]).map(b=>b.name),...(state.merchantCharacter?[state.merchantCharacter]:[])])),[state.characters,gameLogs,combatLogs,state.bankbois,state.merchantCharacter]);
  const selectedNames=names.filter(name=>!excludedCharacters[name]);
  // One character shown: its online answer is the coordinator's one presence rule.
  const presence=useCharacterData(selectedNames.length===1?selectedNames[0]:'','presence');
  const entryList=useMemo(()=>entries.map(e=><p key={e.key} className="break-words"><span className="text-slate-500">{new Date(e.at).toLocaleTimeString()} {e.name ? `[${e.name}]` : `[${e.source}]`} </span><span style={{color: /^#[0-9a-f]{3,8}$/i.test(e.color)?e.color:undefined}} className={e.category==='errors'||e.category==='error'?'text-rose-300':'text-slate-100'}>{e.message}</span></p>),[entries]);
  const button='rounded border border-slate-500 bg-slate-950 px-2 py-1 text-sm text-slate-100 hover:bg-slate-700';
  return <aside data-area="logs" aria-label="Live logs" className="fixed bottom-0 right-0 top-0 z-40 flex flex-col border-l border-slate-500 bg-slate-950 text-slate-100 shadow-xl" style={{width,maxWidth:'75vw'}}>
    <div role="separator" aria-label="Resize logs" aria-orientation="vertical" tabIndex={0} className="absolute -left-1 top-0 h-full w-2 cursor-col-resize touch-none hover:bg-cyan-600/40" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId))onWidth(Math.max(260,Math.min(window.innerWidth*.75,window.innerWidth-e.clientX)));}} onKeyDown={e=>{if(e.key==='ArrowLeft')onWidth(width+20);if(e.key==='ArrowRight')onWidth(Math.max(260,width-20));}} />
    <div className="flex items-center justify-between p-3"><h2 className="font-semibold">Live logs</h2><button aria-label="Close logs" className={button} onClick={onClose}><X className="size-4" /></button></div>
    <div role="tablist" className="flex gap-2 px-3">{(['game','dashboard'] as const).map(t=><button key={t} role="tab" aria-selected={tab===t} className={button+(tab===t?' border-cyan-300 bg-cyan-950':'')} onClick={()=>setTab(t)}>{t==='game'?'Game logs':'Dashboard logs'}</button>)}</div>
    <div className="flex flex-wrap gap-1 p-3">{tab==='game'?logFilters.map(f=><button key={f.id} aria-pressed={filters[f.id]} className={button+(!filters[f.id]?' text-slate-500':' border-cyan-700')} onClick={()=>setFilters({...filters,[f.id]:!filters[f.id]})}>{f.label}</button>):<select aria-label="Dashboard log source" value={source} onChange={e=>setSource(e.target.value)} className={button}><option value="all">All sources</option><option value="combat">Combat</option><option value="merchant">Merchant / coordinator</option><option value="anniversary">Anniversary</option><option value="settings">Settings history</option></select>}</div>
    <div role="group" aria-label="Log characters" className="flex flex-wrap gap-2 px-3">{names.map(name=><button key={name} aria-pressed={!excludedCharacters[name]} className={'rounded-full border px-3 py-1 text-sm '+(!excludedCharacters[name]?'border-cyan-400 bg-cyan-950 text-cyan-100 hover:bg-cyan-900 hover:text-white':'border-slate-600 bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white')} onClick={()=>setExcludedCharacters(previous=>({...previous,[name]:!previous[name]}))}>{name}</button>)}</div>
    <p className="px-3 py-2 text-xs text-slate-400">{query.isError?'Disconnected - showing retained logs':selectedNames.length===1 && !presence?.seenAt?'Character offline - showing retained logs':`Live updates · latest ${shownLines.toLocaleString()} matching entries${tab==='game'?' · kept in memory; cleared on a console restart':''}`}</p>
    <div ref={scroller} onScroll={e=>{const el=e.currentTarget;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<32;}} className="min-h-0 flex-1 space-y-2 overflow-auto px-3 pb-3 font-mono text-xs">{entryList}{!entries.length&&<p className="text-slate-400">No matching logs yet.</p>}</div>
    <AddonSlot name="page-section" part="logs" state={state} />
  </aside>;
}
