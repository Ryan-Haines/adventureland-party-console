import { evaluateGroup, type Group, type Member } from "../../combat/grouped.ts";
import type { CaveObservation, DungeonState } from "../../dungeons/contracts.ts";
interface State {
  dailyDungeons?: DungeonState;
  statuses: Record<string, Member["status"] & {ctype?: string; dungeon?: CaveObservation}>;
  groupedCombat?: Group | null;
}
/** The ordinary queue, scoped to this cave floor instead of saved farming navigation. */
export function caveCombat(state: State, now: number): Group | null {
  const d = state.dailyDungeons;
  if (!d || d.phase !== "active" || !d.run) return null;
  const lead = state.statuses[d.participants[0]], cave = lead?.dungeon?.cave;
  if (!cave || cave.run !== d.run) return null;
  const scope = d.run + ":" + cave.floor;
  const previous = state.groupedCombat?.caveScope === scope ? state.groupedCombat : null;
  const members = d.participants.map(name => member(state, name, scope));
  collectCandidates(members, now);
  const paused = members.some(m => {
    const other = state.statuses[m.name]?.dungeon?.cave;
    return !other || other.paused || other.run !== d.run || other.floor !== cave.floor;
  });
  const result = evaluateGroup(previous, members, d.participants[0], now, 0, paused);
  result.caveScope = scope;
  return result;
}
function member(state: State, name: string, scope: string): Member {
  const s = state.statuses[name], g = s?.groupedCombat;
  return {name, ctype: s?.ctype || "", revision: 0, cancelled: false,
    status: s && {...s, activeEvent: null, joinedEvent: null, mapEvent: null,
      groupedCombat: g && {...g, lootPending: false,
        state: g.state?.caveScope === scope ? g.state : null,
        passingEncounters: [], travelCommand: null,
      }},
  };
}

function collectCandidates(members: Member[], now: number) {
  const lead = members[0]?.status;
  if (!lead?.groupedCombat) return;
  lead.groupedCombat.candidates = members.filter(m => m.status && now - m.status.seenAt <= 3000 &&
    m.status.server === lead.server && m.status.map === lead.map && m.status.in === lead.in)
    .flatMap(m => m.status!.groupedCombat?.candidates || []);
}
