/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
'use client';
// The Cosmetics panel under Equipped on a character's card. It draws the character's
// `addonReports.cosmetics` (report.ts) through panel.ts. A worn look's chip takes it off, an owned
// look's chip puts it on and an emote's chip plays it, each through `send` (commands.ts); the line
// under the lists names the newest press and how it settled.
import { useState, type AddonDashboard, type AddonPieceProps } from '../../../dashboard/features/party/addon-kit';
import { lastKey, type CosmeticsCommand } from './commands';
import { lastLine, panelRows } from './panel';

interface Chip { key: string; label: string; strong?: boolean; title?: string; press?: CosmeticsCommand }

function Chips({ title, items, onPress }: { title: string; items: Chip[]; onPress(body: CosmeticsCommand): void }) {
  return (
    <div className="grid gap-1">
      <div className="text-[11px] uppercase tracking-wide text-emerald-300/70">{title}</div>
      {items.length ? (
        <div className="flex flex-wrap gap-1">
          {items.map(i => {
            const look = `rounded border px-1.5 py-0.5 text-xs ${i.strong ? 'border-emerald-500 text-emerald-100' : 'border-emerald-900 text-emerald-300'}`;
            const press = i.press;
            return press
              ? <button key={i.key} type="button" title={i.title} className={`${look} hover:bg-emerald-900/40`} onClick={() => onPress(press)}>{i.label}</button>
              : <span key={i.key} title={i.title} className={look}>{i.label}</span>;
          })}
        </div>
      ) : <div className="text-xs text-emerald-300/50">None</div>}
    </div>
  );
}

function CosmeticsPanel({ character, report, stores, send }: AddonPieceProps<'card-section'>) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = panelRows(report);
  const last = lastLine(stores.party[lastKey(character)]);
  const press = (body: CosmeticsCommand) => {
    setError(null);
    send(body).then(reply => {
      const r = reply as { ok?: boolean; error?: string } | undefined;
      if (r && r.ok === false) setError(r.error ?? 'the console refused the press');
    }, (e: unknown) => setError(String(e instanceof Error ? e.message : e)));
  };
  return (
    <div className="mt-4 border-t border-emerald-900/70 pt-2">
      <button type="button" className="text-sm font-semibold text-emerald-200" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        Cosmetics
      </button>
      {open && (rows ? (
        <div className="mt-2 grid gap-2">
          <Chips title="Wearing" onPress={press} items={rows.worn.map(w => ({ key: w.slot, label: `${w.slot}: ${w.look}`, strong: true,
            title: `Take off ${w.look}`, press: { takeOff: { slot: w.slot } } }))} />
          <Chips title="Owned" onPress={press} items={rows.owned.map(o => ({ key: o.name, label: o.label, strong: o.worn,
            title: o.slot ? `Put on ${o.name}` : undefined, press: o.slot ? { wear: { slot: o.slot, name: o.name } } : undefined }))} />
          <Chips title="CX jars" onPress={press} items={rows.jars.map(j => ({ key: String(j.cell), label: j.label }))} />
          <Chips title="Emotes" onPress={press} items={rows.emotes.map(e => ({ key: e.skill, label: e.label,
            title: e.playable ? `Play ${e.label}` : undefined, press: e.playable ? { emote: e.skill } : undefined }))} />
          {error ? <div className="text-xs text-rose-300">{error}</div> : last ? <div className="text-xs text-emerald-300/70">{last}</div> : null}
        </div>
      ) : <div className="mt-2 text-xs text-emerald-300/50">No cosmetics report yet</div>)}
    </div>
  );
}

export const dashboard: AddonDashboard = { pieces: { 'card-section': { equipped: CosmeticsPanel } } };
