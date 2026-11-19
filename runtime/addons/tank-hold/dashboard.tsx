/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
'use client';
// Tank Hold's line in each card's Farming settings (the `card-section` slot, part `farming-line`):
// the tank, off tank and puller pickers and the Pull switch, then what this character does. The
// picks save to the scope store of the farming scope the card plays in, so every card of one scope
// shows and changes the same picks, and the character hooks read them there (index.ts).
import { Checkbox, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, useState, type AddonDashboard, type AddonPieceProps } from '../../../dashboard/features/party/addon-kit';

const NONE = '';
const named = (value: unknown) => typeof value === 'string' && value ? value : NONE;
const PICKERS = [['tank', 'Tank'], ['offTank', 'Off tank'], ['puller', 'Puller']] as const;

function FarmingLine({ members, report, stores, save }: AddonPieceProps<'card-section'>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const scope = stores.scope, own = (report ?? {}) as { role?: unknown; line?: unknown };
  const write = (patch: Record<string, unknown>) => {
    setBusy(true); setError('');
    save('scope', patch).catch(failure => setError(String(failure instanceof Error ? failure.message : failure))).finally(() => setBusy(false));
  };
  // A card with no farming scope has no scope store to save to; its line stays read only.
  const disabled = busy || !scope;
  const choices = (key: string) => [NONE, ...members].map(value => ({ value,
    label: value || (key === 'puller' ? 'The tank' : 'None') }));
  return (
    <div data-addon="tank-hold" className="mb-2 font-mono text-[10px] text-emerald-100">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 uppercase">
        {PICKERS.map(([key, label]) => {
          const items = choices(key);
          return <label key={key} className="flex items-center gap-1"><span className="text-emerald-100/65">{label}</span>
            <Select items={items} value={named(scope?.[key])} disabled={disabled} onValueChange={(value: unknown) => write({ [key]: named(value) || null })}>
              <SelectTrigger aria-label={`Tank Hold ${label}`} className="h-6 min-w-20 border-emerald-800 bg-[#07100f] px-1 text-[10px] text-emerald-50"><SelectValue /></SelectTrigger>
              <SelectContent className="border border-emerald-800 bg-[#07100f] text-emerald-50">
                {items.map(item => <SelectItem key={item.value || 'none'} value={item.value}
                  className="text-emerald-50 data-highlighted:bg-emerald-900 data-highlighted:text-white">{item.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>;
        })}
        <label className="flex items-center gap-1"><span className="text-emerald-100/65">Pull</span>
          <Checkbox aria-label="Tank Hold Pull" checked={scope?.pull === true} disabled={disabled} onCheckedChange={(on: boolean) => write({ pull: !!on })} />
        </label>
      </div>
      {error ? <p className="mt-1 text-rose-300">{error}</p> : null}
      {typeof own.role === 'string' && own.role ? <p className="mt-1 text-cyan-100">{own.role}{typeof own.line === 'string' && own.line ? ` · ${own.line}` : ''}</p> : null}
    </div>
  );
}

export const dashboard: AddonDashboard = { pieces: { 'card-section': { 'farming-line': FarmingLine } } };
