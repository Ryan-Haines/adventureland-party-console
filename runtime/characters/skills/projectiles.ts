import type { SkillWorld } from './types.ts';

/** Wire payload deliberately remains local: an action is not a full Entity. */
interface Action { pid?: string; attacker?: string; target?: string; damage?: number; eta?: number; type?: string }
function usable(data: Action): boolean {
  return !!data.pid && !!data.target && Number(data.damage) > 0 && Number(data.eta) > 0;
}
export function createProjectileTracker(world: () => SkillWorld) {
  const flights = new Map<string, { target: string; amount: number; until: number }>();
  function prune(now: number) { for (const [id, p] of flights) if (p.until <= now) flights.delete(id); }
  return {
    action(data: Action) {
      const w = world(); prune(w.now);
      if (!usable(data)) return;
      if (!w.context.allies.some(a => a.name === data.attacker || a.id === data.attacker)) return;
      const target = w.context.monsters.find(t => t.id === data.target);
      if (!target) return;
      // Action.damage is pre-mitigation. Use a conservative physical estimate
      // for unknown action types instead of treating it as guaranteed HP loss.
      const definition = Object.entries(w.skills).find(([id]) => id === data.type)?.[1];
      const defense = definition?.damage_type === 'magical' ? target.resistance : target.armor;
      const factor = definition?.damage_type === 'pure' ? 1 : w.damageMultiplier(Number(defense) || 0);
      flights.set(data.pid!, { target: data.target!, amount: Number(data.damage) * factor * .9, until: w.now + Number(data.eta) });
    },
    hit(data: { pid?: string }) { if (data.pid) flights.delete(data.pid); },
    incoming(target: string, now: number) {
      prune(now);
      return [...flights.values()].filter(p => p.target === target).reduce((n, p) => n + p.amount, 0);
    },
    clear() { flights.clear(); },
  };
}
