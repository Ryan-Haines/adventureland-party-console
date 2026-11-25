'use client';
// The one diagnostics view and the header's Diagnostics button.
// - The alerts are the errors only: every saved snapshot, each a death, a stuck moment, a caught
//   error, a refusal, a failed walk or task, churn, a fallback to a safe point or a call-limit
//   disconnect (runtime/status/coordinator/diagnostics.ts `alerts`). Only they count toward the button's
//   badge, show as unread or appear in the list.
// - Opening the view marks nothing read. Each alert has "Mark as read" and the view has "Mark all
//   as read"; the read marks are this browser's (`party-ui:diagnostics-read-alerts`).
// - Routine records show only inside an alert's report, as its lead-up. "Show all records", off
//   when the view opens, shows each ring's whole live log: a tab per diagnostics ring and per enabled
//   add-on's own ring (the `diagnostics-ring` slot), each read through the diagnostics lease while it
//   shows.
// The view opens from the address: #diagnostics shows the alerts, #diagnostics/record/<id> one
// alert, and #diagnostics/<ring> that ring's whole log.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useStoredJson } from '@/hooks/use-stored-boolean';
import { polls, read as readSection, reportPeriod } from './query-cache';
import { TABLE_G, type DiagnosticsAlert, type LeasedRing } from '../../../runtime/status/api.ts';
import { addonRing, useAddonSlots } from '../../../runtime/hooks/dashboard/slots';

type Ring = typeof TABLE_G[number]['ring'];
const RING_LABELS: Record<Ring, string> = { movement: 'Movement', turns: 'Turns', targeting: 'Targeting', survival: 'Survival', calls: 'Call budget',
  merchant: 'Merchant', combat: 'Combat trace' };
// Each snapshot trigger in the player's words (runtime/movement/coordinator/records.ts SNAPSHOT_TRIGGERS).
const ALERT_LABELS: Record<string, string> = { death: 'Death', stuck: 'Stuck', 'caught-error': 'Caught error', churn: 'Churn',
  'walk-failed': 'Walk failed', 'task-failed': 'Task failed', 'safe-point': 'Fell back to a safe point', limitdc: 'Call limit disconnect', refused: 'Refused' };
interface LeadUp { seq?: number; at?: number; part?: string; decision: string; kind?: string; owner?: string; tier?: string; code?: string; cause?: string;
  skill?: string; reason?: string; by?: { kind?: string; owner?: string; site?: string } }
interface Incident {
  id: string; kind: string; character?: string; owner?: string; activity?: string;
  rung?: string; trying?: string; noProgressMs?: number; position?: { map?: string; x?: number; y?: number };
  blocked?: { code?: string; kind?: string; owner?: string; by?: { kind?: string; owner?: string } }; error?: string; leadUp?: LeadUp[];
}
interface Report { id: string; character: string; trigger: string; at: number; records: LeadUp[]; incidents: Incident[] }
type LiveRing = { at: number; records: unknown; incidents?: unknown[] } | null;
interface RecordsReply { live: Partial<Record<LeasedRing, LiveRing>> }

const prefix = '#diagnostics';
// An add-on's ring is `<add-on>.<key>`; the view knows its label once the add-on list loads.
const isLeasedRing = (ring: string): ring is LeasedRing => TABLE_G.some(row => row.ring === ring) || ring.includes('.');
type Route = { open: boolean; ring: LeasedRing | null; id: string | null };
function readHash(): Route {
  if (typeof window === 'undefined' || !window.location.hash.startsWith(prefix)) return { open: false, ring: null, id: null };
  const [part, ...rest] = window.location.hash.slice(prefix.length + 1).split('/');
  if (part === 'record') return { open: true, ring: null, id: rest.length ? decodeURIComponent(rest.join('/')) : null };
  // The movement tab was the alerts list before the alerts covered every ring, so its address
  // still shows them.
  if (!part || part === 'movement') return { open: true, ring: null, id: null };
  return { open: true, ring: isLeasedRing(part) ? part : null, id: null };
}
const recordLink = (id: string) => prefix + '/record/' + encodeURIComponent(id);
const ringLink = (ring: string) => prefix + '/' + ring;
const seconds = (ms?: number) => typeof ms === 'number' ? `${Math.round(ms / 1000)} s without progress` : null;
const time = (at: number) => new Date(at).toLocaleString();

// The read marks: alert ids, kept only while their alert is still saved. They live under a new
// key because v1.5.0 kept a read time, a number, under `party-ui:diagnostics-read`, and
// `new Set(number)` throws on render in every browser that opened that view.
const NO_MARKS: string[] = [];
const NO_ALERTS: DiagnosticsAlert[] = [];
const readKey = 'party-ui:diagnostics-read-alerts';
/** The alerts and their read marks. The list reloads when a ring saves a record (`savedAt`, the
 * core section's `recordSaved`) and on the config poll, since the group and call snapshots send no
 * save notice. */
