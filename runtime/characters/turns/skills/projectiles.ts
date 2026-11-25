import type { SkillWorld } from './types.ts';

/** Wire payload deliberately remains local: an action is not a full Entity. */
interface Action { pid?: string; attacker?: string; target?: string; damage?: number; eta?: number; type?: string }
function usable(data: Action): boolean {
  return !!data.pid && !!data.target && Number(data.damage) > 0 && Number(data.eta) > 0;
}
// `notify` tells `skills.shot` when a flight joins and `skills.landed` when its hit removes it (Q5
// part 2), so a listener counts the tracker's packets against the server's own.
type Told = (hook: 'skills.shot' | 'skills.landed', payload: Record<string, unknown>) => void;
export function createProjectileTracker(world: () => SkillWorld, notify: Told = () => undefined) {
  // Each entry keeps its attacker, so targeting's overkill skip counts the character's own hits
  // only. A flight lasts until its `hit` packet: the server resolves a projectile at its eta at the
  // earliest (server.js `projectiles_loop` puts it back while its instance is frozen or a pause moved
  // the eta) and answers a dead or moved target with a miss or an avoid, so the eta is no end. The
  // client hears no ally's hit for a target that left its view, so `gone` ends the allies' flights
  // on it. The server sends the attacker its own hit wherever the target stands (server.js:4409), so
  // `gone` keeps the character's own flights until their hit. A map the client left ends every
  // flight (`clear`).
  const flights = new Map<string, { target: string; attacker: string; amount: number }>();
  return {
    action(data: Action) {
      if (!usable(data)) return;
      const w = world();
      if (!w.context.allies.some(a => a.name === data.attacker || a.id === data.attacker)) return;
      const target = w.context.monsters.find(t => t.id === data.target);
      if (!target) return;
      // Action.damage is pre-mitigation. Use a conservative physical estimate
      // for unknown action types instead of treating it as guaranteed HP loss.
      const definition = Object.entries(w.skills).find(([id]) => id === data.type)?.[1];
      const defense = definition?.damage_type === 'magical' ? target.resistance : target.armor;
      const factor = definition?.damage_type === 'pure' ? 1 : w.damageMultiplier(Number(defense) || 0);
      const amount = Number(data.damage) * factor * .9;
      flights.set(data.pid!, { target: data.target!, attacker: String(data.attacker), amount });
      notify('skills.shot', { projectile: data.pid, target: data.target, damage: amount, attacker: data.attacker, by: 'core:turns' });
    },
    hit(data: { pid?: string; kill?: boolean; dead?: boolean; miss?: boolean; evade?: boolean; avoid?: boolean }) {
      const flight = data.pid ? flights.get(data.pid) : undefined;
      if (!flight) return;
      flights.delete(data.pid!);
      // The hit packet's own outcome rides along, so a listener reads the kill and the miss from the
      // notice (Q6.2: the spend log keeps no socket listener of its own).
      notify('skills.landed', { projectile: data.pid, target: flight.target, damage: flight.amount, attacker: flight.attacker,
        kill: !!(data.kill || data.dead), miss: !!(data.miss || data.evade || data.avoid), by: 'core:turns' });
    },
    // The target's `disappear`: the allies' flights on it land where this client hears nothing.
    gone(target: string) {
      const { actor } = world(), own = [actor.name, actor.id].filter(Boolean).map(String);
      for (const [id, p] of flights) if (p.target === target && !own.includes(p.attacker)) flights.delete(id);
    },
    // With an attacker named, the sum counts that attacker's hits only.
    incoming(target: string, attacker?: string) {
      return [...flights.values()].filter(p => p.target === target && (attacker === undefined || p.attacker === attacker)).reduce((n, p) => n + p.amount, 0);
    },
    clear() { flights.clear(); },
  };
}
