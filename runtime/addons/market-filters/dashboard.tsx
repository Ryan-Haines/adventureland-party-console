/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
'use client';
// One filter bar per Market tab, drawn at the end of the tab's filter row. Every tab already has
// the Market's own search box for item, seller and server names, so the bar adds no second search
// and holds only the level, price, server and tier bounds and the Newest first order.
import {
  Button, Input, useState,
  type AddonDashboard, type AddonListViewPiece, type AddonPieceProps,
} from '../../../dashboard/features/party/addon-kit';
import {
  GRADE_NAMES, grades, keep, normalize, order, parseLevel, parsePrice, servers, type MarketFilter, type MarketRow,
} from './filters';

// One control serves all four tabs, so it takes any tab's part and reads only the row fields
// filters.ts names.
type BarProps = Omit<AddonPieceProps<'list-view'>, 'part' | 'rows'> & { part: string; rows: readonly MarketRow[] };

interface Drafts { minLevel: string; maxLevel: string; minPrice: string; maxPrice: string; server: string; grade: string; newest: boolean }
const EMPTY: Drafts = { minLevel: '', maxLevel: '', minPrice: '', maxPrice: '', server: '', grade: '', newest: false };

// The boxes for a value the slot already holds: the slot keeps each tab's value while the Market
// sheet stays open, and the bar draws fresh each time the player comes back to the tab.
const draftsOf = (value: unknown): Drafts => {
  const held = normalize(value as MarketFilter | undefined) ?? {};
  const text = (entry: number | undefined) => (entry === undefined ? '' : String(entry));
  return { minLevel: text(held.minLevel), maxLevel: text(held.maxLevel), minPrice: text(held.minPrice), maxPrice: text(held.maxPrice),
    server: held.server ?? '', grade: text(held.grade), newest: held.newest ?? false };
};

const valueOf = (drafts: Drafts): MarketFilter | undefined => normalize({
  minLevel: parseLevel(drafts.minLevel), maxLevel: parseLevel(drafts.maxLevel),
  minPrice: parsePrice(drafts.minPrice), maxPrice: parsePrice(drafts.maxPrice),
  server: drafts.server || undefined,
  grade: drafts.grade === '' ? undefined : Number(drafts.grade),
  newest: drafts.newest,
});

const box = 'h-9 border-cyan-800 bg-black text-emerald-50';

export function MarketFilterBar({ part, rows, value, set }: BarProps) {
  // The bar keeps what the player typed, so a half-typed "1." stays in the box while the slot
  // holds the parsed bound.
  const [drafts, setDrafts] = useState<Drafts>(() => draftsOf(value));
  const change = (field: keyof Drafts, text: string | boolean) => {
    const next = { ...drafts, [field]: text };
    setDrafts(next);
    set(valueOf(next));
  };
  const realms = servers(rows);
  const tiers = grades(rows);
  const field = (name: 'minLevel' | 'maxLevel' | 'minPrice' | 'maxPrice', label: string, width: string, placeholder: string) => (
    <Input aria-label={label} title={label} value={drafts[name]} placeholder={placeholder} inputMode="decimal"
      onChange={(event) => change(name, event.target.value)} className={`${box} ${width}`} />
  );
  return (
    <div data-addon="market-filters" data-part={part} className="flex flex-wrap items-center gap-2 rounded border border-slate-700 bg-black px-2 py-1 text-sm text-slate-200">
      <span className="text-slate-400">Level</span>
      {field('minLevel', 'Lowest level', 'w-14', 'min')}
      {field('maxLevel', 'Highest level', 'w-14', 'max')}
      <span className="text-slate-400">Price</span>
      {field('minPrice', 'Lowest price, such as 250k or 1.5m', 'w-24', 'min')}
      {field('maxPrice', 'Highest price, such as 250k or 1.5m', 'w-24', 'max')}
      {realms.length ? (
        <select aria-label="Server" value={drafts.server} onChange={(event) => change('server', event.target.value)}
          className="h-9 rounded border border-cyan-800 bg-black px-2 text-emerald-50">
          <option value="">Any server</option>
          {realms.map((realm) => <option key={realm} value={realm}>{realm}</option>)}
        </select>
      ) : null}
      {tiers.length ? (
        <select aria-label="Tier" value={drafts.grade} onChange={(event) => change('grade', event.target.value)}
          className="h-9 rounded border border-cyan-800 bg-black px-2 text-emerald-50">
          <option value="">Any tier</option>
          {tiers.map((grade) => <option key={grade} value={String(grade)}>{GRADE_NAMES[grade] ?? `Grade ${grade}`}</option>)}
        </select>
      ) : null}
      <Button size="sm" variant="outline" aria-pressed={drafts.newest} onClick={() => change('newest', !drafts.newest)}
        className={drafts.newest ? 'border-cyan-500 bg-cyan-950 text-emerald-50' : 'border-slate-600 bg-black text-slate-200 hover:bg-slate-900'}>
        Newest first
      </Button>
      {value !== undefined ? (
        <Button size="sm" variant="outline" onClick={() => { setDrafts(EMPTY); set(undefined); }}
          className="border-slate-600 bg-black text-slate-200 hover:bg-slate-900">Clear</Button>
      ) : null}
    </div>
  );
}

const bar = { control: MarketFilterBar, keep, order };

export const dashboard: AddonDashboard = {
  pieces: {
    'list-view': {
      'market:wts': bar satisfies AddonListViewPiece<'market:wts'>,
      'market:wtb': bar satisfies AddonListViewPiece<'market:wtb'>,
      'market:classifieds': bar satisfies AddonListViewPiece<'market:classifieds'>,
      'market:ponty': bar satisfies AddonListViewPiece<'market:ponty'>,
    },
  },
};
