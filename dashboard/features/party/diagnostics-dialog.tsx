'use client';
// The one diagnostics view: a tab per diagnostics ring and per enabled add-on's own ring (the
// `diagnostics-ring` slot). Each tab reads its ring from the diagnostics lease while
// the view shows it, and the movement tab also lists the movement owner's snapshots saved on disk. It opens from the
// address: #diagnostics/<ring> shows a ring, and #diagnostics/movement/<id> one movement record. It
// is a debug surface, not part of the character card; the header's record icon opens it.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQueryClient } from '@tanstack/react-query';
import { read as readSection, reportPeriod } from './query-cache';
import { TABLE_G, type LeasedRing, type RecordSaved } from '../../../runtime/status/api.ts';
import { addonRing, useAddonSlots } from '../../../runtime/hooks/dashboard/slots';

type Ring = typeof TABLE_G[number]['ring'];
const RING_LABELS: Record<Ring, string> = { movement: 'Movement', turns: 'Turns', targeting: 'Targeting', survival: 'Survival', calls: 'Call budget',
  merchant: 'Merchant', combat: 'Combat trace' };
interface LeadUp { seq: number; at: number; decision: string; kind?: string; owner?: string; tier?: string; code?: string; cause?: string; by?: { kind?: string; owner?: string; site?: string } }
interface MovementIncident {
  id: string; kind: 'stuck' | 'caught-error'; character: string; owner?: string; activity?: string;
  rung?: string; trying?: string; noProgressMs?: number; position?: { map?: string; x?: number; y?: number };
  blocked?: { code?: string; kind?: string; owner?: string; by?: { kind?: string; owner?: string } }; error?: string; leadUp: LeadUp[];
}
interface SnapshotSummary { id: string; trigger: string; at: number; incident?: string; incidents?: MovementIncident[]; records: number }
type LiveRing = { at: number; records: unknown; incidents?: MovementIncident[] } | null;
interface RecordsReply { live: Partial<Record<LeasedRing, LiveRing>>; snapshots: SnapshotSummary[] }

const prefix = '#diagnostics';
// An add-on's ring is `<add-on>.<key>`; the view knows its label once the add-on list loads.
const isLeasedRing = (ring: string): ring is LeasedRing => TABLE_G.some(row => row.ring === ring) || ring.includes('.');
function readHash(): { open: boolean; ring: LeasedRing; id: string | null } {
  if (typeof window === 'undefined' || !window.location.hash.startsWith(prefix)) return { open: false, ring: 'movement', id: null };
  const [ring, id] = window.location.hash.slice(prefix.length + 1).split('/');
  const known: LeasedRing = isLeasedRing(ring) ? ring : 'movement';
  return { open: true, ring: known, id: known === 'movement' && id ? decodeURIComponent(id) : null };
}
const diagnosticsLink = (ring: string) => prefix + '/' + ring;

// The record icon shows while a ring saved a record after the view last opened in this browser.
const readKey = 'party-ui:diagnostics-read';
export function useRecordIcon(saved: RecordSaved | null | undefined) {
  const [readAt, setReadAt] = useState(() => {
    try { return Number(localStorage.getItem(readKey)) || 0; } catch { return 0; }
  });
  const markRead = useCallback(() => {
    const now = Date.now();
    setReadAt(now);
    try { localStorage.setItem(readKey, String(now)); } catch { /* storage blocked */ }
  }, []);
  return { unread: !!saved && saved.at > readAt, markRead };
}
// A ring's name: an add-on ring's own label, then table G's, then the ring id.
function useRingLabel(ring: string) {
  return useAddonSlots().rings.find(entry => entry.ring === ring)?.label ?? RING_LABELS[ring as Ring] ?? ring;
}
export function RecordIcon({ saved }: { saved: RecordSaved }) {
  const label = useRingLabel(saved.ring).toLowerCase();
  return <a href={diagnosticsLink(saved.ring)} aria-label={`New ${label} record for ${saved.character}`}
    title={`${saved.character} saved a ${label} record at ${new Date(saved.at).toLocaleTimeString()}`}
    className="inline-flex items-center rounded border border-amber-500 bg-amber-950 px-2 text-amber-200 hover:bg-amber-900">
    <FileWarning className="size-4" />
  </a>;
}
const link = (id: string) => diagnosticsLink('movement') + '/' + encodeURIComponent(id);
const seconds = (ms?: number) => typeof ms === 'number' ? `${Math.round(ms / 1000)} s without progress` : null;

