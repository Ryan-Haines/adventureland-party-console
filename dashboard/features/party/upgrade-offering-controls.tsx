'use client';
import { createContext, useContext, useState, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ItemSprite } from './item-sprite';
import { itemMaximumLevel } from './item-maximum-level';
import type { Item } from './item';
import type { ItemMeta } from './item-meta';
import type { MerchantCatalogItem } from './merchant-catalog-item';
import { upgradeOfferings, offeringOverlap, type UpgradeOffering, type UpgradeOfferingRule } from '../../../runtime/upgrade-offerings';

export type OfferingSource = {slot:number | string; equipped?:boolean};
type Selection = {item:Item; meta?:ItemMeta | null; source?:OfferingSource; offering?:UpgradeOffering; rule?:UpgradeOfferingRule};
interface Controls {
  stock:Partial<Record<UpgradeOffering,number>>;
  rules:UpgradeOfferingRule[];
  catalog:MerchantCatalogItem[];
  select:(selection:Selection) => void;
  remove:(rule:UpgradeOfferingRule) => Promise<void>;
}
const Context = createContext<Controls | null>(null);
export const useUpgradeOfferings = () => useContext(Context);
const secondary = 'border-slate-600 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white';
const control = 'rounded border border-slate-600 bg-slate-900 p-2 text-slate-100 disabled:text-slate-500';

