// The movement owner's records on the coordinator: saved snapshots. A character's decision ring and
// its stuck and caught-error records live in the character's memory and never travel in the heartbeat.
// A snapshot, which the character posts when it dies, writes a stuck or caught-error record, sees
// churn, or reports a failed group walk, is one file, and each character keeps at most SNAPSHOTS_KEPT
// of them, none older than SNAPSHOT_AGE_MS. The live ring reaches a reader through the status owner's diagnostics
// lease (runtime/status/coordinator/diagnostics.ts). The file also holds the walk history entries
// (from convoy-history.ts) and the command ownership diagnostics (from scripts/command-ownership.cjs),
// the walk's two records in the members' combat logs.
import type { MovementIncident, MovementRecord, RingEntry } from '../../protocol/records.ts';
import type { PartyConvoy, HuntTravelCheckpoint } from './walk.ts';
import type { ReturnTownPolicy } from './arrivals.ts';
import type { StoredCombatLogEntry } from '../../status/api.ts';
import { appendCombatLog } from '../../status/coordinator/api.ts';
import type { MerchantCommand } from '../../merchant-jobs/api.ts';
// Design section 7 "Pruning": at most 20 saved snapshots per character and none older than 7 days.
export const SNAPSHOTS_KEPT = 20;
export const SNAPSHOT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Design section 7 trigger 4, carried out on the character (runtime/movement/character/owner.ts).
// `task-failed` and `safe-point` are the group ring's triggers 3 and 2, whose subject is the group.
// `limitdc` is the call budget's: a character the server disconnected for its call limit posts its
// call ring (part 'calls') with the server's report and the ledger in its `limitdc` entry.
export type SnapshotTrigger = 'death' | 'stuck' | 'caught-error' | 'churn' | 'walk-failed' | 'task-failed' | 'safe-point' | 'limitdc';
export const SNAPSHOT_TRIGGERS: readonly SnapshotTrigger[] = ['death', 'stuck', 'caught-error', 'churn', 'walk-failed', 'task-failed', 'safe-point', 'limitdc'];
// The triggers of the movement ring, each with the owner whose change sets it off, which
// `records.saved` names as `by`. A death is survival's; the rest are
// movement's own. The task and call rings' triggers tell nothing here: their owners tell theirs.
const MOVEMENT_TRIGGERS: Partial<Record<SnapshotTrigger, string>> = { death: '05', stuck: '02', 'caught-error': '02', churn: '02', 'walk-failed': '02' };
interface MovementSnapshot {
  id: string; character: string; trigger: SnapshotTrigger; at: number; runtime?: string;
  // The record that set it off, for a stuck or caught-error trigger.
  incident?: string;
  // The id the character gave its snapshot, for a post it may send again: the call budget keeps a
  // `limitdc` copy until this store answers, and a relog can cut the answer after the save
  //. The store keeps one snapshot per character and posted id.
  posted?: string;
  // A character's movement records, a group's task ring (part 'tasks') or a character's call
  // ring (part 'calls').
  records: (MovementRecord | RingEntry)[]; incidents: MovementIncident[];
}
interface MovementRecordsPorts {
  now(): number;
  // The realm's registry, which hears `records.saved` for each movement ring snapshot.
  notify(hook: 'records.saved', payload: Record<string, unknown>): void;
  // The snapshot directory beside the coordinator's data, and the file calls that reach it.
  directory: string;
  files: Pick<typeof import('node:fs'), 'readdirSync' | 'readFileSync' | 'mkdirSync' | 'writeFileSync' | 'unlinkSync'>;
}

const fileOf = (snapshot: Pick<MovementSnapshot, 'at' | 'trigger'>, sequence: number) =>
  `${String(snapshot.at).padStart(15, '0')}-${String(sequence).padStart(6, '0')}-${snapshot.trigger}.json`;
const savedAt = (file: string) => Number(file.split('-')[0]);