export function useDiagnosticsAlerts(savedAt: number | undefined) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['party', 'diagnostics-alerts', savedAt ?? 0],
    queryFn: ({ signal }) => readSection<{ alerts: DiagnosticsAlert[] }>(client, '/diagnostics/alerts', signal),
    refetchInterval: polls.config!.interval, placeholderData: previous => previous });
  const alerts = query.data?.alerts ?? NO_ALERTS;
  const [marks, setMarks] = useStoredJson<string[]>(readKey, NO_MARKS);
  const read = useMemo(() => new Set(marks), [marks]);
  const markRead = useCallback((ids: readonly string[]) => {
    const saved = new Set(alerts.map(alert => alert.id));
    setMarks([...new Set([...marks, ...ids])].filter(id => saved.has(id)));
  }, [alerts, marks, setMarks]);
  const unread = alerts.filter(alert => !read.has(alert.id));
  return { alerts, read, unread, markRead };
}

// The header's Diagnostics button, always there. It is an icon the size of the header's other
// buttons, as v1.5.0's record icon was, so the views row keeps its width; its badge counts the
// unread alerts and sits on the corner, so a count changes no width either.
export function DiagnosticsButton({ unread }: { unread: number }) {
  const tone = unread ? 'border-amber-500 bg-amber-950 text-amber-200 hover:bg-amber-900' : 'border-slate-600 bg-slate-950 text-slate-100 hover:bg-slate-800';
  return <a href={prefix} aria-label={unread ? `Diagnostics, ${unread} unread` : 'Diagnostics'} title={unread ? `Diagnostics: ${unread} unread` : 'Diagnostics'}
    className={buttonVariants({ size: 'icon', className: `relative border ${tone}` })}>
    <FileWarning className="size-4" />
    {unread ? <span data-unread className="absolute -right-2 -top-2 min-w-4 rounded-full border border-amber-500 bg-amber-950 px-1 text-center font-mono text-[10px] leading-4 text-amber-200">{unread}</span> : null}
  </a>;
}

// A ring's name: an add-on ring's own label, then table G's, then the ring id.
function useRingLabel(ring: string) {
  return useAddonSlots().rings.find(entry => entry.ring === ring)?.label ?? RING_LABELS[ring as Ring] ?? ring;
}

