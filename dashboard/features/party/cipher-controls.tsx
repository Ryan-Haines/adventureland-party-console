'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select';
import {ItemSprite} from './item-sprite';
import {CenteredMonsterSprite} from './centered-monster-sprite';
import type {Sprite} from './sprite';
import {cipherCandidates,cipherIngredients,validMix,type CipherBoard,type CipherSettings,type CipherGatheringPlan} from '../../../runtime/events/october';

export interface CipherView {
  board:CipherBoard|null;
  ingredients:{id:string;name:string;sprite?:Sprite|null}[];
  gathering?:[string,string[]][];
  sources?:{ingredient:string;id:string;name:string;sprite?:Sprite|null;rate:number}[];
  stock?:Record<string,number>;
  gatheringPlan?:CipherGatheringPlan;
  merchant?:string|null;
  runtime?:{phase:string;detail:string;candidates?:number;day?:{mixes_left?:number;server?:string};journal?:{last?:{action:string;result:unknown}}};
}
const button='rounded border border-slate-500 bg-slate-950 px-3 py-2 text-emerald-50 hover:bg-slate-800 disabled:opacity-50';
const input='rounded border border-slate-500 bg-slate-950 p-2 text-emerald-50';
const fallback:[string,string[]][]=[['verdantspore',['goo','bee','spider','croc']],['frostscale',['arcticbee','boar','wolfie','iceroamer']],['embercoal',['plantoid','porcupine','fireroamer','gscorpion']],['gloomfeather',['snake','osnake','minimush','ghost']]];
function Ingredient({id,view,horizontal=false,onInspect}:{id:string;view?:CipherView;horizontal?:boolean;onInspect?:(id:string)=>void}){
  const item=view?.ingredients.find(item=>item.id===id);
  const name=item?.name??({verdantspore:'Verdant Spore',frostscale:'Frost Scale',embercoal:'Ember Coal',gloomfeather:'Gloom Feather'} as Record<string,string>)[id]??id;
  const content=<span className={`inline-flex min-w-10 items-center gap-1 ${horizontal?'':'flex-col'}`} title={name}>
    <span role="img" aria-label={name} className="relative block h-12 w-12 shrink-0">{item?.sprite?<ItemSprite sprite={item.sprite}/>:<span className="block h-12 w-12 rounded border border-slate-500 bg-slate-800"/>}</span>
    <span className={horizontal?'text-xs':'max-w-20 text-center text-[10px] text-slate-300'}>{name}</span>
  </span>;
  return onInspect?<button type="button" aria-label={`View ${name} details`} className="rounded border border-slate-600 bg-slate-950 p-1 text-emerald-50 hover:border-cyan-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-300" onClick={()=>onInspect(id)}>{content}</button>:content;
}
function MonsterChoice({id,ingredient,view}:{id:string;ingredient:string;view?:CipherView}){
  const source=view?.sources?.find(entry=>entry.id===id&&entry.ingredient===ingredient);
  const rate=source&&Number.isFinite(source.rate)?`${(source.rate*100).toLocaleString(undefined,{maximumFractionDigits:4})}%`:'Rate unavailable';
  return <span className="flex items-center gap-2">
    <span role="img" aria-label={source?.name??id} className="relative block h-12 w-12 shrink-0 overflow-hidden">{source?.sprite&&<CenteredMonsterSprite sprite={source.sprite}/>}</span>
    <span>{source?.name??id}<span className="block text-xs text-cyan-200">{rate}</span></span>
  </span>;
}
function Board({view,onInspect}:{view?:CipherView;onInspect?:(id:string)=>void}){
  const candidates=useMemo(()=>view?.board?cipherCandidates(view.board):[],[view?.board]);
  return <section aria-label="Shared realm board" className="space-y-2 rounded border border-purple-700 bg-[#10141f] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-purple-100">Shared realm board</h3><span className="text-xs text-slate-400">Refreshes every 5 seconds</span></div>
    <p className="text-xs text-slate-300">{view?.board?.live?`${view.board.mixes??view.board.board?.length??0} clues · ${candidates.length} possible recipes · recipe ${(view.board.cracks??0)+1}`:'No live cipher board is available.'}</p>
    {view?.board?.cracked&&<div className="rounded border border-amber-700 bg-slate-900 p-2"><p className="mb-2 text-xs text-amber-200">Previous recipe solved by {view.board.cracked.by}</p><div className="flex justify-around">{view.board.cracked.recipe.map((id,i)=><Ingredient key={i} id={id} view={view} onInspect={onInspect}/>)}</div></div>}
    <div className="max-h-72 space-y-2 overflow-y-auto">
      {!view?.board?.board?.length&&<p className="py-3 text-center text-xs text-slate-400">The current recipe has no clues yet.</p>}
      {view?.board?.board?.slice().reverse().map((row,i)=><div key={i} className="flex items-center gap-2 rounded border border-slate-600 bg-slate-950 p-2"><div className="flex flex-1 justify-around">{row.mix.map((id,j)=><Ingredient key={j} id={id} view={view} onInspect={onInspect}/>)}</div><strong className="w-12 shrink-0 text-center text-emerald-300">{row.right}/5<br/><span className="text-[10px] font-normal">in place</span></strong></div>)}
    </div>
  </section>;
}
export function CipherControls({value,onChange,view,disabled,onManual,onInspectIngredient}:{onInspectIngredient?:(id:string)=>void;value:CipherSettings;onChange:(value:CipherSettings)=>void;view?:CipherView;disabled:boolean;onManual:(mix:string[])=>Promise<unknown>}){
  const [manual,setManual]=useState(false),[mix,setMix]=useState<string[]>(Array(5).fill('verdantspore'));
  const [error,setError]=useState(''),[sending,setSending]=useState(false);
  // Sample the dashboard's fresh coordinator feed while this popup is mounted.
  const latestView=useRef(view);latestView.current=view;
  const [boardView,setBoardView]=useState(view);
  useEffect(()=>{const timer=setInterval(()=>setBoardView(latestView.current),5000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setBoardView(latestView.current);},[view?.board?.id]);
  const candidates=useMemo(()=>view?.board?cipherCandidates(view.board):[],[view?.board]);
  const fits=validMix(mix)&&candidates.some(recipe=>recipe.join(',')===mix.join(','));
  const tried=view?.board?.board?.some(row=>row.mix.join(',')===mix.join(','));
  return <div className="space-y-3 rounded border border-purple-700 bg-slate-950 p-3">
    <p className="text-xs text-slate-300">Have all four ingredients? Head to the witch. Otherwise farm the lowest stock, with ties resolved top to bottom. If a solution needs more of an ingredient, farm that ingredient for the remaining gathering window. The merchant brews up to five mixes per account per UTC day, on one realm.</p>
    <p className="text-xs text-amber-200">Gathering stops after 20 minutes. Then go to the witch only with all four ingredient types; otherwise resume normal farming. A selected gathering target stays fixed until that cutoff.</p>
    <p className="text-xs text-slate-400">Counts include usable carried ingredients across the party and merchant. Drop rates below are base chances per kill during gathering; Luck can increase them.</p>
    {(view?.gathering??fallback).map(([ingredient,monsters],i)=>{
      const selected=value.gatherMonsters?.[i]??monsters[0];
      return <div key={ingredient} className="flex items-center justify-between gap-3 rounded border border-slate-700 bg-[#10141f] p-2">
        <span className="min-w-0"><Ingredient id={ingredient} view={view} horizontal onInspect={onInspectIngredient}/><span className="ml-12 block text-xs text-slate-400">Carried: {view?.stock?.[ingredient]??'Waiting for inventory'}</span></span>
        <Select value={selected} disabled={disabled} onValueChange={next=>{if(!next)return;const choices=[...(value.gatherMonsters??fallback.map(entry=>entry[1][0]))];choices[i]=next;onChange({...value,gatherMonsters:choices});}}>
          <SelectTrigger aria-label={`${ingredient} farming monster`} className="min-h-16 min-w-44 data-[size=default]:h-auto border-slate-500 bg-slate-950 text-emerald-50 hover:bg-slate-800"><SelectValue><MonsterChoice id={selected} ingredient={ingredient} view={view}/></SelectValue></SelectTrigger>
          <SelectContent className="border border-slate-500 bg-slate-950 text-emerald-50 [&_[data-slot=select-scroll-up-button]]:bg-slate-950 [&_[data-slot=select-scroll-down-button]]:bg-slate-950">
            {monsters.map(id=><SelectItem key={id} value={id} className="bg-slate-950 text-emerald-50 focus:bg-slate-800 focus:text-white not-data-[variant=destructive]:focus:**:text-white data-highlighted:bg-slate-800 data-highlighted:text-white"><MonsterChoice id={id} ingredient={ingredient} view={view}/></SelectItem>)}
          </SelectContent>
        </Select>
      </div>;
    })}
    {view?.gatheringPlan&&<p className="text-xs text-purple-200">This event: {view.gatheringPlan.mode==='gathering'?`farm ${view.gatheringPlan.monster} for ${view.ingredients.find(item=>item.id===view.gatheringPlan?.ingredient)?.name??view.gatheringPlan.ingredient}`:view.gatheringPlan.mode==='finished'?'return to normal farming':'solve at the witch'}.</p>}
    <label className="flex items-center justify-between gap-3">Only attempt with at least this many clues<input aria-label="Minimum clues" className={`${input} w-20`} type="number" min="0" max="1024" step="1" value={value.minClues} disabled={disabled} onChange={e=>onChange({...value,minClues:Number(e.target.value)})}/></label>
    <label className="flex items-center gap-2"><input type="checkbox" checked={value.automatic} disabled={disabled} onChange={e=>onChange({...value,automatic:e.target.checked})}/>Automatically try solutions</label>
    {!value.automatic&&<button type="button" className={button} disabled={disabled} onClick={()=>{setManual(true);setError('');}}>Manually enter solution</button>}
    {view?.runtime&&<p role="status" className="text-xs text-purple-200">{view.merchant??'Merchant'}: {view.runtime.phase}{view.runtime.detail?` · ${view.runtime.detail}`:''}{view.runtime.day?.mixes_left!==undefined?` · ${view.runtime.day.mixes_left} mixes left`:''}</p>}
    <Board view={boardView} onInspect={onInspectIngredient}/>
    {manual&&<Dialog open onOpenChange={open=>{if(!open&&!sending)setManual(false);}}><DialogContent style={{zIndex:60}} className="max-h-[90vh] overflow-y-auto border border-purple-600 bg-[#10141f] text-slate-100 sm:max-w-2xl [&_[data-slot=dialog-close]]:border [&_[data-slot=dialog-close]]:border-slate-500 [&_[data-slot=dialog-close]]:bg-slate-950 [&_[data-slot=dialog-close]]:text-slate-100 [&_[data-slot=dialog-close]]:hover:bg-slate-800"><DialogHeader><DialogTitle>Enter a five-ingredient solution</DialogTitle><DialogDescription className="text-slate-300">Clues count correct positions only. Your mix must fit the current recipe.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-5 gap-2">{mix.map((id,i)=><label key={i} className="flex min-w-0 flex-col items-center gap-2"><span className="text-xs text-slate-400">Slot {i+1}</span><Ingredient id={id} view={view}/><select aria-label={`Ingredient ${i+1}`} className={`${input} w-full text-xs`} value={id} onChange={e=>setMix(mix.map((old,j)=>j===i?e.target.value:old))}>{cipherIngredients.map(name=><option key={name} value={name}>{view?.ingredients.find(item=>item.id===name)?.name??name}</option>)}</select></label>)}</div>
      <p className={fits&&!tried?'text-emerald-300':'text-amber-200'}>{tried?'This mix was already tried.':fits?'Fits every known clue.':'Does not fit the current clues, or complete clues are unavailable.'}</p>
      {error&&<p role="alert" className="text-red-300">{error}</p>}
      <button type="button" className={button} disabled={sending||!view?.board?.live||!fits||tried||!view?.merchant} onClick={async()=>{setSending(true);try{await onManual(mix);setManual(false);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setSending(false);}}}>Send solution to merchant</button>
      <button type="button" className={button} disabled={sending} onClick={()=>setManual(false)}>Close solution</button>
    </DialogContent></Dialog>}
  </div>;
}