export function DiagnosticsDialog({ characters, onRead }: { characters: string[]; onRead: () => void }) {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const update = () => setRoute(readHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const [replies, setReplies] = useState<Record<string, RecordsReply>>({});
  // The last failed read per character, shown in place of its records until a later read answers.
  const [failures, setFailures] = useState<Record<string, string>>({});
  const client = useQueryClient();
  const addonRings = useAddonSlots().rings, addon = addonRings.find(entry => entry.ring === route.ring);
  const label = useRingLabel(route.ring);
  // The roster as one string, so a new array with the same names keeps the reads running.
  const roster = [...characters].sort().join(',');
  const names = useMemo(() => roster ? roster.split(',') : [], [roster]);
  // Opening the view reads every save so far, which turns the record icon off.
  useEffect(() => { if (route.open) onRead(); }, [route.open, onRead]);
  useEffect(() => {
    if (!route.open || !names.length) return;
    let stopped = false;
    // Each read renews that character's lease on the shown ring, so its records keep arriving while
    // the tab shows. A lease lasts two report periods, so one read per report keeps it.
    const read = async () => {
      const next: Record<string, RecordsReply> = {}, failed: Record<string, string> = {};
      for (const name of names) {
        try {
          next[name] = await readSection<RecordsReply>(client, `/diagnostics/records?character=${encodeURIComponent(name)}&rings=${route.ring}`);
        } catch (error) { failed[name] = error instanceof Error ? error.message : String(error); }
      }
      if (!stopped) { setReplies(next); setFailures(failed); }
    };
    void read();
    const timer = window.setInterval(read, reportPeriod);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [route.open, route.ring, names, client]);
  // A ring read that threw on the character arrives as a `read-failed` incident with no id or lead-up
  // (runtime/status/character/rings.ts `reply`); the view lists it as that character's failed read.
  const readFailed = (incident: unknown): incident is { kind: 'read-failed'; error?: string } =>
    (incident as { kind?: string } | null)?.kind === 'read-failed';
  const records = useMemo(() => {
    const seen = new Map<string, MovementIncident>();
    for (const reply of Object.values(replies)) {
      for (const incident of reply.live?.movement?.incidents ?? []) if (!readFailed(incident)) seen.set(incident.id, incident);
      for (const snapshot of reply.snapshots ?? []) for (const incident of snapshot.incidents ?? []) if (!readFailed(incident) && !seen.has(incident.id)) seen.set(incident.id, incident);
    }
    return [...seen.values()].sort((a, b) => (b.leadUp.at(-1)?.at ?? 0) - (a.leadUp.at(-1)?.at ?? 0));
  }, [replies]);
  const ringFailures = Object.entries(replies).flatMap(([name, reply]) =>
    ((reply.live?.[route.ring]?.incidents ?? []) as unknown[]).filter(readFailed).map(incident => ({ name, error: String(incident.error ?? '') })));
  const shown = route.id ? records.filter(record => record.id === route.id) : records;
  const close = () => { history.replaceState(null, '', window.location.pathname + window.location.search); setRoute({ open: false, ring: 'movement', id: null }); };
  const ringPosts = Object.entries(replies).flatMap(([name, reply]) => reply.live?.[route.ring] ? [{ name, post: reply.live[route.ring]! }] : []);
  return (
    <Dialog open={route.open} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent data-area="diagnostics" className="max-h-[85vh] overflow-y-auto border border-slate-700 bg-slate-950 text-slate-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Diagnostics</DialogTitle>
          <DialogDescription className="text-slate-300">
            Each ring stays on its character and travels only while its tab shows here. Movement lists stuck and caught-error records with what led up to them, and the snapshots saved after a death, a stuck moment or a failed walk.
          </DialogDescription>
        </DialogHeader>
        {Object.entries(failures).map(([name, message]) => <p key={name} role="alert" className="text-sm text-rose-300">{name}: the {label.toLowerCase()} records could not be read ({message}).</p>)}
        {ringFailures.map(({ name, error }) => <p key={'ring-' + name} role="alert" className="text-sm text-rose-300">{name}: the character could not read its {label.toLowerCase()} ring ({error}).</p>)}
        <nav role="tablist" aria-label="Rings" data-addon-slot="diagnostics-ring" className="flex flex-wrap gap-2">
          {[...TABLE_G.map(row => ({ ring: row.ring as LeasedRing, label: RING_LABELS[row.ring] })), ...addonRings].map(tab => <a key={tab.ring} role="tab"
            aria-selected={route.ring === tab.ring} href={diagnosticsLink(tab.ring)}
            className={'rounded border px-2 py-1 text-sm ' + (route.ring === tab.ring ? 'border-cyan-300 bg-cyan-950' : 'border-slate-600 bg-slate-950')}>{tab.label}</a>)}
        </nav>
        {route.ring !== 'movement' ? (
          ringPosts.length ? ringPosts.map(({ name, post }) => (
            <article key={name} aria-label={name} className="rounded border border-slate-700 bg-black/40 p-3 text-sm">
              <header className="font-semibold">{name} <span className="font-normal text-slate-400">{new Date(post.at).toLocaleTimeString()}</span></header>
              {(addon && addonRing(addon, post.records)) ?? <pre className="mt-2 max-h-96 overflow-auto font-mono text-xs text-slate-200">{JSON.stringify(post.records, null, 1)}</pre>}
            </article>
          )) : Object.keys(failures).length ? null : <p className="text-sm text-slate-300">No {label.toLowerCase()} records yet; each character posts its ring after its next report.</p>
        ) : <>
        {route.id ? <a className="text-sm text-cyan-300 underline" href={diagnosticsLink('movement')}>All records</a> : null}
        {!shown.length ? <p className="text-sm text-slate-300">{route.id ? `No record ${route.id}.` : 'No stuck or caught-error records.'}</p> : null}
        <div className="space-y-4">
          {shown.map(record => (
            <article key={record.id} aria-label={record.id} className="rounded border border-slate-700 bg-black/40 p-3 text-sm">
              <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className={record.kind === 'stuck' ? 'font-semibold text-amber-300' : 'font-semibold text-red-300'}>{record.kind === 'stuck' ? 'Stuck' : 'Caught error'}</span>
                <span className="font-semibold">{record.character}</span>
                <a className="font-mono text-xs text-cyan-300 underline" href={link(record.id)}>{record.id}</a>
              </header>
              <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-slate-200">
                {record.activity ? <><dt className="text-slate-400">Activity</dt><dd>{record.activity}</dd></> : null}
                {record.rung ? <><dt className="text-slate-400">Rung</dt><dd>{record.rung}{record.trying ? ` - ${record.trying}` : ''}</dd></> : null}
                {seconds(record.noProgressMs) ? <><dt className="text-slate-400">Progress</dt><dd>{seconds(record.noProgressMs)}</dd></> : null}
                {record.position ? <><dt className="text-slate-400">Where</dt><dd>{record.position.map} [{Math.round(Number(record.position.x))}, {Math.round(Number(record.position.y))}]</dd></> : null}
                {record.blocked ? <><dt className="text-slate-400">Blocked by</dt><dd>{record.blocked.code}{record.blocked.by?.kind ? ` from ${record.blocked.by.kind}${record.blocked.by.owner ? ' ' + record.blocked.by.owner : ''}` : ''}</dd></> : null}
                {record.error ? <><dt className="text-slate-400">Error</dt><dd className="text-red-200">{record.error}</dd></> : null}
              </dl>
              <details className="mt-2" open={!!route.id}>
                <summary className="cursor-pointer text-slate-300">Lead-up ({record.leadUp.length} records)</summary>
                <table className="mt-1 w-full font-mono text-xs">
                  <thead className="text-left text-slate-400"><tr><th>seq</th><th>decision</th><th>kind</th><th>owner</th><th>code</th><th>by</th></tr></thead>
                  <tbody>
                    {record.leadUp.map(entry => (
                      <tr key={entry.seq} className="border-t border-slate-800">
                        <td>{entry.seq}</td><td>{entry.decision}</td><td>{entry.kind ?? ''}</td><td>{entry.owner ?? ''}</td>
                        <td>{entry.code ?? entry.cause ?? ''}</td><td>{entry.by ? [entry.by.kind, entry.by.owner ?? entry.by.site].filter(Boolean).join(' ') : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </article>
          ))}
        </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}
