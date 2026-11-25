// The combat context the skill engine's choices read: the leader, the allies on the map, the
// visible monsters, the event and the mode. The facts come through the stand-in ports (shared.js
// `partyTurns.facts()`); `blocked` asks the spend table.
import type { TurnsFacts } from '../stand-ins/holds.ts';
import type { CombatContext, Combatant } from './types.ts';

type Monster = Combatant & { mtype: string; map?: string; in?: string | number; width?: number; height?: number };
type GameMonster = { width?: number; height?: number } & Record<string, unknown>;

// One monster entry (#136): the game data's fields under the entity's own, with the entity's `x`,
// `y`, width and height read from the entity itself. The game client defines some of them as
// accessors, which an object copy leaves out, so a multi-target choice saw every monster at no
// position and counted only its first target. A size the entity does not answer is the game data's.
export function monsterEntry(m: Monster, def: GameMonster): Monster {
  return Object.assign({}, def, m, { x: m.x, y: m.y, width: m.width ?? def.width, height: m.height ?? def.height }) as Monster;
}

// The monster entries of the combat context, kept across builds. A world packet names the monsters
// it changes, and the game applies it at its next draw (game.js `draw` runs `process_entities`), so
// an entry built in a later update than its last packet still holds every field but the position,
// which the game moves between packets and each build reads again. With no update count, as on a
// stand-in game, every build makes every entry again.
export interface MonsterTable {
  // The monsters a packet that arrived at game update `update` changes.
  changed(ids: Iterable<unknown>, update: number): void;
  clear(): void;
  entries(monsters: Monster[], update: number): Monster[];
}
export function createMonsterTable(): MonsterTable {
  const rows = new Map<string, { entity: Monster; def: GameMonster; entry: Monster; update: number }>(), changedAt = new Map<string, number>();
  const defOf = (m: Monster): GameMonster => (G.monsters as unknown as Record<string, GameMonster | undefined>)[m.mtype] || {};
  return {
    changed(ids, update) { for (const id of ids) if (id != null) changedAt.set(String(id), update); },
    clear() { rows.clear(); changedAt.clear(); },
    entries(monsters, update) {
      const seen = new Set<string>();
      const list = monsters.map(m => {
        const id = String(m.id), def = defOf(m), row = rows.get(id), changed = changedAt.get(id);
        seen.add(id);
        if (row && row.entity === m && row.def === def && row.update > (changed ?? -Infinity)) {
          row.entry.x = m.x; row.entry.y = m.y;
          return row.entry;
        }
        const entry = monsterEntry(m, def);
        if (Number.isFinite(update)) { rows.set(id, { entity: m, def, entry, update }); changedAt.delete(id); } else rows.delete(id);
        return entry;
      });
      for (const id of rows.keys()) if (!seen.has(id)) rows.delete(id);
      for (const id of changedAt.keys()) if (!seen.has(id)) changedAt.delete(id);
      return list;
    },
  };
}

// `blocked` holds while the spend table's occupied rows hold or any A/B test runs (`isLiveAbtesting`),
// whose modes besides pending and feed the spend table does not hold.
export function combatContext(facts: TurnsFacts, occupied: () => boolean, table: MonsterTable): CombatContext {
  const event = facts.combatEvent(), roster = facts.roster();
  const allies = [character as unknown as Combatant].concat(roster.filter(name => name !== character.name)
    .map(name => get_player(name) as unknown as Combatant)).filter(member => {
      const m = member as unknown as { rip?: boolean; hp: number; ctype?: string; map?: string; in?: unknown };
      return !!member && !m.rip && m.hp > 0 && m.ctype !== 'merchant' && m.map === character.map && m.in === character.in && facts.sameTeam(member);
    });
  const visible = (Object.values(parent.entities || {}) as unknown as Monster[]).filter(m =>
    m && m.type === 'monster' && m.visible !== false && !m.dead && m.hp > 0 && (!m.map || m.map === character.map) && (m.in == null || m.in === character.in));
  const monsters = table.entries(visible, Number((parent as unknown as { draws?: number }).draws));
  const eventCombat = !!(character as { cave?: unknown }).cave || !!event && (facts.joinedEvent() === event.name ||
    (G.maps as unknown as Record<string, { event?: string } | undefined>)[character.map]?.event === event.name ||
    monsters.some(m => event.types.indexOf(m.mtype) >= 0));
  const socket = (parent as unknown as { socket?: { connected?: boolean } }).socket;
  const scatter = !(character as { cave?: unknown }).cave && facts.farmingMode() === 'scatter';
  return { leader: facts.leader() || character.name, allies, monsters, event: eventCombat ? event!.name : null,
    mode: occupied() || facts.liveAbtesting() ? 'blocked' : eventCombat ? 'event' : scatter ? 'scatter' : 'grouped',
    observedAt: socket && socket.connected ? Date.now() : 0 };
}
