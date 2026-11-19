import type { CombatRoot, Target } from '../role-types.ts';
import type { DamageType } from 'typed-adventureland';
import { createSkillEngine, type SkillPorts } from './engine.ts';
import { decision, type Actor, type Combatant, type CombatContext, type SkillDefinition, type SkillDecision, type SkillId, type SkillWorld, type Spending,
  type SupportSet, type TurnsReport } from './types.ts';
import { speedSupport } from './ranking.ts';
import { readyKey, type Skills } from '../api.ts';
import { handling } from './server.ts';
import { pullSafe } from './eligibility.ts';
import { createProjectileTracker } from './projectiles.ts';
import { createMonsterTable } from './context.ts';
import type { Registration } from '../../../hooks/registry.ts';
import { scope } from '../../../lifecycle/api.ts';
import { damageMultiplier } from '../../../protocol/hold-check.ts';

interface Host {
  draws?: number;
  damage_multiplier?(this: void, defense: number): number;
  is_disabled?(actor: Actor): boolean;
  next_skill?: Partial<Record<SkillId, Date>>;
  socket?: { connected: boolean;
    on?(event: string, listener: (data: object) => void): void;
    off?(event: string, listener: (data: object) => void): void;
  };
  entities: Record<string, Combatant>;
  G: typeof G;
}
// The class decisions' cast path: the engine's readiness of a decision, and
// its push into the turns executor, which answers true on the server's acceptance.
export interface ClassCasts {
  ready(id: SkillId, target: Target | null, category: Spending): boolean;
  cast(id: SkillId, target: Target | null, category: Spending, argument?: string | number): Promise<boolean>;
}
// `turns` is the turns executor: its ledger, and the push a class decision's cast
// goes through, which settles on the server's reply. The targeting owner answers three of its reads
//: `allows`, the target gates of `targeting.allows`;
// `damageType`, the character's attack type; and `aggroOwner`, the member `targeting.aggroOwner`
// names. With no answer a target passes, the actor keeps its native type and the leader owns aggro.
export interface SkillRuntimePorts {
  ledger: SkillPorts['ledger'];
  push(d: SkillDecision): Promise<boolean>;
  allows?(target: Combatant, skill: SkillId): string | undefined;
  damageType?(): DamageType | undefined;
  aggroOwner?(leader: string): string | undefined;
  // The targeting owner's threat fact (`targeting.attacking`) for the urgent area cast.
  attacking?(target: Combatant): boolean;
  // The ranking's doors (TRN-Q-DPS): the survival owner's `survival.mpPotion` and `survival.healthy`, the targeting owner's
  // `targeting.pullOnly`, and the movement owner's combat step (`movement.step`) for a better spot.
  mpPotion?(mpAfter: number): number;
  healthy?(): boolean;
  // What the bag's potion of a pool gives, the one `use_hp` or `use_mp` drinks, or 0 with none (the
  // potion grant read, design/pm-03.md cause 4). With no answer the report carries no potion trade.
  potionGives?(pool: 'hp' | 'mp'): number;
  pullOnly?(target: Combatant, skill: SkillId): boolean;
  step?(to: { x: number; y: number }, target: string): void;
  // The party's status reports with each member's turns report (TRN-Q-DPS DPS-3, DPS-4), the
  // offset from this character's clock to the coordinator's that the reports' times use, and the
  // support casts the class role sets now (mage.ts's Energize).
  reports?(): { name: string; turns?: TurnsReport }[];
  clockOffset?(): number;
  support?(): Partial<Record<SkillId, SupportSet>>;
  // The combat context (context.ts), built on a world's first read of it.
  context(): CombatContext;
  // The projectile tracker's notices.
  notify?(hook: 'skills.shot' | 'skills.landed', payload: Record<string, unknown>): void;
}
// The turns owner's damage in flight:
// `core:skills` answers `skills.incoming` from the installed runtime's projectile tracker, which
// targeting's overkill skip asks with the character's own name. Each install publishes it with its
// own tracker's answer in hand (the registry's `publish`, as `core:turns` is),
// so a CODE reload's new install answers through the same registration.
export function skillsRegistration(incoming: (target: string, attacker?: string) => number): Registration {
  return { name: 'core:skills', folder: 'core', author: 'adventureland-party-console',
    summary: 'Counts the damage each party hit in flight will do when it lands.',
    hooks: { 'skills.incoming': (target, attacker) => incoming(String(target), attacker) } };
}
interface Hooks { publish(registration: Registration): { ok: boolean; message?: string } }
export function installSkillRuntime(root: CombatRoot, turns: SkillRuntimePorts, hooks?: Hooks) {
  const host = parent as unknown as Host;
  const shared = root.sharedRoutine;
  const projectiles = createProjectileTracker(world, turns.notify);
  // The world whose target `authorized` asks about, so the gate judges with the engine's own world.
  let asking: SkillWorld | null = null;
  function world(): SkillWorld {
    // Normalize the local skill world, never mutate the native player object.
    // Offensive skill definitions retain their own damage_type precedence.
    const actor: Actor = { ...character, damage_type: turns.damageType ? turns.damageType() : (character as Actor).damage_type };
    // combatContext copies every visible monster, the largest console self
    // time in a fighter thread. busy(), attack() for
    // classes without attack skills and projectile pruning never read it, so
    // world() builds it on the first read and keeps it for this world.
    let context: CombatContext | undefined;
    const build = (): CombatContext => {
      const built = turns.context();
      if (host.is_disabled?.(actor)) built.mode = 'blocked';
      return built;
    };
    const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
    // Targeting's gate answer per target and skill for this world. The ranking asks the same pair
    // once per candidate spot (each spot's area hits ask every monster again), and the context's
    // monsters stay one snapshot for the world's life.
    const allowedBy = new Map<string, boolean>();
    const result: SkillWorld = {
      actor, get context() { return context ??= build(); }, skills, now: Date.now(),
      item: name => (G.items as Record<string, { wtype?: string; type?: string; charge?: number }>)[name],
      condition: name => (G.conditions as Record<string, ReturnType<SkillWorld['condition']>>)[name],
      cooldown: id => id === 'invis' && !!root.partyMerchant?.jobs.visibilityActive() || Number(host.next_skill?.[id]) > Date.now(),
      damageMultiplier: host.damage_multiplier || damageMultiplier,
      incoming: t => projectiles.incoming(t.id, Date.now()),
      range: (t, id) => skillRange(actor, t, skills[id], id),
      attacking: t => !!turns.attacking?.(t),
      allowed: (t, id) => {
        const key = `${t.id}|${id}`, known = allowedBy.get(key);
        if (known !== undefined) return known;
        const answer = authorized(result, t, id);
        allowedBy.set(key, answer);
        return answer;
      },
      get aggroOwner() { return turns.aggroOwner?.(this.context.leader); },
      mpPotion: mp => turns.mpPotion?.(mp) ?? 0,
      healthy: () => turns.healthy?.() ?? true,
      pullOnly: (t, id) => !!turns.pullOnly?.(t, id),
      // The reports' ready times move from the coordinator's clock to this character's.
      reports: () => (turns.reports?.() ?? []).map(r => r.turns ? { name: r.name, turns: { ...r.turns,
        support: Object.fromEntries(Object.entries(r.turns.support || {}).map(([id, e]) => [id, e && { ...e, readyAt: e.readyAt - offset() }])) } } : r),
      support: () => turns.support?.() ?? {},
    };
    return result;
  }
  const offset = () => Number(turns.clockOffset?.()) || 0;
  // This character's turns report for its status report (TRN-Q-DPS DPS-3, DPS-4): the ranking's damage
  // per MP at its last edge, and each speed support cast's ready time from the game's `next_skill`
  // in the coordinator's clock, with the target and MP the class role sets now, or no target.
  function report(): TurnsReport {
    const w = world(), sets = w.support?.() ?? {};
    const heals = ((G.skills.heal as { class?: string[] } | undefined)?.class ?? []).includes(character.ctype);
    const healPerMp = heals && Number(character.mp_cost) > 0 ? Number(Reflect.get(character, 'heal')) / Number(character.mp_cost) || 0 : 0;
    const hpPotion = Number(turns.potionGives?.('hp')) || 0, potionMpPerHp = hpPotion > 0 ? (Number(turns.potionGives?.('mp')) || 0) / hpPotion : 0;
    return { damagePerMp: engine.perMp(), ...(healPerMp ? { healPerMp } : {}), ...(potionMpPerHp ? { potionMpPerHp } : {}), support: Object.fromEntries(speedSupport(w).map(id => {
      const at = Number(host.next_skill?.[readyKey(G.skills as unknown as Skills, id) as SkillId]) || 0;
      return [id, { readyAt: Math.max(w.now, at) + offset(), target: sets[id]?.target ?? null, mp: sets[id]?.mp ?? 0 }];
    })) };
  }
  // A hostile target passes when targeting's gates allow the skill on it.
  function authorized(w: SkillWorld, t: Combatant, id: SkillId): boolean {
    asking = w;
    try { return !turns.allows?.(t, id); } finally { asking = null; }
  }
  const engine = createSkillEngine({
    world,
    publishAfterCast: d => {
      const skills: Partial<Record<SkillId, SkillDefinition>> = G.skills;
      return !!skills[d.skill]?.hostile && d.targets.length > 0 &&
        d.targets.every(t => shared.targeting.independentPullActive(t as Target));
    },
    evidence: (t, state, action) => shared.targeting.queueEvidence(t as Target, state, action) || null,
    diagnostic: d => { if (root.partyCombatState) root.partyCombatState.skill = d; },
    ledger: turns.ledger,
    position: move => turns.step?.(move.to, move.target),
  });
  // The class decisions: Curse, Energize, Stomp, Dash and Taunt go through
  // the engine's checks and the class reserve, then the turns executor's push. A cast with no
  // target, such as Stomp or Dash, passes null; Energize passes its amount.
  const classDecision = (id: SkillId, target: Target | null, category: Spending, argument?: string | number): SkillDecision =>
    ({ ...decision(id, target ? [target] : [], category), ...(argument === undefined ? {} : { argument }) });
  const casts: ClassCasts = {
    ready: (id, target, category) => engine.ready(classDecision(id, target, category)),
    cast(id, target, category, argument) {
      const d = classDecision(id, target, category, argument);
      return engine.ready(d) ? turns.push(d) : Promise.resolve(false);
    },
  };
  // The combat context's monster entries (context.ts `createMonsterTable`), told which monsters each
  // world packet changes at the game's update count it arrived in (game.js `draw` counts `draws`).
  const monsters = createMonsterTable(), update = () => Number(host.draws);
  const action = (data: object) => projectiles.action(data);
  const hit = (data: object) => { projectiles.hit(data); monsters.changed([(data as { id?: unknown }).id], update()); };
  const entities = (data: { type?: string; monsters?: ({ id?: unknown } | null)[] } | null) => {
    if (data?.type === 'all') monsters.clear(); else monsters.changed((data?.monsters ?? []).map(m => m?.id), update());
  };
  const newMap = () => monsters.clear();
  // The projectile records and the monster table's packets are the turns owner's `observe` registrations: they only
  // record, so the incoming damage and the table are current at Play.
  const observe = scope('03', 'observe'), socket = host.socket as Parameters<typeof observe.on>[0];
  observe.on(socket, 'action', action as (data: unknown) => void);
  observe.on(socket, 'hit', hit as (data: unknown) => void);
  observe.on(socket, 'entities', entities as (data: unknown) => void);
  observe.on(socket, 'new_map', newMap);
  const incoming = (target: string, attacker?: string) => projectiles.incoming(target, Date.now(), attacker);
  if (hooks) {
    const result = hooks.publish(skillsRegistration(incoming));
    if (!result.ok) throw Error(`The turns owner's core:skills did not load: ${result.message}`);
  }
  // The scatter pull check, the last gate of today's `authorized` (eligibility.ts `pullSafe`).
  return { ...engine, world, casts, pullSafe: (w: SkillWorld, t: Combatant) => pullSafe(w, [t]), incoming, report, monsters,
    // The world targeting's skill gate judges with: the engine's while it asks, else a fresh one.
    gateWorld: (): SkillWorld => asking ?? world(),
    reset() { engine.reset(); projectiles.clear(); },
    stop() {
      projectiles.clear();
      observe.off(socket, 'action', action as (data: unknown) => void); observe.off(socket, 'hit', hit as (data: unknown) => void);
      observe.off(socket, 'entities', entities as (data: unknown) => void); observe.off(socket, 'new_map', newMap);
      monsters.clear();
    },
  };
}
// The game's range: the skill's range, or the character's, with its multiplier and bonus
// (runner_functions.js:812-824).
export function skillRange(actor: Actor, target: Combatant, s?: SkillDefinition, id?: SkillId): boolean {
  if (!s) return false;
  const base = s.use_range ? actor.range : s.range || actor.range;
  const range = base * (s.range_multiplier || 1) + (s.range_bonus || 0);
  const distanceTo = typeof distance === 'function' ? distance(actor, target) : Math.hypot(actor.x - target.x, actor.y - target.y);
  // The server takes a caster-centred skill's monsters strictly inside the range (server.ts;
  // node/server.js `cleave`, `stomp`, `agitate`: `dist < gSkill.range`).
  return id && handling(id).area === 'caster' ? distanceTo < range : distanceTo <= range;
}
