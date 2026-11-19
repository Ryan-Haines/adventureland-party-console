// The status owner's rings and the diagnostics lease client on the character.
// The status owner's own ring, `combat`, holds the combat trace, the handoff timing and the
// fight packets. No ring travels in the report: while a diagnostics view holds a character's lease,
// the reply names the leased rings, and after the report the character posts each one as its own
// request, read through its owner's door. The status owner's rings record only while their lease lasts, so a
// character no view watches samples and keeps nothing.
import { scope, CHARACTER_PICKS } from '../../lifecycle/api.ts';
import { capReached } from './bounds.ts';
import { partyHooks } from '../../hooks/index.ts';
import { HANDOFF_DEATHS, STATUS_PICKS, TRACE_CELL_PX, type DiagnosticsRing, type LeasedRing } from '../rules.ts';
import type { Group } from '../../coordinator/targeting/api.ts';
import { ATTACK_SOURCE, attackReadyAt } from '../../characters/turns/api.ts';

/* eslint-disable @typescript-eslint/no-explicit-any -- the root's shared state and the turns owner's notices are read as the client gives them */
type Game = any;
const picks = STATUS_PICKS;
const reportMs = () => CHARACTER_PICKS.lifecycleReportMs;
type Selection = Pick<Group, 'selection' | 'committed' | 'target' | 'handoffTiming'>;

// The handoff timing: bounded local-clock evidence of each grouped target's selection,
// commit, attack attempts and acceptance. Coordinator timestamps are correlation only. A report and
// its response are noted once per report period.
export function createHandoffTiming(entries: Record<string, unknown>[], recording: () => boolean, now = Date.now) {
  let selection: string | null = null, target: string | null = null, accepted = false;
  let lastBlock = '', attempted = false, committed = false;
  const deaths = new Set<string>();
  let reportAt = -Infinity, responseAt = -Infinity;
  function record(stage: string, details: Record<string, unknown>) {
    if (!recording()) return;
    entries.push({ at: now(), stage, ...details });
    if (entries.length > picks.handoffEntries) entries.splice(0, entries.length - picks.handoffEntries);
  }
  function select(group: Selection | null) {
    selection = group?.selection ?? null; target = group?.target?.id ?? null;
    accepted = false; attempted = false; committed = false; lastBlock = '';
    record('selection', { target, selection, committed: !!group?.committed, coordinator: group?.handoffTiming });
  }
  return {
    event: record,
    death(id: string) {
      if (deaths.has(id)) return;
      deaths.add(id);
      // A death is noted once while it is among the last HANDOFF_DEATHS.
      if (deaths.size > HANDOFF_DEATHS) { deaths.delete(deaths.values().next().value!); capReached('HANDOFF_DEATHS', '12'); }
      record('death', { target: id });
    },
    report(details: Record<string, unknown>) { if (now() - reportAt >= reportMs()) { reportAt = now(); record('report', details); } },
    response(details: Record<string, unknown>) { if (now() - responseAt >= reportMs()) { responseAt = now(); record('response', details); } },
    selection(group: Selection | null) {
      if ((group?.selection ?? null) !== selection) select(group);
      if (!accepted && group?.committed && !committed) {
        committed = true;
        record('committed', { target, selection, coordinator: group.handoffTiming });
      }
    },
    attack(stage: string, id: string, details: Record<string, unknown>) {
      if (accepted || id !== target) return;
      if (stage === 'attempt' && attempted) return;
      if (stage === 'attempt') attempted = true;
      if (stage === 'blocked') {
        const reason = String(details.reason);
        if (reason === lastBlock) return;
        lastBlock = reason;
      }
      record(stage, { target, selection, ...details });
      if (stage === 'accepted') accepted = true;
    },
  };
}

interface RingsPorts {
  /** The shared root, which keeps the rings across a reload. */
  root(): Game;
  name(): string;
  current(): boolean;
  request(path: string, options: { method?: string; body?: unknown }): Promise<unknown>;
  /** The combat state the trace samples, each through its owner's door: the hunting owner's mode and rare control,
   *  The targeting owner's queue and active target, the status owner's queue rings, the loot client's pending departure, and the movement owner's
   *  navigation intent, approach report and group walk. */
  combat: {
    character(): { x: number; y: number };
    mode(): unknown;
    queue(): { queueRevision?: unknown; pursuit?: unknown } | null | undefined;
    activeTarget(): { id?: unknown } | null | undefined;
    markers(): { id?: unknown; role?: unknown; visible?: unknown }[];
    departure(): boolean;
    cancelled(): unknown;
    approach(): unknown;
    travel(): { id?: unknown; phase?: unknown; epoch?: unknown } | null | undefined;
    rare(): { id?: unknown } | null | undefined;
  };
  /** The status owner's fight packets (character/telemetry.ts). */
  fightPackets(): unknown[];
  /** Each other ring's read through its owner's door (table G): the movement owner's records and incidents, the call budget owner's call ring. */
  reads: Partial<Record<Exclude<DiagnosticsRing, 'combat'>, () => { records: unknown; incidents?: unknown }>>;
}

