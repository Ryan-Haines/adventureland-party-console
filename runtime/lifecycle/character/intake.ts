// The command intake on the character: the one command the
// coordinator sends with each status reply. 13 keeps the command id and the order of the questions; each
// question reads table I (rules.ts) or the owning module's door, and each command runs through its
// owner's door. Moved from characters/shared.js `handle`, `handleOwnedCommand` and `handleCommand`.
import { TABLE_I, commandKey, intakeAdmits, type CommandRow } from '../rules.ts';

interface Command {
  id: number; type: string; phase?: string; purpose?: string; location?: unknown;
  navigationRevision?: number; mail?: { recipient?: string }; action?: string;
}
type Door = (command: Command, accept: () => void) => unknown;
interface IntakePorts {
  /** The CODE frame keeps the spent command id, so a hot reload of the character code does not run a
   *  long command again (a commerce coroutine outlives the routine that started it). */
  frame: { __partyLastCommand?: number };
  merchant(): boolean;
  /** Table P holds the character (run.ts), and the deploy lease (drain.ts). */
  held(): boolean;
  lease(): unknown;
  /** The tasks owner's hand control: `manual` on a character the player drives. */
  hand(): { by?: string } | null | undefined;
  /** 10: the Tracktrix pin the report tick runs, the bag holder's command band, the upgrade preview,
   *  and the preparation (the merchant's tidy, lucky swap and production journal, and the lucky slot
   *  a command names), which answers false when the command waits. */
  pinning(): Promise<unknown> | null | undefined;
  band<T>(run: () => Promise<T>): Promise<T>;
  previewing(): boolean;
  prepare(command: Command): Promise<boolean>;
  /** 07: a Cave run owns the character's commands. */
  caveOwns(): boolean;
  /** 05: the escape, with the one purpose it admits (CF-B1). */
  escape(): { admits?: string } | null | undefined;
  /** 06: the event attendance's deferral reason. */
  eventDefers(command: Command): string | null | undefined;
  /** 06 and 07 on acceptance: the event exit and the event recovery hear the new command. */
  eventAccepted(command: Command): void;
  /** 01: a new command ends the farm reunion unless it is the reunion's own walk. */
  reunion(command: Command): Promise<void>;
  /** 02: a farming walk runs under the walk's travel token, and runs nothing when its navigation
   *  revision is stale; on acceptance the command takes over the group walk. */
  walk<T>(command: Command, defensive: boolean, run: () => Promise<T>): Promise<T | undefined>;
  takeover(command: Command): Promise<void>;
  /** 08: the merchant's command record and its bands. */
  jobs: {
    admit(id: number): boolean;
    accept(command: Command): Promise<boolean>;
    report(command: Command, outcome: 'accepted' | 'deferred', reason?: string): void;
    release(id: number): void;
    job(command: Command, label: string, run: () => unknown): unknown;
    afterCombat(run: () => unknown, label: string): unknown;
  };
  /** Each command's door, by table I's key, and the owners that answer whether they take a command
   *  before its id is spent (the events owner's event exit). */
  doors: Record<string, Door>;
  accepts: Record<string, (command: Command) => boolean>;
  /** The game window, which the Steam switch (`native-switch`, the lifecycle owner's roster) sends to the next character. */
  game: { caracAL?: unknown; server_region?: string; server_identifier?: string; window: { location: { href: string } } };
  log(message: string, color: string): void;
}

export function createIntake(p: IntakePorts) {
  const f = p.frame;
  let last = Number(f.__partyLastCommand) || 0;
  const spend = (id: number) => { last = id; f.__partyLastCommand = id; };
  const fresh = (command: Command) => command.id > last;
  // The lifecycle owner's own door: the Steam client loads the named character on the realm it plays now.
  const doors: Record<string, Door> = { ...p.doors, 'native-switch': (command: Command & { character?: string }) => {
    if (p.game.caracAL) throw new Error('Steam switching requires the native game client');
    p.log('Switching Steam to ' + command.character, '#51D2E1');
    p.game.window.location.href = '/character/' + encodeURIComponent(String(command.character)) + '/in/' +
      encodeURIComponent(p.game.server_region || 'US') + '/' + encodeURIComponent(p.game.server_identifier || 'II') + '/';
  } };
  const label = (value: CommandRow['job'], command: Command) => typeof value === 'function' ? value(command) : String(value);

  async function run(command: Command) {
    if (p.caveOwns()) return;
    const escape = p.escape();
    if (escape && !(escape.admits && command.purpose === escape.admits)) { p.jobs.report(command, 'deferred', 'escape'); return; }
    const deferred = p.eventDefers(command);
    if (deferred) { p.jobs.report(command, 'deferred', deferred); return; }
    if (!fresh(command)) return;
    await p.reunion(command);
    const key = commandKey(command), row = TABLE_I[key];
    if (row?.walk && !p.merchant()) return p.walk(command, row.walk === 'defensive', () => take(command, key, row));
    return take(command, key, row);
  }

  async function take(command: Command, key: string, row: CommandRow | undefined) {
    if (p.previewing()) return;
    if (!intakeAdmits({ held: p.held(), lease: !!p.lease(), hand: p.hand()?.by, type: command.type })) return;
    if (!fresh(command)) return;
    // A repeat delivery of a command the merchant's intake is running runs nothing.
    if (p.merchant() && !p.jobs.admit(command.id)) return;
    if (row?.own) return doors[key](command, () => spend(command.id));
    if (!await p.prepare(command) || p.merchant() && !await p.jobs.accept(command)) return;
    if (!fresh(command) || p.accepts[key]?.(command) === false) return;
    p.jobs.report(command, 'accepted');
    p.eventAccepted(command);
    spend(command.id);
    await p.takeover(command);
    if (!row || row.merchant && !p.merchant() || row.location && !command.location) return;
    const door = () => doors[key](command, () => spend(command.id));
    const banded = row.combat ? () => p.jobs.afterCombat(door, label(row.combat, command)) : door;
    return row.job ? p.jobs.job(command, label(row.job, command), banded) : banded();
  }

  /** Runs the reply's command. A failed run of a `retry` row hands the id back, so the next reply runs
   *  it again; a walk failure movement already reported is not logged twice. */
  async function receive(command: Command | null | undefined) {
    if (!command) return;
    try {
      await p.pinning();
      await p.band(() => run(command));
    } catch (error) {
      const failure = error as { movementReported?: boolean; reason?: string; message?: string };
      if (last === Number(command.id) && TABLE_I[commandKey(command)]?.retry) rollback(command.id);
      if (!failure?.movementReported) p.log('Party command failed: ' + (failure?.reason || failure?.message || error), 'red');
    } finally {
      p.jobs.release(command.id);
    }
  }
  /** The command `id` runs again on its next delivery: a walk the runtime stopped hands its command
   *  to the next generation. */
  function rollback(id: number) { if (last >= id) spend(id - 1); }

  // The reply's command for this character, which movement's requesters and the merchant jobs owner's gathering read until
  // the next reply, and whether a reply has named one yet.
  let held: Command | null = null, seen = false;
  /** Table A's `command` row: the reply's command, run without holding the apply's later rows. */
  function reply(state: { command?: Command | null }): void {
    held = state.command || null; seen = true;
    void receive(state.command);
  }

  return { reply, rollback, last: () => last, command: () => held, seen: () => seen };
}
