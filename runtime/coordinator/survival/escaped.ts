// The escape's cause on the coordinator.
// At a party escape the verdict holds two
// answers: the game-data model says whether the fight is winnable on paper, and the window's trend
// says what happened. A model win the trend left is bad luck; a model loss, or a trend that agrees
// with it, is too hard. A second bad-luck escape from the same monster type under the same odds says
// the model is wrong for that fight, so it reads as too hard. The odds are the party's members and
// the stats the model reads (level, attack, frequency, armor, resistance, max HP), which a level or a
// gear change moves; a win over that monster type clears its record. Survival publishes the cause
// as `survival.escaped`, whose `by` names an add-on whose refusal decided it; the Hunt's blacklist reading it is the hunting owner's (on the hunting owner's list), so nothing here
// avoids a target.

import { publishSurvival, type SurvivalPublish } from './died.ts';

export type EscapeCause = 'bad luck' | 'too hard';
export interface EscapeOdds { name: string; level?: number; attack?: number; frequency?: number; armor?: number; resistance?: number; max_hp?: number }
export interface EscapedNotice {
  names: string[]; at: number; cause: EscapeCause; mtypes: string[]; repeat: boolean;
  // The members whose deaths started the recovery this escape ends; each has its own `survival.died`.
  deaths: string[];
  model: 'finish' | 'leave'; trend: { foeRate: number | null; toKill: number | null; toFall: Record<string, number> | null } | null;
}
export interface EscapeJudgement {
  model: 'trend' | 'model'; modelWins: boolean;
  foeRate: number | null; toKill: number | null; toFall: Record<string, number> | null;
}
// One bad-luck escape per monster type under one set of odds.
export type EscapeRecord = Record<string, { odds: string; at: number }>;
export interface EscapedPorts {
  now(): number;
  // The saved record (held with the party's state, as `combatDeathSeen` is).
  record(): EscapeRecord;
  publish: SurvivalPublish;
}

const oddsKey = (members: readonly EscapeOdds[]) => JSON.stringify([...members].sort((a, b) => a.name.localeCompare(b.name))
  .map(m => [m.name, m.level ?? null, m.attack ?? null, m.frequency ?? null, m.armor ?? null, m.resistance ?? null, m.max_hp ?? null]));

export function classify(j: EscapeJudgement, prior: boolean): EscapeCause {
  const luck = j.model === 'trend' && j.modelWins;
  return luck && !prior ? 'bad luck' : 'too hard';
}

export function createEscaped(ports: EscapedPorts) {
  return {
    // One party escape the verdict decided: its cause, recorded and published.
    escaped(names: readonly string[], members: readonly EscapeOdds[], mtypes: readonly string[], j: EscapeJudgement, by = 'core:survival', deaths: readonly string[] = []): EscapedNotice {
      const record = ports.record(), odds = oddsKey(members), types = [...new Set(mtypes)].sort();
      const repeat = types.some(t => record[t]?.odds === odds);
      const cause = classify(j, repeat);
      for (const t of types) {
        if (cause === 'bad luck') record[t] = { odds, at: ports.now() };
        else delete record[t];
      }
      const notice: EscapedNotice = { names: [...names], at: ports.now(), cause, mtypes: types, repeat, deaths: [...deaths], model: j.modelWins ? 'finish' : 'leave',
        trend: j.model === 'trend' ? { foeRate: j.foeRate, toKill: j.toKill, toFall: j.toFall } : null };
      publishSurvival(ports.publish, 'survival.escaped', notice.names[0] || '', notice.names.join(', ') + ': ' + notice.cause, notice, notice.at, by);
      return notice;
    },
    // A kill of a monster type after its bad-luck escape clears the record: the party won a fight
    // with it. Each kill is a grouped fight's death tombstone with its time and the monster type its
    // target had (the targeting owner's queue.ts).
    won(kills: readonly { mtype?: string; at?: number }[]) {
      const record = ports.record();
      for (const k of kills) if (k.mtype && record[k.mtype] && Number(k.at) > record[k.mtype]!.at) delete record[k.mtype];
    },
  };
}
export type Escaped = ReturnType<typeof createEscaped>;
