// The holds in play:
// the console Pause and the Cave Hold on groups, the escape's hold
// with the one Escape and Resume button, Manual and Pause on one member, the Follows me
// task, and the hand response each character reads. The button, its colours and its burst guard
// are the dashboard's; the Pause's own state and lease are the lifecycle owner's (runtime/lifecycle/coordinator/control.ts).
import type { OwnTaskHook, Registration } from '../../hooks/registry.ts';
import type { SourceAnswer, SourceView } from './sources.ts';
import { addonOf, type TaskOwner } from './owner.ts';
import type { DungeonParty } from '../../hunting/api.ts';
import type { SettingsWrite, SettingsWriteResult } from '../../settings/api.ts';
import type { HandControl } from '../rules.ts';
import { escapeHolds } from '../../coordinator/survival/api.ts';

// The Escape button's three states.
export type EscapeButton = 'escape' | 'escaping' | 'resume';
const shownOf = (value: unknown): EscapeButton | undefined =>
  value === 'escape' || value === 'escaping' || value === 'resume' ? value : undefined;

// The holders' own state on the coordinator's party record: the escape (05), the Cave visit (07),
// the Manual switches and which characters run now (headless slots and Steam clients).
export interface HoldRecord extends Pick<DungeonParty, 'dailyDungeons'> {
  escape?: { stage?: string } | null;
  handControlByCharacter?: Record<string, HandControl>;
  headlessSlots: readonly (string | null | undefined)[];
  steamMembers: readonly string[];
}
export interface HoldPorts {
  now(): number;
  // The party's group, or null without a leader.
  party(): string | null;
  record(): HoldRecord;
  // "Resume lockout after an escape", read at each press so a change applies at once.
  lockoutMs(): number;
  paused(): boolean;
  // `settings.write`, the settings owner's one writer.
  write(batch: SettingsWrite): SettingsWriteResult;
  // `group.hold` of the add-on whose task the group runs (the registry's `ownTask`).
  ask(hook: OwnTaskHook, addon: string, view: Record<string, unknown>): unknown;
}