function createRings(p: RingsPorts) {
  const observe = scope('12', 'observe');
  // The rings the last reply's lease named.
  let leased: LeasedRing[] = [];
  const recording = () => leased.includes('combat');
  const trace: Record<string, unknown>[] = p.root().__partyCombatTrace ||= [];
  const handoffs: Record<string, unknown>[] = p.root().__partyHandoffTrace ||= [];
  const timing = createHandoffTiming(handoffs, recording);
  let signature = '', sampler: number | null = null;
  // The combat state the role loop acts on: the position owner's record, the queue's reset
  // epoch and the nominations on the realm, and the rest through each owner's door.
  function snapshot(): Record<string, unknown> {
    const c = p.combat, realm = p.root(), position = realm.partyCombatPosition || {}, me = c.character(), queue = c.queue(), travel = c.travel();
    return {
      mode: c.mode(), epoch: realm.__partyCombatResetAt || 0, queueRevision: queue && queue.queueRevision,
      owner: position.movementOwner || null, reason: position.reason || position.mode, cell: [Math.round(me.x / TRACE_CELL_PX), Math.round(me.y / TRACE_CELL_PX)],
      target: (c.activeTarget() || {}).id, markers: c.markers().map(t => ({ id: t.id, role: t.role, visible: t.visible })),
      departure: c.departure(), cancelled: c.cancelled(),
      approach: c.approach(), pursuit: queue && queue.pursuit,
      nominations: realm.__partyNomination || null,
      convoy: travel && travel.id, convoyPhase: travel && travel.phase,
      convoyEpoch: travel && travel.epoch, rare: c.rare() && c.rare()!.id };
  }
  // The trace keeps each change of the combat state the role loop acts on, at `combatTraceMs`.
  function sample() {
    const next = snapshot();
    const key = JSON.stringify(next);
    if (key === signature) return;
    signature = key;
    trace.push({ at: Date.now(), ...next });
    if (trace.length > picks.combatTraceEntries) trace.splice(0, trace.length - picks.combatTraceEntries);
  }
  // The handoff notes at the basic attack's send, its acceptance and the attack source's skip,
  // on the turns owner's own notices at the moments they mark.
  const attackContext = (notice: Record<string, unknown>) => notice.context as { target?: { id?: string } } | undefined;
  partyHooks().publish({ name: 'core:status', folder: 'core', author: 'adventureland-party-console',
    summary: "Records the character's combat lines, game logs, metrics, last death and combat rings for the dashboard.",
    hooks: {
      'skills.sent': (notice: Record<string, unknown>) => {
        const id = attackContext(notice)?.target?.id;
        if (id) timing.attack('attempt', id, { cooldownReadyAt: attackReadyAt(), frequency: Number(p.root().character?.frequency) });
      },
      'skills.settled': (notice: Record<string, unknown>) => {
        const id = attackContext(notice)?.target?.id;
        if (id && notice.outcome === 'accepted') timing.attack('accepted', id, { sentAt: notice.sentAt });
      },
      'skills.dropped': (notice: Record<string, unknown>) => {
        if (notice.by === ATTACK_SOURCE && typeof notice.selected === 'string')
          timing.attack('blocked', notice.selected, { reason: notice.reason, cooldownReadyAt: attackReadyAt() });
      },
    } });

  // Table G's client: the reply's leased rings, posted after the report.
  function reply(state: { diagnosticsRings?: unknown }) {
    leased = Array.isArray(state.diagnosticsRings) ? state.diagnosticsRings as LeasedRing[] : [];
    if (recording() && sampler === null) sampler = observe.setInterval(sample, picks.combatTraceMs);
    if (!recording() && sampler !== null) { observe.clearInterval(sampler); sampler = null; trace.length = 0; handoffs.length = 0; signature = ''; }
    for (const ring of leased) {
      let read: { records: unknown; incidents?: unknown } | undefined;
      // A ring whose owner has not installed on this character (no role runner yet) posts nothing. An
      // add-on's ring is read by its character half (the `diagnostics-ring` slot). A read that throws
      // posts its error as the ring's incident, so the view shows the failed read, and the next
      // report reads the ring again.
      try {
        read = ring === 'combat' ? { records: { trace: trace.slice(), handoffs: handoffs.slice(), packets: p.fightPackets() } }
          : ring in p.reads ? p.reads[ring as Exclude<DiagnosticsRing, 'combat'>]?.() : partyHooks().rings().find(own => own.ring === ring)?.read?.();
      }
      catch (error) { read = { records: [], incidents: [{ at: Date.now(), kind: 'read-failed', error: String((error as Error)?.message ?? error) }] }; }
      if (!read) continue;
      void p.request('/diagnostics/records', { method: 'POST', body: { character: p.name(), ring, records: read.records, incidents: read.incidents ?? [] } })
        .catch(() => { /* The next report posts the ring again. */ });
    }
  }
  return { timing, reply, snapshot };
}

const status = ((globalThis as { partyStatus?: Record<string, unknown> }).partyStatus ||= {});
status.rings = createRings;
