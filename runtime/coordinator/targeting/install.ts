// The targeting owner's registration on the coordinator: `core:targeting` answers
// `targeting.passing`, the passing column, which the Hunt travel defense asks through the
// `passing` port the application hands its callers, and `targeting.fight`, the grouped fight a
// party death recovery reads. It hears survival's recovery and escape notices and resets its own
// grouped fight when one says the fight resets. The character's realm answers its own questions
// (runtime/characters/targeting/install.ts).
import { passingAllows } from '../../characters/targeting/passing.ts';
import { readPicks } from '../../characters/targeting/saved-fields.ts';
import { hiddenValue } from '../../settings/coordinator/api.ts';
import type { GroupFightView, GroupView, Registration } from '../../hooks/registry.ts';
import type { Group } from './api.ts';

// The group records targeting keeps on the coordinator: each group's grouped fight and its reset
// times.
export interface GroupedRecord { groupedCombat?: Group | null; groupedCombatResetAt?: number; combatResetByCharacter?: Record<string, number | undefined>;
  statuses?: Record<string, { groupedCombat?: { queueAck?: string | null } } | undefined> }
interface GroupRecords { state(group: string): GroupedRecord | undefined; now(): number }

// core:targeting over one start's group records: installCoordinatorTargeting publishes it with the
// records in hand, so no hook reads a process global. With no records every group read answers none.
function registration(records: GroupRecords | null): Registration {
  // `targeting.groupView`: the group's queue ledger. `acknowledgements` names the members whose report
  // acknowledges the queue's revision (`queueAck`), the queue's own delivery acknowledgement that the
  // rare client reads today (rare-hunting.ts `selectionAcknowledged`); `lost` is the queue's lost
  // targets, each with its `retiredAt` and `reason`; `seenAt` is the time the queue was last evaluated,
  // which v1.5.0's rare bridge gave its selected target as its sighting time.
  function groupView(ask: { group: string }): GroupView | undefined {
    const state = records?.state(ask.group), g = state?.groupedCombat;
    if (!g) return undefined;
    const acknowledgements = Object.entries(state!.statuses ?? {}).filter(([, s]) => !!g.queueRevision && s?.groupedCombat?.queueAck === g.queueRevision).map(([name]) => name);
    return { selected: g.selection, queued: g.queue, locked: g.target, engaged: g.fights, killed: g.deaths, claimed: g.claims ?? [],
      revision: g.queueRevision, acknowledgements, lost: g.lostTargets ?? [], seenAt: g.seenAt };
  }
  function fight(group: string): GroupFightView | undefined {
    const g = records?.state(group)?.groupedCombat;
    return g ? { startedAt: (g.target as { startedAt?: number } | null)?.startedAt, fights: g.fights || [], deaths: g.deaths || [] } : undefined;
  }
  // A survival notice that resets the group's fight: each named member's reset time moves past its
  // last one and the clock, and the grouped fight starts again from fresh reports, at the moment the
  // recovery's `reset` wrote them. Survival saves the record after the notice. A group whose record
  // its key no longer names has no fight to reset.
  function reset(payload: Record<string, unknown>): void {
    if (payload.resetsFight !== true || !records) return;
    const state = records.state(String(payload.group));
    if (!state) return;
    const names = (payload.names ?? []) as string[], byCharacter = (state.combatResetByCharacter ||= {});
    const at = Math.max(records.now(), ...names.map(n => (byCharacter[n] || 0) + 1));
    for (const name of names) byCharacter[name] = at;
    state.groupedCombat = null; state.groupedCombatResetAt = at;
  }
  return {
    name: 'core:targeting', folder: 'core', author: 'adventureland-party-console',
    summary: "Decides which trips a passing monster may interrupt, names a group's grouped fight, and resets it when a party death recovery or escape drops it.",
    hooks: { 'targeting.passing': (walk, cause) => passingAllows(walk, cause), 'targeting.fight': fight, 'targeting.groupView': groupView,
      'survival.recoveryPhase': reset },
  };
}
// The registration's shape over no records, which the hook catalog checks read.
export const coordinatorTargetingRegistration: Registration = registration(null);
// The application installs it at each start with the lookup of a group's record by its walk key.
export function installCoordinatorTargeting(hooks: { publish(r: Registration): { ok: boolean; message?: string } }, records: GroupRecords): void {
  // The coordinator's hidden picks are the party's settings (the settings
  // owner's one read).
  readPicks(hiddenValue);
  const result = hooks.publish(registration(records));
  if (!result.ok) throw Error(`The targeting owner's core:targeting did not load: ${result.message}`);
}