export function UpgradeOfferingProvider({children, character, stock, rules, catalog, post}: {
  children:ReactNode; character:string; stock:Controls['stock']; rules:UpgradeOfferingRule[];
  catalog:MerchantCatalogItem[]; post:(path:"/command", body:Record<string,unknown>) => Promise<unknown>;
}) {
  const [selection, select] = useState<Selection | null>(null);
  const [error, setError] = useState('');
  const save = (body:Record<string,unknown>) => post('/command', {character, ...body});
  return <Context.Provider value={{stock, rules, catalog, select, remove:async rule => {
    try { await save({type:'upgrade-offering-rule', rule:{id:rule.id}, remove:true}); setError(''); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not remove rule'); }
  }}}>
    {children}
    {error && <p role="alert" className="text-sm text-rose-300">{error}</p>}
    {selection && <OfferingDialog selection={selection} rules={rules} stock={stock} catalog={catalog}
      close={() => select(null)} save={save} />}
  </Context.Provider>;
}

function OfferingIcon({name, catalog}: {name:string; catalog:MerchantCatalogItem[]}) {
  const item = catalog.find(entry => entry.id === name);
  return <span className="relative inline-block h-8 w-8 shrink-0 overflow-hidden rounded border border-slate-600 bg-black" aria-label={item?.name || name}>
    {item?.sprite && <ItemSprite sprite={item.sprite} />}
  </span>;
}

function OfferingDialog({selection, rules, stock, catalog, close, save}: {
  selection:Selection; rules:UpgradeOfferingRule[]; stock:Controls['stock']; catalog:MerchantCatalogItem[];
  close:() => void; save:(body:Record<string,unknown>) => Promise<unknown>;
}) {
  const manual = !!selection.source, level = Number(selection.item.level || 0);
  const meta = selection.meta || catalog.find(item => item.id === selection.item.name)?.meta;
  const max = itemMaximumLevel(meta);
  const [rule, setRule] = useState<UpgradeOfferingRule>(selection.rule || {
    id:'', name:selection.item.name, floor:level, ceiling:Math.min(level+1,max),
    offering:selection.offering || 'offeringp', required:true,
  });
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const overlap = !manual && offeringOverlap(rules,rule);
  const invalid = overlap ? `There is already a rule that covers +${overlap.floor} to +${overlap.ceiling}.`
    : !manual && (rule.floor >= rule.ceiling || rule.ceiling > max) ? 'Choose a higher destination level.'
    : manual && !stock[rule.offering] ? 'This offering is no longer available.' : '';
  const name = catalog.find(entry => entry.id === selection.item.name)?.name || selection.item.name;
  async function confirm() {
    if (busy || invalid) return;
    setBusy(true); setError('');
    try {
      await save(manual ? {type:'upgrade-mark', item:selection.item, ...selection.source, tiers:1, offering:rule.offering}
        : {type:'upgrade-offering-rule', rule});
      close();
    } catch(e) { setError(e instanceof Error ? e.message : 'Could not save upgrade'); }
    finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={open => {if (!open && !busy) close();}}>
    <DialogContent className="border-slate-600 bg-slate-950 text-slate-100">
      <DialogHeader><DialogTitle>{manual ? 'Confirm upgrade' : selection.rule ? 'Edit upgrade rule' : 'Add upgrade rule'}</DialogTitle>
        <DialogDescription className="text-slate-300">{manual
          ? `Use ${upgradeOfferings[rule.offering]} to upgrade ${name} from +${level} to +${level+1}?`
          : 'Use an offering during automatic upgrades within this level range.'}</DialogDescription>
      </DialogHeader>
      <div className="flex items-center gap-3"><OfferingIcon name={selection.item.name} catalog={catalog}/><span>{name}</span></div>
      {manual ? <div className="flex items-center gap-3"><OfferingIcon name={rule.offering} catalog={catalog}/>{upgradeOfferings[rule.offering]}</div>
        : <><div className="flex flex-wrap items-center gap-2 text-sm">When upgrading from
          <select aria-label="Starting level" className={control} disabled={busy} value={rule.floor} onChange={e => setRule({...rule,floor:Number(e.target.value)})}>
            {Array.from({length:max},(_,n) => <option key={n} value={n}>+{n}</option>)}
          </select> to
          <select aria-label="Ending level" className={control} disabled={busy} value={rule.ceiling} onChange={e => setRule({...rule,ceiling:Number(e.target.value)})}>
            {Array.from({length:max},(_,n) => n+1).map(n => <option disabled={n <= rule.floor} key={n} value={n}>+{n}</option>)}
          </select> use
          <select aria-label="Upgrade offering" className={control} disabled={busy} value={rule.offering} onChange={e => setRule({...rule,offering:e.target.value as UpgradeOffering})}>
            {Object.entries(upgradeOfferings).map(([id,label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </div><fieldset className="space-y-2 text-sm" disabled={busy}><legend className="sr-only">Offering availability</legend>
          <label className="flex items-center gap-2"><input type="radio" name="offering-mode" checked={rule.required} onChange={() => setRule({...rule,required:true})}/>Required to attempt upgrade</label>
          <label className="flex items-center gap-2"><input type="radio" name="offering-mode" checked={!rule.required} onChange={() => setRule({...rule,required:false})}/>Only if item is available</label>
        </fieldset></>}
      {(invalid || error) && <p role="alert" className="text-sm text-rose-300">{invalid || error}</p>}
      <DialogFooter><Button variant="outline" className={secondary} disabled={busy} onClick={close}>Cancel</Button>
        <Button className="border border-sky-400 bg-sky-700 text-white hover:bg-sky-600 disabled:bg-slate-800 disabled:text-slate-400" disabled={busy || !!invalid} onClick={() => void confirm()}>{busy ? 'Saving…' : 'Confirm'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export function UpgradeOfferingRules() {
  const controls = useUpgradeOfferings();
  const [open,setOpen] = useState(false);
  if (!controls) return null;
  return <section className="mt-2 rounded border border-slate-700 bg-slate-950 p-2">
    <Button variant="outline" className={secondary} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show'} upgrade rules ({controls.rules.length})</Button>
    {open && <div className="mt-2 space-y-2">{!controls.rules.length && <p className="p-2 text-sm text-slate-400">No upgrade rules.</p>}
      {controls.rules.map(rule => <div key={rule.id} className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-slate-900 p-2 text-sm text-slate-100">
        <OfferingIcon name={rule.name} catalog={controls.catalog}/><span>{controls.catalog.find(item => item.id === rule.name)?.name || rule.name}</span>
        <span>+{rule.floor} → +{rule.ceiling}</span><OfferingIcon name={rule.offering} catalog={controls.catalog}/><span>{upgradeOfferings[rule.offering]}</span>
        <span className="text-sky-200">{rule.required ? 'Required' : 'When available'}</span>
        <Button variant="outline" className={secondary} onClick={() => controls.select({item:{name:rule.name},rule})}>Edit</Button>
        <Button variant="outline" className={secondary} onClick={() => void controls.remove(rule)}>Remove</Button>
      </div>)}
    </div>}
  </section>;
}