export function DiagnosticsDialog({ characters, alerts }: { characters: string[]; alerts: ReturnType<typeof useDiagnosticsAlerts> }) {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const update = () => setRoute(readHash());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  // "Show all records" starts off each time the view opens, unless the address names a ring.
  const [showAll, setShowAll] = useState(false);
  const [shownRoute, setShownRoute] = useState<Route | null>(null);
  if (shownRoute !== route) { setShownRoute(route); if (route.open) setShowAll(route.ring !== null); }
  const close = () => { history.replaceState(null, '', window.location.pathname + window.location.search); setRoute({ open: false, ring: null, id: null }); };
  const shown = route.id ? alerts.alerts.filter(alert => alert.id === route.id) : alerts.alerts;
  return (
    <Dialog open={route.open} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent data-area="diagnostics" className="max-h-[85vh] overflow-y-auto border border-slate-700 bg-slate-950 text-slate-100 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Diagnostics</DialogTitle>
          <DialogDescription className="text-slate-300">
            Deaths, stuck moments, caught errors, refusals, failed walks and tasks, churn, safe-point fallbacks and call-limit disconnects, each with the records that led up to it.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!alerts.unread.length} onClick={() => alerts.markRead(alerts.unread.map(alert => alert.id))}
            className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-sm text-slate-100 hover:bg-slate-800 disabled:opacity-50">Mark all as read</button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-cyan-500" checked={showAll} onChange={event => setShowAll(event.target.checked)} />
            Show all records
          </label>
          <span className="text-sm text-slate-400">{alerts.unread.length} unread of {alerts.alerts.length}</span>
        </div>
        {showAll ? <RingLogs characters={characters} ring={route.ring ?? 'movement'} active={route.open} /> : <>
          {route.id ? <a className="text-sm text-cyan-300 underline" href={prefix}>All records</a> : null}
          {!shown.length ? <p className="text-sm text-slate-300">{route.id ? `No record ${route.id}.` : 'No errors recorded.'}</p> : null}
          <div className="space-y-3">
            {shown.map(alert => <AlertRow key={alert.id} alert={alert} unread={!alerts.read.has(alert.id)} single={!!route.id}
              onRead={() => alerts.markRead([alert.id])} />)}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

// One alert as a readable row: what happened, to whom and when, and its report on demand.
function AlertRow({ alert, unread, single, onRead }: { alert: DiagnosticsAlert; unread: boolean; single: boolean; onRead: () => void }) {
  const [open, setOpen] = useState(single);
  return (
    <article data-area="diagnostics-alert" aria-label={alert.id} data-unread={unread || undefined} className={'rounded border bg-black/40 p-3 text-sm ' + (unread ? 'border-amber-600' : 'border-slate-700')}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        {unread ? <span title="Unread" className="size-2 self-center rounded-full bg-amber-400" /> : null}
        <span className={alert.trigger === 'caught-error' || alert.trigger === 'death' ? 'font-semibold text-red-300' : 'font-semibold text-amber-300'}>{ALERT_LABELS[alert.trigger] ?? alert.trigger}</span>
        <span className="font-semibold">{alert.subject}</span>
        <span className="text-slate-400">{time(alert.at)}</span>
        <a className="font-mono text-xs text-cyan-300 underline" href={recordLink(alert.id)}>{alert.id}</a>
        {unread ? <button type="button" onClick={onRead} className="ml-auto rounded border border-slate-600 bg-slate-950 px-2 py-0.5 text-xs text-slate-100 hover:bg-slate-800">Mark as read</button> : null}
      </header>
      <details className="mt-2" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer text-slate-300">Report</summary>
        {open ? <AlertReport alert={alert} /> : null}
      </details>
    </article>
  );
}

// An alert's report, read when it opens: each record's facts, then the routine records that led up
// to it.
function AlertReport({ alert }: { alert: DiagnosticsAlert }) {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['party', 'diagnostics-alert', alert.id], staleTime: Infinity,
    queryFn: ({ signal }) => readSection<Report>(client, `/diagnostics/alert?subject=${encodeURIComponent(alert.subject)}&id=${encodeURIComponent(alert.id)}`, signal) });
  if (query.error) return <p role="alert" className="mt-1 text-rose-300">The report could not be read ({query.error.message}).</p>;
  if (!query.data) return <p className="mt-1 text-slate-400">Loading...</p>;
  const report = query.data;
  return <div className="mt-2 space-y-3">
    {report.incidents.map(incident => <div key={incident.id} className="space-y-1">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-slate-200">
        <dt className="text-slate-400">Record</dt><dd className="font-mono text-xs">{incident.id}</dd>
        {incident.activity ? <><dt className="text-slate-400">Activity</dt><dd>{incident.activity}</dd></> : null}
        {incident.rung ? <><dt className="text-slate-400">Rung</dt><dd>{incident.rung}{incident.trying ? ` - ${incident.trying}` : ''}</dd></> : null}
        {seconds(incident.noProgressMs) ? <><dt className="text-slate-400">Progress</dt><dd>{seconds(incident.noProgressMs)}</dd></> : null}
        {incident.position ? <><dt className="text-slate-400">Where</dt><dd>{incident.position.map} [{Math.round(Number(incident.position.x))}, {Math.round(Number(incident.position.y))}]</dd></> : null}
        {incident.blocked ? <><dt className="text-slate-400">Blocked by</dt><dd>{incident.blocked.code}{incident.blocked.by?.kind ? ` from ${incident.blocked.by.kind}${incident.blocked.by.owner ? ' ' + incident.blocked.by.owner : ''}` : ''}</dd></> : null}
        {incident.error ? <><dt className="text-slate-400">Error</dt><dd className="text-red-200">{incident.error}</dd></> : null}
      </dl>
      {incident.leadUp?.length ? <RecordTable caption={`Lead-up (${incident.leadUp.length} records)`} records={incident.leadUp} /> : null}
    </div>)}
    {report.records.length ? <RecordTable caption={`Records before it (${report.records.length})`} records={report.records} /> : <p className="text-slate-400">No records before it.</p>}
  </div>;
}

function RecordTable({ caption, records }: { caption: string; records: readonly LeadUp[] }) {
  return <table className="w-full font-mono text-xs">
    <caption className="text-left text-slate-300">{caption}</caption>
    <thead className="text-left text-slate-400"><tr><th>seq</th><th>time</th><th>decision</th><th>kind</th><th>owner</th><th>code</th><th>by</th></tr></thead>
    <tbody>
      {records.map((entry, index) => (
        <tr key={`${entry.seq}-${index}`} className="border-t border-slate-800">
          <td>{entry.seq ?? ''}</td><td>{typeof entry.at === 'number' ? new Date(entry.at).toLocaleTimeString() : ''}</td><td>{entry.part ? entry.part + ' ' : ''}{entry.decision}</td><td>{entry.kind ?? entry.skill ?? ''}</td><td>{entry.owner ?? ''}</td>
          <td>{entry.code ?? entry.cause ?? entry.reason ?? ''}</td><td>{entry.by ? [entry.by.kind, entry.by.owner ?? entry.by.site].filter(Boolean).join(' ') : ''}</td>
        </tr>
      ))}
    </tbody>
  </table>;
}

