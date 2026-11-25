// The sources:
// another owner's record reaches the tasks owner as a source, a registration of the one hook
// `task.request` that describes the task its record names and decides nothing. Once per task tick
// every source describes each group; a new identity is a request, the same identity keeps its
// handle and passes its phase and label through `update`, and a slot it describes as empty, or a
// changed identity, releases the old task with the source's end code (rule 2.3.3). The owner holds
// the handles (`owner.held`), so a load rebuilds `live` and `waiting` from the records alone
// (1.2 "Saved state").
import type { EndCode, GroupKind } from '../rules.ts';
import type { GroupSpec, TaskOwner, TaskRequest } from './owner.ts';

export type SourceAsk = Omit<TaskRequest, 'source' | 'slot'>;
// One slot of a source's answer for one group: the task it describes there, or none, and the end
// code its task takes when the record stops naming it.
export interface SourceAnswer { slot: string; ask: SourceAsk | null; end: EndCode }
export interface SourceView { group: string; groupKind: GroupKind; members: string[]; live: ReturnType<TaskOwner['live']>; tick: number }

export function askSources(owner: TaskOwner, groups: readonly GroupSpec[], now: number,
  describe: (view: SourceView) => { name: string; answers: SourceAnswer[] }[]) {
  for (const g of groups) {
    const held = owner.held(g.id), asked = new Set<string>();
    for (const { name, answers } of describe({ group: g.id, groupKind: g.kind, members: [...g.members], live: owner.live(g.id), tick: now }))
      for (const { slot, ask, end } of answers) {
        asked.add(name + '|' + slot);
        const mine = held.find(h => h.source === name && h.slot === slot);
        if (mine && mine.owner !== ask?.owner) owner.release(mine.handle, end);
        if (!ask) continue;
        if (mine?.owner === ask.owner) owner.update(mine.handle, { phase: ask.phase, label: ask.label, deadline: ask.deadline, goal: ask.goal });
        else owner.request(g.id, { ...ask, source: name, slot });
      }
    // A source that no longer answers for the group, an add-on switched off among them, lets go.
    for (const h of held) if (!asked.has(h.source + '|' + h.slot)) owner.release(h.handle, 'released');
  }
}