export function createHolds(owner: TaskOwner, ports: HoldPorts) {
  const hands = () => ports.record().handControlByCharacter ?? {};
  // A finished Cave run held outside until Release.
  const caveHeld = () => { const d = ports.record().dailyDungeons; return d?.phase === 'held' && !!d.participants.length; };
  // The escape's task takes the group on the next task tick, so a running escape on the record
  // reads Escaping from the press's own request.
  const running = () => { const stage = ports.record().escape?.stage; return !!stage && stage !== 'released' && !escapeHolds(stage); };
  const button = (group: string): EscapeButton =>
    owner.holds(group).some(h => h.by === 'escape') ? 'resume' : owner.live(group)?.kind === 'escape' || running() ? 'escaping' : 'escape';
  const memberHold = (name: string) => owner.holds(name)[0] ?? null;
  // Follows me: the member on Manual that chose it leads the party.
  const followMeOf = (members: readonly string[]) => members.find(name => { const h = memberHold(name); return h?.by === 'manual' && h.party === 'follows-me'; }) ?? null;
  // The party's live Follows me task, or null.
  function followMeTask() {
    const group = ports.party(), live = group ? owner.live(group) : null;
    return live?.owner.startsWith('follow-me:') ? live : null;
  }
  const holds = {
    // Manual for a character in a game client, Pause for a headless one. The hold ends with the
    // toggle or when the character logs out; a headless Pause always carries on. The task tick runs
    // it, and so does the toggle's own request (`settings.changed`, install.ts).
    members() {
      const record = ports.record(), running = new Set([...record.headlessSlots, ...record.steamMembers].filter(name => !!name));
      for (const [name, hand] of Object.entries(hands())) {
        // Manual's end at logout is a write by console:tasks, with its audit line.
        // The pass holds by the value it wrote, so a re-entrant pass from the write's own
        // `settings.changed` and this one agree.
        const on = hand.on && running.has(name);
        if (hand.on && !on) ports.write({ by: 'console:tasks', changes: [{ field: 'handControlByCharacter', character: name, value: { ...hand, on: false } }] });
        const by = record.steamMembers.includes(name) ? 'manual' : 'pause', choice = by === 'pause' ? 'carries-on' : hand.party, held = memberHold(name);
        if (held && (!on || held.by !== by)) owner.hold(name, held.by, null);
        if (on) owner.hold(name, by, { reason: by === 'manual' ? 'On Manual' : 'On Pause', party: choice });
      }
    },
    // Once per task tick, from their holders' own state: the console Pause holds every group from
    // Pause until Play; the escape holds its group while its stage holds (a setting, selection or
    // player command releases the escape, and the next tick lifts the hold); the Cave Hold
    // holds the visit's group with the visit task still live, so escape, death recovery and
    // respawn outside the cave still take it (13.3).
    tick(groups: readonly { id: string; members: readonly string[] }[]) {
      const paused = ports.paused(), party = ports.party();
      for (const g of groups) {
        owner.hold(g.id, 'user', paused ? { reason: 'The console is paused; press Play to resume' } : null);
        holds.addon(g);
      }
      if (party) {
        owner.hold(party, 'escape', escapeHolds(ports.record().escape?.stage) ? { reason: 'Escaped: press Resume to go back to the task' } : null);
        owner.hold(party, 'cave-hold', caveHeld() ? { reason: 'Cave run finished: press Release to go back' } : null);
      }
      holds.members();
    },
    // `group.hold`: the add-on whose task the group runs holds its group or one of its members,
    // for its own reason, until it stops answering or its task ends.
    addon(g: { id: string; members: readonly string[] }) {
      const live = owner.live(g.id), addon = live ? addonOf(live) : null;
      const asked = addon ? ports.ask('group.hold', addon, { group: g.id, members: [...g.members], live: { kind: live!.kind, owner: live!.owner } }) as
        { target?: unknown; reason?: unknown } | null | undefined : null;
      const target = asked && (asked.target === g.id || g.members.includes(String(asked.target))) ? String(asked.target) : null;
      for (const at of [g.id, ...g.members]) for (const held of owner.holds(at))
        if (held.by.startsWith('addon:') && !(at === target && held.by === `addon:${addon}`)) owner.hold(at, held.by, null);
      if (target) owner.hold(target, `addon:${addon}`, { reason: typeof asked!.reason === 'string' ? asked!.reason : addon! });
    },
    // An Escape press acts only when the button showed Escape, so a press aimed at Escape never acts
    // as Resume. A press that names no state is an older app's, and acts as before.
    escape(shown: unknown): string | null {
      const group = ports.party(), seen = shownOf(shown);
      if (!group || seen === undefined) return null;
      // Every press while Escaping is a kept no-op: the running escape answers it.
      const now = button(group);
      return seen === now || now === 'escaping' ? null : `The button shows ${now} now; press it again`;
    },
    // A Resume press. While Escaping, a press that saw Resume is stale and would cancel the running
    // escape, so it is refused. With no escape at all the route releases what it releases. While
    // the hold stands, the lockout applies to every press.
    resume(shown: unknown): string | null {
      const group = ports.party();
      if (!group) return null;
      const now = button(group), seen = shownOf(shown);
      if (now === 'escaping') return seen === undefined || seen === now ? null : `The button shows ${now} now; press it again`;
      if (now === 'escape') return null;
      if (seen !== undefined && seen !== now) return `The button shows ${now} now; press it again`;
      const lockoutMs = ports.lockoutMs(), since = owner.holds(group).find(h => h.by === 'escape')!.since;
      if (ports.now() - since < lockoutMs) return `Resume is locked for ${Math.ceil(lockoutMs / 1000)} s after an escape`;
      owner.hold(group, 'escape', null);
      return null;
    },
    button: (): EscapeButton | null => { const group = ports.party(); return group ? button(group) : null; },
    // When Resume unlocks: the party's escape hold's start plus "Resume lockout after an
    // escape", which the dashboard's button counts down to. Null without an escape hold.
    resumeAt: (): number | null => {
      const group = ports.party(), since = group ? owner.holds(group).find(h => h.by === 'escape')?.since : undefined;
      return since === undefined ? null : since + ports.lockoutMs();
    },
    // A character under a member hold is never moved by the console (13.5): it is in no walk.
    held: (name: string) => !!memberHold(name),
    // The Follows me task as a task source: a `manual` task of the party, owner
    // `follow-me:<name>`, while a character on Manual chose it. Its walk is the members following
    // that character (the heartbeat names it as the leader to follow).
    source: {
      name: 'core:follow-me', folder: 'core', author: 'adventureland-party-console',
      summary: 'Asks for the party to follow the character you play on Manual, when you chose Follows me.',
      hooks: { 'task.request': (view): SourceAnswer[] => {
        const g = view as SourceView;
        if (g.groupKind !== 'party') return [];
        const leader = followMeOf(g.members);
        return [{ slot: 'follow-me', end: 'user', ask: leader ? { kind: 'manual', owner: `follow-me:${leader}`, members: [...g.members], phase: 'follow-me',
          label: `Following ${leader}` } : null }];
      } },
    } satisfies Registration,
    // On the character: its own hold with the Manual switches, and under Follows me the
    // character the other members follow in place of their leader.
    response(name: string, at: (anchor: string) => { map: string; x: number; y: number } | undefined) {
      const hold = memberHold(name), hand = hands()[name];
      // The console Pause reaches every character in this one field as `user`,
      // ahead of the member's own Manual or Pause.
      const handControl = ports.paused() ? { by: 'user' as const, usePotions: false, combat: false }
        : hold && (hold.by === 'manual' || hold.by === 'pause')
        ? { by: hold.by, usePotions: hold.by === 'manual' && hand?.usePotions !== false, combat: hold.by === 'manual' && hand?.combat !== false } : null;
      const group = followMeTask(), anchor = group ? group.owner.slice('follow-me:'.length) : null;
      const where = anchor && anchor !== name && group!.members.includes(name) ? at(anchor) : undefined;
      return { handControl, followMe: where ? { name: anchor!, location: { map: where.map, x: where.x, y: where.y } } : null };
    },
    // Follows me is the party's walk (13.5), so a navigation the player cancelled, such as a party
    // Town, holds neither the leader's nominations nor the grouped pull while the follow holds the
    // party. The saved intent stays cancelled, and the farming task finds it so when it resumes.
    intent<T extends { cancelled?: boolean }>(name: string, intent: T): T {
      return intent.cancelled && !!followMeTask()?.members.includes(name) ? { ...intent, cancelled: false } : intent;
    },
  };
  return holds;
}