// "Show all records": each ring's whole live log, read through the diagnostics lease while it shows.
function RingLogs({ characters, ring, active }: { characters: string[]; ring: LeasedRing; active: boolean }) {
  const [replies, setReplies] = useState<Record<string, RecordsReply>>({});
  // The last failed read per character, shown in place of its records until a later read answers.
  const [failures, setFailures] = useState<Record<string, string>>({});
  const client = useQueryClient();
  const addonRings = useAddonSlots().rings, addon = addonRings.find(entry => entry.ring === ring);
  const label = useRingLabel(ring);
  // The roster as one string, so a new array with the same names keeps the reads running.
  const roster = [...characters].sort().join(',');
  const names = useMemo(() => roster ? roster.split(',') : [], [roster]);
  useEffect(() => {
    if (!active || !names.length) return;
    let stopped = false;
    // Each read renews that character's lease on the shown ring, so its records keep arriving while
    // the tab shows. A lease lasts two report periods, so one read per report keeps it.
    const read = async () => {
      const next: Record<string, RecordsReply> = {}, failed: Record<string, string> = {};
      for (const name of names) {
        try {
          next[name] = await readSection<RecordsReply>(client, `/diagnostics/records?character=${encodeURIComponent(name)}&rings=${ring}`);
        } catch (error) { failed[name] = error instanceof Error ? error.message : String(error); }
      }
      if (!stopped) { setReplies(next); setFailures(failed); }
    };
    void read();
    const timer = window.setInterval(read, reportPeriod);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [active, ring, names, client]);
  // A ring read that threw on the character arrives as a `read-failed` incident with no id or lead-up
  // (runtime/status/character/rings.ts `reply`); the view lists it as that character's failed read.
  const readFailed = (incident: unknown): incident is { kind: 'read-failed'; error?: string } =>
    (incident as { kind?: string } | null)?.kind === 'read-failed';
  const ringFailures = Object.entries(replies).flatMap(([name, reply]) =>
    (reply.live?.[ring]?.incidents ?? []).filter(readFailed).map(incident => ({ name, error: String(incident.error ?? '') })));
  const posts = Object.entries(replies).flatMap(([name, reply]) => reply.live?.[ring] ? [{ name, post: reply.live[ring]! }] : []);
  return <section data-area="diagnostics-rings" className="space-y-3">
    {Object.entries(failures).map(([name, message]) => <p key={name} role="alert" className="text-sm text-rose-300">{name}: the {label.toLowerCase()} records could not be read ({message}).</p>)}
    {ringFailures.map(({ name, error }) => <p key={'ring-' + name} role="alert" className="text-sm text-rose-300">{name}: the character could not read its {label.toLowerCase()} ring ({error}).</p>)}
    <nav role="tablist" aria-label="Rings" data-addon-slot="diagnostics-ring" className="flex flex-wrap gap-2">
      {[...TABLE_G.map(row => ({ ring: row.ring as LeasedRing, label: RING_LABELS[row.ring] })), ...addonRings].map(tab => <a key={tab.ring} role="tab"
        aria-selected={ring === tab.ring} href={ringLink(tab.ring)}
        className={'rounded border px-2 py-1 text-sm ' + (ring === tab.ring ? 'border-cyan-300 bg-cyan-950' : 'border-slate-600 bg-slate-950')}>{tab.label}</a>)}
    </nav>
    {posts.length ? posts.map(({ name, post }) => (
      <article key={name} aria-label={name} className="rounded border border-slate-700 bg-black/40 p-3 text-sm">
        <header className="font-semibold">{name} <span className="font-normal text-slate-400">{new Date(post.at).toLocaleTimeString()}</span></header>
        {(addon && addonRing(addon, post.records)) ?? (Array.isArray(post.records)
          ? <RecordTable caption={`${label} records (${post.records.length})`} records={post.records as LeadUp[]} />
          : <pre className="mt-2 max-h-96 overflow-auto font-mono text-xs text-slate-200">{JSON.stringify(post.records, null, 1)}</pre>)}
      </article>
    )) : Object.keys(failures).length ? null : <p className="text-sm text-slate-300">No {label.toLowerCase()} records yet; each character posts its ring after its next report.</p>}
  </section>;
}