export function createMovementRecords(ports: MovementRecordsPorts) {
  let sequence = 0;
  // One directory per character under the snapshot directory (design section 7). A character with no
  // directory has no snapshots, an unreadable file reads as none, and a file pruned twice is gone.
  const folder = (character: string) => ports.directory + '/' + encodeURIComponent(character);
  function listFiles(character: string): string[] {
    try { return ports.files.readdirSync(folder(character)); } catch { return []; }
  }
  function readFile(character: string, file: string): string | null {
    try { return ports.files.readFileSync(folder(character) + '/' + file, 'utf8'); } catch { return null; }
  }
  function writeFile(character: string, file: string, body: string): void {
    ports.files.mkdirSync(folder(character), { recursive: true });
    ports.files.writeFileSync(folder(character) + '/' + file, body);
  }
  // A missing file, an unparsable one or one with no records list reads as no snapshot, for every
  // reader.
  function readSnapshot(character: string, file: string): MovementSnapshot | null {
    const body = readFile(character, file);
    try {
      const saved = body ? JSON.parse(body) as MovementSnapshot | null : null;
      return Array.isArray(saved?.records) ? saved : null;
    } catch { return null; }
  }
  function removeFile(character: string, file: string): void {
    try { ports.files.unlinkSync(folder(character) + '/' + file); } catch { /* Already pruned. */ }
  }
  function prune(character: string, now: number): void {
    const files = listFiles(character).filter(file => file.endsWith('.json')).sort();
    const keep = new Set(files.filter(file => now - savedAt(file) < SNAPSHOT_AGE_MS).slice(-SNAPSHOTS_KEPT));
    for (const file of files) if (!keep.has(file)) removeFile(character, file);
  }
  const service = {
    save(snapshot: Omit<MovementSnapshot, 'id' | 'at'>): MovementSnapshot {
      // A post sent again answers with the snapshot already saved under its id.
      if (snapshot.posted !== undefined) {
        const kept = listFiles(snapshot.character).filter(file => file.endsWith('.json'))
          .map(file => readSnapshot(snapshot.character, file)).find(saved => saved?.posted === snapshot.posted);
        if (kept) return kept;
      }
      const now = ports.now(), file = fileOf({ at: now, trigger: snapshot.trigger }, ++sequence);
      const saved: MovementSnapshot = { ...snapshot, id: `${snapshot.character}/${file.replace(/\.json$/, '')}`, at: now };
      writeFile(snapshot.character, file, JSON.stringify(saved));
      const by = MOVEMENT_TRIGGERS[snapshot.trigger];
      if (by) ports.notify('records.saved', { ring: 'movement', character: snapshot.character, record: saved.id, trigger: snapshot.trigger, by });
      prune(snapshot.character, now);
      return saved;
    },
    // A failed group walk's post (routes.ts `failed`): the member's ring and incidents as one
    // `walk-failed` snapshot; a post without a ring or incidents saves an empty list for it.
    walkFailed(name: string, records: unknown, incidents: unknown): void {
      service.save({ character: name, trigger: 'walk-failed', records: Array.isArray(records) ? records : [],
        incidents: Array.isArray(incidents) ? incidents : [] });
    },
    // The saved snapshots of a character, newest first, without their rings.
    snapshots(name: string) {
      prune(name, ports.now());
      return listFiles(name).filter(file => file.endsWith('.json')).sort().reverse().flatMap(file => {
        const saved = readSnapshot(name, file);
        if (!saved) return [];
        const { id, trigger, at, incident, incidents, records } = saved;
        return [{ id, trigger, at, incident, incidents, records: records.length }];
      });
    },
    snapshot(name: string, id: string): MovementSnapshot | null {
      const file = id.startsWith(name + '/') ? id.slice(name.length + 1) + '.json' : '';
      if (!file || file.includes('/') || file.includes('\\')) return null;
      return readSnapshot(name, file);
    },
  };
  return service;
}
export type MovementRecordsService = ReturnType<typeof createMovementRecords>;

// The walk history (from convoy-history.ts).
export interface ConvoyHistoryState {
  combatLogs?: Record<string, StoredCombatLogEntry[] | undefined>;
  monsterHunt?: { convoyId?: string | null; stage?: string; target?: string | null; returnTown?: ReturnTownPolicy; travelCheckpoint?: HuntTravelCheckpoint } | null;
}
type Convoy = Pick<PartyConvoy, "id" | "phase"> & Partial<PartyConvoy>;

/** One entry per lifecycle transition, retaining destinations independently of mutable commands. */
export function recordConvoyHistory(state: ConvoyHistoryState, c: Convoy, event: string, now: number,
  details: Record<string, unknown> = {}): void {
  if (!state.combatLogs || !c.leader) return;
  appendCombatLog(state.combatLogs, c.leader, { at: now, type: "navigation", message: "Convoy " + event, details: {
    convoyId: c.id, epoch: c.epoch, phase: c.phase, purpose: c.purpose, cause: c.cause, label: c.label,
    destination: c.location && { map: c.location.map, in: c.location.in, x: c.location.x, y: c.location.y },
    huntStage: state.monsterHunt?.stage, huntTarget: state.monsterHunt?.target,
    revisions: Object.fromEntries(Object.entries(c.expected || {}).map(([name, expected]) => [name, expected.revision])),
    ...details,
  } });
}

// Bounded command ownership diagnostics; never logs command payloads or inventory (from
// scripts/command-ownership.cjs).
// The command ownership diagnostics' read of the party (createCommandOwnership below).
export interface CommandOwnershipPlatform {
  (state: {
    commands: Record<string, MerchantCommand | undefined>;
    combatLogs: Record<string, StoredCombatLogEntry[]>;
  }): {
    clear(name: string, matches: (command: MerchantCommand) => boolean): void;
  };
}
export function createCommandOwnership(party: Parameters<CommandOwnershipPlatform>[0]): ReturnType<CommandOwnershipPlatform> {
  type Command = Parameters<CommandOwnershipPlatform>[0]['commands'][string] & { convoyId?: string | null; jobId?: string | null; cycleId?: string | null };
  const describe = (c: Command | null | undefined) => c ? { id: c.id, type: c.type, convoyId: c.convoyId || null, jobId: c.jobId || null, cycleId: c.cycleId || null } : null;
  const record = (name: string, before: Command | null | undefined, after: Command | null | undefined) => {
    if (!before?.convoyId && !after?.convoyId) return;
    appendCombatLog(party.combatLogs, name, { at: Date.now(), type: 'navigation', message: 'Command ownership changed', details: { before: describe(before), after: describe(after),
      source: String(new Error().stack).split('\n').slice(3, 6).map(s => s.trim()) } } as StoredCombatLogEntry);
  };
  party.commands = new Proxy(party.commands, {
    set(target, name, value) { record(String(name), target[String(name)] as Command, value); target[String(name)] = value; return true; },
    deleteProperty(target, name) { record(String(name), target[String(name)] as Command, null); return Reflect.deleteProperty(target, name); },
  });
  return { clear(name, match) { const command = party.commands[name]; if (command && match(command)) delete party.commands[name]; } };
}
