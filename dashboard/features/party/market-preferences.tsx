'use client';
import {useState,type ReactNode} from 'react';
import {ChevronDown,ChevronRight,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {marketItemKey} from '../../../runtime/items/api.ts';
import type {MarketIgnoredItem,MarketItemIdentity} from '../../../runtime/items/api.ts';

export function MarketSettingsSection({title,count,clearLabel='Clear all',clearAriaLabel,disabled,onClear,children}:{
  title:string;count:number;clearLabel?:string;clearAriaLabel?:string;disabled:boolean;onClear:()=>void;children:ReactNode;
}){
  const [open,setOpen]=useState(false);
  return <section data-area="market-preferences" className="rounded border border-slate-600 bg-black p-3">
    <div className="flex items-center justify-between gap-3">
      <Button aria-label={title} aria-expanded={open} onClick={()=>setOpen(value=>!value)}
        className="min-w-0 justify-start border border-slate-700 bg-slate-950 text-slate-100 hover:border-slate-500 hover:bg-slate-900 hover:text-white">
        {open?<ChevronDown className="size-4 shrink-0"/>:<ChevronRight className="size-4 shrink-0"/>}
        {title}<span className="text-slate-300">({count})</span>
      </Button>
      <Button aria-label={clearAriaLabel} disabled={disabled||!count} onClick={onClear}
        className="shrink-0 border border-rose-600 bg-black text-rose-200 hover:bg-rose-950 hover:text-white">{clearLabel}</Button>
    </div>
    {open&&<div className="mt-3 space-y-3">{children}</div>}
  </section>;
}

export function IgnoreMarketItemButton({label,disabled,onIgnore}:{label:string;disabled:boolean;onIgnore:()=>void}){
  return <Button type="button" size="icon" aria-label={`Ignore listings of ${label}`} title={`Ignore listings of ${label}`}
    disabled={disabled} onClick={onIgnore}
    className="size-7 shrink-0 border border-red-800 bg-red-950 text-red-300 hover:border-red-500 hover:bg-red-900 hover:text-white"><X className="size-4"/></Button>;
}

export function IgnoredMarketItems({items,label,disabled,onRemove,onClear}:{items:MarketIgnoredItem[];label:(item:MarketItemIdentity)=>string;
  disabled:boolean;onRemove:(item:MarketIgnoredItem)=>void;onClear:()=>void}){
  return <MarketSettingsSection title="Ignored items" count={items.length} clearAriaLabel="Clear all ignored items" disabled={disabled} onClear={onClear}>
    {items.length?items.map(item=><div key={marketItemKey(item)} className="flex items-center justify-between gap-3 rounded border border-slate-700 bg-slate-950 p-2">
      <span className="text-sm text-slate-100">{label(item)}</span>
      <Button size="icon" disabled={disabled} aria-label={`Remove ${label(item)} from ignored items`} onClick={()=>onRemove(item)}
        className="size-7 shrink-0 border border-rose-700 bg-black text-rose-200 hover:bg-rose-950 hover:text-white"><X className="size-4"/></Button>
    </div>):<p className="text-sm text-slate-300">No ignored items.</p>}
  </MarketSettingsSection>;
}
