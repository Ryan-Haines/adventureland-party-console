// The survival owner's needs on the character: the potion table, regeneration with A9's wait, and
// the priest's heal choice, each a `skills.request` answer of `core:survival` (registrations.ts).
// The turns executor makes every call; these functions only decide.
import type { HookRegistry, SpendAsk, SurvivalChoiceName } from '../../hooks/registry.ts';
import type { SurvivalEntry } from './records.ts';
import type { Target } from '../turns/api.ts';
import { errorReason, health, type Combatant, type SkillWorld } from '../turns/api.ts';
import { A9_LINE, ESCAPE_SETTLED, HEALTHY_SHARE, REGENERATION_HALF, STOMP_AGGRO, STOMP_ALLY_SHARE, type Lines } from './lines.ts';
import { fresh } from '../../protocol/reports.ts';
import type { Entity } from 'typed-adventureland';

// One character's view for the potion table: its class and vitals, its two lines in whole
// percents, the escape's MP budget while it escapes, the warrior leader's Taunt cost while a monster
// is on the party, the HP the bag's last HP potion gives, and, for a class whose own heal costs MP,
// that heal's cost and the HP it restores.
export interface PotionView {
  ctype: string; hp: number; max_hp: number; mp: number; max_mp: number; lines: Lines;
  escape: { budget: number } | null; tauntCost: number | null; potionGives: number;
  heal?: { cost: number; amount: number } | null;
}
const ratio = (value: number, max: number) => max > 0 ? value / max : 1;
// The potion table: one row order for every class, so no class drinks MP first
// below its HP line. The table reads no stock; the server's `no_item` reply settles a request
// with none in the bag, as today's potion path does.
export function potionChoice(v: PotionView): 'use_hp' | 'use_mp' | null {
  const hpShare = ratio(v.hp, v.max_hp), mpShare = ratio(v.mp, v.max_mp);
  if (hpShare < v.lines.hp / 100) {
    // SRV-Q21 rule 3: a healer with too little MP for its own heal drinks MP first when one heal
    // restores more than its HP potion; the next attack slot then heals.
    if (v.heal && v.mp < v.heal.cost && v.heal.amount > v.potionGives) return 'use_mp';
    return 'use_hp';
  }
  if (v.escape && v.mp < Math.min(v.max_mp, v.escape.budget)) return 'use_mp';
  // SRV-Q21 rule 2: the two potions share one cooldown, so an MP row drinks HP while HP reads the
  // lower share of its maximum.
  const mpRow = (v.tauntCost !== null && v.mp < v.tauntCost) || mpShare < v.lines.mp / 100;
  if (mpRow) return hpShare < mpShare ? 'use_hp' : 'use_mp';
  // The escape tops off HP on every class but the mage, which keeps its potion cooldown for MP
  // (b9b5c91e shared.js `escapePotions`, unchanged).
  if (v.escape && v.ctype !== 'mage' && v.hp < v.max_hp) return 'use_hp';
  if (v.ctype === 'merchant' && v.potionGives > 0 && v.max_hp - v.hp > v.potionGives) return 'use_hp';
  return null;
}
// Today's regeneration order (b9b5c91e shared.js `regenerateHpOrMp`, :13761-13790), for a character
// whose need A9 has not held.
export function regenerationOrder(c: { hp: number; max_hp: number; mp: number; max_mp: number }): 'regen_hp' | 'regen_mp' | null {
  if (ratio(c.hp, c.max_hp) < REGENERATION_HALF) return 'regen_hp';
  if (ratio(c.mp, c.max_mp) < REGENERATION_HALF) return 'regen_mp';
  if (c.hp < c.max_hp) return 'regen_hp';
  if (c.mp < c.max_mp) return 'regen_mp';
  return null;
}

// What a need reads from the turns view, which the executor hands
// every `skills.request` answer.
// `target` is the targeting hook's answer for the pass (`targeting.target`), which the turns
// owner puts in the view before it asks the requests.
export interface NeedsView { character: typeof character; roleLoop: boolean; pulse: boolean; healFirstBelow: number;
  target?: { target: unknown; passing: boolean } | null }
// A party member as the heartbeat reports it (the targeting owner's `targeting.positions`, or the Cave's members).
export interface Member { name: string; ctype?: string; map?: string; in?: string; rip?: boolean; hp: number; max_hp: number; team?: unknown;
  seenAt?: number; kiting?: boolean }
export interface NeedsPorts {
  // The heartbeat list the heal choice starts from (the targeting owner's `targeting.positions`, the Cave's `cavePartyMembers`).
  members(): readonly Member[];
  sameTeam(member: Member): boolean;
  // The escape's stage while one owns the character, else null.
  escapeStage(): string | null;
  // Movement's Town cast in flight, from its send until the server's answer (`movement.townCasting()`).
  townCasting(): boolean;
  // Partyheal goes only outside a live A/B test or under its uniform strategy (the events owner's `partyhealAllowed()`).
  partyhealAllowed(): boolean;
  isLeader(): boolean;
  // A monster that targets a party member, the nearest (the targeting owner's `targeting.partyAttacker`).
  partyAttacker(): unknown;
  // Whether the party is in a fight (`partyUnderAttack` below): targeting's two threat facts
  // (`targeting.threat`) or the hunting owner's farm area (`farming.focus`).
  fighting(): boolean;
  // The two lines as the character's last report reply delivered them.
  lines(): Lines;
  // The card's state the heal booking writes (today's `partyCombatState`).
  state(): Record<string, unknown> | undefined;
  // The emergency Stomp's hold's reads of other owners (`stompHeld` below): the events owner's Franky fight
  // (the events owner's `frankyActive()`) and the party's combat mode (today's `farmingMode`), and the targeting owner's published reads
  // (`targeting.graveyardAreaAllows`, `targeting.rareTarget`, `targeting.unfinished`,
  // `targeting.lockAllows`, `targeting.attacking`; E05-t1).
  // The Stomp's gates ask the targeting owner's published reads (the registry's `ask`).
  stomp?: { franky(): boolean; mode(): string | null | undefined; ask: HookRegistry['ask'] };
  // The warrior kiting its target (shared.js `isCurrentlyKiting`).
  kiting?(): boolean;
  // The party list (shared.js `currentPartyList`).
  roster?(): readonly string[];
  // The party's death recovery phase as the last report reply delivered it (install.ts's record of
  // the reply's `combatRecovery`), or null.
  recoveryPhase?(): string | null;
  // The survival ring (records.ts): a change of the character's verdict.
  ring?(entry: SurvivalEntry): void;
}
type Booking = { accepted?(result: unknown): void; rejected?(error: unknown): void };
// P2 `survival.choice`: an enabled add-on's pick among the options core accepts for one survival
// question, or core's own pick. The registry checks the answer against the options and the
// question's bound (rows/05-survival.ts).
export function chosen<T>(question: SurvivalChoiceName, options: readonly T[], core: T, member = character.name): T {
  const hooks = (globalThis as { __partyHooks?: HookRegistry }).__partyHooks;
  return hooks ? hooks.survival.choice({ question, member, options, core }) : core;
}
type Ask = SpendAsk<Target> & { book?: Booking };

export function createNeeds(ports: NeedsPorts) {
  // A9 within the current fight: whether a fighter has read below the line since
  // the fight began. Out of a fight the mark clears, so the next fight starts with none.
  let dropped = false;
  // The client's own entity for a member when it has one, else the heartbeat's: a hit
  // reaches this client in the next instance update, the heartbeat up to two report gaps later.
  // `seen` marks a member this client has an entity for, the only kind a heal can reach
  // (`can_heal`).
  type Read = { m: Member; seen: boolean };
  function live(member: Member): Read {
    if (member.name === character.name) return { m: character as unknown as Member, seen: true };
    const entity = typeof get_player === 'function' ? get_player(member.name) as unknown as Member | null : null;
    return entity && entity.max_hp > 0 ? { m: entity, seen: true } : { m: member, seen: false };
  }
  // b9b5c91e's member filter (shared.js `healChoice`): same event team, living and on this map, and
  // with `fighters` not the merchant. The live entity checks the merchant again, because a report
  // can carry no class while the client's entity names the merchant (the old `healPartyBelow`'s
  // recheck).
  function onMap(fighters: boolean): Read[] {
    return ports.members().filter(m => m && (!fighters || m.ctype !== 'merchant') && ports.sameTeam(m) && !m.rip &&
      m.map === character.map && m.max_hp > 0).map(live).filter(r => !r.m.rip && r.m.max_hp > 0 && (!fighters || r.m.ctype !== 'merchant'));
  }
  const settled = () => !pulseHeld(ports.escapeStage());
  // The one Town gate: a Town cast in flight, from the send until the server's answer,
  // or its channel (`c.town`). An attack, a heal, partyheal and a Curse end the channel
  // (server.js:3519), and so does any `equip`, a potion's included (:7657), so the potion need, the
  // heal choice, the escape's potion and the escape Curse all hold while it reads true.
  function channelling(): boolean {
    return !!(character.c && (character.c as unknown as Record<string, unknown>).town) || ports.townCasting();
  }
  // A need the server rejected or the executor counted lost: one entry in the survival ring (3.10).
  function refused(skill: string, error: unknown): string {
    const reason = errorReason(error);
    ports.ring?.({ decision: 'refused', skill, reason });
    return reason;
  }
  // The character's own verdict (`survival.verdict({character})`, 3.7): `leave` while an escape
  // owns it outside its settled stages or the party's death recovery escapes, `finish` while that
  // recovery finishes its fight, `fight` otherwise.
  let lastVerdict: 'fight' | 'finish' | 'leave' | null = null;
  function characterVerdict(): 'fight' | 'finish' | 'leave' {
    const phase = ports.recoveryPhase?.() ?? null;
    const verdict = !settled() ? 'leave' : phase === 'finishing' ? 'finish' : phase === 'escaping' ? 'leave' : 'fight';
    if (lastVerdict && verdict !== lastVerdict) ports.ring?.({ decision: 'verdict', verdict, phase, stage: ports.escapeStage() });
    lastVerdict = verdict;
    return verdict;
  }
  // What the bag's last potion of a pool gives, the one `use_hp` or `use_mp` drinks (b9b5c91e
  // shared.js `regenerateHpOrMp`, unchanged; the executor's `potionSlot`), or 0 with none.
  function bagGives(pool: 'hp' | 'mp'): number {
    const c = character;
    for (let slot = (c.items || []).length - 1; slot >= 0; slot--) {
      const item = c.items[slot] as { name: string } | null, def = item ? (G.items as unknown as Record<string, { gives?: [string, number][] }>)[item.name] : undefined;
      const grant = def?.gives?.find(([stat, value]) => stat === pool && value > 0);
      if (grant) return Number(grant[1]);
    }
    return 0;
  }
  // `survival.mpPotion` (the turns owner's TRN-Q-DPS ranking): the MP a potion gives when the potion table drinks
  // MP at `mpAfter` and the potion family is off its cooldown (the client's `next_skill.use_hp`,
  // turns/api.ts `readyKey`), else 0.
  function mpPotion(mpAfter: number): number {
    if (potionChoice({ ...potionView(), mp: mpAfter }) !== 'use_mp') return 0;
    const ready = (parent as unknown as { next_skill?: Record<string, unknown> }).next_skill?.use_hp;
    return Number(ready) > Date.now() ? 0 : bagGives('mp');
  }
  function potionView(): PotionView {
    const c = character, leaderThreat = c.ctype === 'warrior' && ports.isLeader() && !!ports.partyAttacker();
    // The HP potion's grant serves the merchant's row and the healer exception.
    const gives = bagGives('hp');
    // A class game data gives the `heal` skill pays `mp_cost` for it (server.js:3354-3356) and
    // restores its `heal` stat (3355).
    const healer = ((G.skills.heal as unknown as { class?: string[] } | undefined)?.class ?? []).includes(c.ctype);
    return { ctype: c.ctype, hp: c.hp, max_hp: c.max_hp, mp: c.mp, max_mp: c.max_mp, lines: ports.lines(),
      // The escape fills its MP budget for rows 2 and 5 (`escapePotion`).
      escape: null, tauntCost: leaderThreat ? Number(G.skills.taunt?.mp ?? 0) : null, potionGives: gives,
      heal: healer ? { cost: Number(c.mp_cost) || 0, amount: Number((c as { heal?: number }).heal) || 0 } : null };
  }
  // A9: in a fight, regeneration waits once a living fighter on the map read below the line. The
  // fight lasts while `fighting` holds (a monster on a party member, a party member's target in
  // view, or the character in its saved farm area) or the character holds a target to fight from the
  // targeting hook, so the gap between one kill and the next aggro does not end it.
  function regenerationWaits(v: NeedsView): boolean {
    if (!ports.fighting() && !(v.target?.target && !v.target.passing)) { dropped = false; return false; }
    if (!dropped) dropped = onMap(true).some(({ m }) => m.hp / m.max_hp < A9_LINE);
    return dropped;
  }
  // The heal lines (decided 2026-11-05): a member who misses at least the priest's own heal
  // (`character.heal`, the server's amount, server.js:3355) or is below "Heal first below";
  // partyheal when two members each miss at least partyheal's output at the priest's level (game
  // data `partyheal.levels`, server.js:3406-3415) and the HP it restores across the members, each
  // one's missing HP up to that output, is at least one heal's output (decided 2026-11-06), so its
  // 400 MP never buys less healing than a heal gives. Partyheal also goes, whatever the heal, when
  // two members are below "Heal first below": one heal reaches only one of them (decided
  // 2026-11-06).
  function partyhealOutput(): number {
    const def = G.skills.partyheal as unknown as { output?: number; levels?: [number, number][] } | undefined;
    let out = Number(def?.output) || 0;
    for (const [level, value] of def?.levels ?? []) if (Number(character.level) >= level) out = value;
    return out;
  }
  function healChoice(view: { healFirstBelow: number; regularOnly: boolean }): { skill: 'heal' | 'partyheal'; target?: Target; ratio: number; urgent: boolean; reason: string } | null {
    if (character.ctype !== 'priest' || character.rip || channelling()) return null;
    const line = view.healFirstBelow / 100, members = onMap(true).sort((a, b) => a.m.hp / a.m.max_hp - b.m.hp / b.m.max_hp);
    const party = partyhealOutput();
    const pair = members.map(r => r.m).filter(m => m.max_hp - m.hp >= party);
    const restores = members.reduce((sum, { m }) => sum + Math.min(Math.max(0, m.max_hp - m.hp), party), 0);
    const below = members.map(r => r.m).filter(m => m.hp / m.max_hp < line);
    const restoring = pair.length >= 2 && restores >= (Number(character.heal) || 0);
    if (!view.regularOnly && party > 0 && (restoring || below.length >= 2) && ports.partyhealAllowed() &&
        character.mp >= Number(G.skills.partyheal.mp) && !is_on_cooldown('partyheal') && can_use('partyheal')) {
      const low = (restoring ? pair : below)[0]!.hp / (restoring ? pair : below)[0]!.max_hp;
      return { skill: 'partyheal', ratio: low, urgent: low < line,
        reason: restoring ? `two members each missing ${party} HP` : `two members below ${view.healFirstBelow}%` };
    }
    const output = Number(character.heal) || 0;
    // The game's `can_heal` is `can_attack`, which also asks whether the attack cooldown is over
    // (runner_functions.js:834-846). The turns executor owns that cooldown and sends at the family's
    // edge, a little before the client's own timer, so the choice reads only the range half; with
    // `can_heal` the choice was empty at the edge and the attack took the slot (TC1's case).
    const healable = members.filter(({ m, seen }) => seen && (m.max_hp - m.hp >= output || m.hp / m.max_hp < line) &&
      m.hp < m.max_hp && is_in_range(m as unknown as Parameters<typeof is_in_range>[0])).map(r => r.m);
    if (!healable[0]) return null;
    // P2: an add-on may pick another member the heal reaches.
    const target = chosen('heal', healable, healable[0]);
    const share = target.hp / target.max_hp;
    return { skill: 'heal', target: target as unknown as Target, ratio: share, urgent: share < line,
      reason: share < line ? `heal below ${view.healFirstBelow}%` : `heal missing ${output} HP` };
  }
  // `survival.healthy` (X1's root): the priest's Curse waits while a member it can support
  // on this map reads below `share`, from the same client-first HP as the heal choice. Its member
  // filter is today's (b9b5c91e shared.js `isPartyHealthy`), the merchant included.
  function partyHealthy(share = HEALTHY_SHARE): boolean {
    return onMap(false).every(({ m }) => m.hp / m.max_hp >= share);
  }

  // The `potion` need: on every pass, whatever the travel hold
  // (decided 2026-11-05), except inside a Town channel.
  function potion(): Ask | undefined {
    if (!settled() || character.rip || channelling()) return undefined;
    const core = potionChoice(potionView());
    if (!core) return undefined;
    const skill = chosen('potion', ['use_hp', 'use_mp'] as const, core);
    return { skill, rank: 'survival', category: 'survival', reason: skill === 'use_hp' ? 'HP potion' : 'MP potion', book: { rejected(error) {
      // Missing potions fall through to free regeneration without flooding the game log.
      const reason = refused(skill, error);
      if (!['cooldown', 'not_ready', 'no_item', 'not_found', 'full', 'waiting', 'lost reply'].includes(reason)) game_log('Potion failed: ' + reason, 'red');
    } } };
  }
  // The `regeneration` need: on the role loop and on the passive pulse while it is eligible, as
  // today, with A9's wait in front. Rank `maintenance`, so a due potion of the table goes first.
  function regeneration(v: NeedsView): Ask | undefined {
    if (!v.roleLoop && !v.pulse) return undefined;
    if (!settled() || character.rip || regenerationWaits(v)) return undefined;
    const core = regenerationOrder(character);
    if (!core) return undefined;
    const skill = chosen('regen', ['regen_hp', 'regen_mp'] as const, core);
    return { skill, rank: 'maintenance', category: 'maintenance', reason: 'regeneration', book: { rejected(error) {
      // A failed recovery must not prevent potions, healing, or combat later in the loop.
      const reason = refused(skill, error);
      if (!['cooldown', 'not_ready', 'no_mp', 'waiting', 'lost reply'].includes(reason)) game_log('Recovery failed: ' + reason, 'red');
    } } };
  }
  // The `heal` need: below "Heal first below" it asks on every pass, whatever the travel hold, at
  // `survival`, which outranks the basic attack at the attack family's edge (A7); above it, a
  // top-off at `maintenance` on the role loop and the pulse, as today. Partyheal has its own
  // cooldown family and the heal shares the attack's (game data `heal.share`), so a pass that asks
  // partyheal also asks the single heal: with partyheal alone the attack family had no heal request,
  // and the attack took its edge while a member read below "Heal first below" (the gate runs' TC1
  // and SV8, every other tick while partyheal's 200 ms cooldown was free).
  function heal(v: NeedsView): Ask[] | undefined {
    if (character.ctype !== 'priest' || !settled()) return undefined;
    const regularOnly = v.pulse && !v.roleLoop, first = healChoice({ healFirstBelow: v.healFirstBelow, regularOnly });
    const single = first?.skill === 'partyheal' ? healChoice({ healFirstBelow: v.healFirstBelow, regularOnly: true }) : null;
    const asks = [first, single].filter((c): c is NonNullable<typeof c> => !!c && (c.urgent || v.roleLoop || v.pulse)).map(healAsk);
    return asks.length ? asks : undefined;
  }
  function healAsk(choice: NonNullable<ReturnType<typeof healChoice>>): Ask {
    return { skill: choice.skill, targets: choice.target ? [choice.target] : [], rank: choice.urgent ? 'survival' : 'maintenance', category: 'survival', reason: choice.reason,
      book: { accepted() {
        const s = ports.state(), at = Date.now();
        if (!s || choice.skill !== 'heal') return;
        s.lastHealAt = at;
        s.lastHealTarget = (choice.target as { name?: string } | undefined)?.name || choice.target?.id;
        if (Number(s.errorAt || 0) <= at) s.error = null;
      },
      // A refused heal shows on the card, as the console's heal always has; a `cooldown` reply resends
      // and a wait or a lost reply asks again, so neither is an error.
      rejected(error) {
        const s = ports.state(), reason = refused(choice.skill, error);
        if (!s || choice.skill !== 'heal' || ['cooldown', 'waiting', 'lost reply', 'stale'].includes(reason)) return;
        s.error = reason;
        s.errorAt = Date.now();
      } } };
  }
  // The emergency Stomp's hold (b9b5c91e shared.js `emergencyStompHeld`): other owners' gates as
  // they read today (Franky's fight, the graveyard area, a tinyp rare, scatter) and survival's
  // grouped hold on a neutral monster: in an unfinished fight, a monster in Stomp's range that is
  // not the group's lock target and targets no party member (decided 2026-11-06). The lock names
  // one target, so a hold on every monster but the lock held the Stomp whenever two monsters were
  // on the warrior. True holds the Stomp.
  function stompHeld(range: number): boolean {
    const gates = ports.stomp;
    if (!gates) return false;
    if (gates.franky()) return true;
    if (!gates.ask('targeting.graveyardAreaAllows', range)) return true;
    if ((gates.ask('targeting.rareTarget') as { mtype?: string } | null)?.mtype === 'tinyp') return true;
    if (gates.mode() === 'scatter') return true;
    return !!gates.ask('targeting.unfinished') && Object.values((parent as unknown as { entities?: Record<string, Entity> }).entities ?? {})
      .some(e => !!e && e.type === 'monster' && !!e.visible && !e.dead && !gates.ask('targeting.lockAllows', e) && !gates.ask('targeting.attacking', e) &&
        Math.hypot(e.x - character.x, e.y - character.y) <= range);
  }
  // The emergency Stomp: today's `emergencyWarriorStomp` as a `survival` request of
  // the stomp family. Its danger test is SRV-Q13's (lines.ts): two monsters on the warrior, the
  // warrior kiting, or an ally whose report is fresh by the `recent` reading (5000 ms, 02 CF2)
  // reading below 60% (live HP when this client sees it) or kiting. Game data gives the Stomp its
  // range. The executor checks the MP, the cooldown and the band; a fired Stomp no longer ends the
  // warrior's tick.
  function stompWanted(): boolean {
    const c = character, skill = G.skills.stomp as unknown as { range?: number } | undefined;
    if (c.ctype !== 'warrior' || c.rip || !skill) return false;
    const range = Number(skill.range);
    if (stompHeld(range)) return false;
    // can_use checks class and cooldown, not weapon compatibility.
    const weapon = (c.slots as unknown as Record<string, { name: string } | null> | undefined)?.mainhand;
    if (!weapon || (G.items as unknown as Record<string, { wtype?: string }>)[weapon.name]?.wtype !== 'basher') return false;
    const roster = ports.roster?.() ?? [];
    const monsters = Object.values((parent as unknown as { entities?: Record<string, { type?: string; dead?: boolean; visible?: boolean; target?: string; x: number; y: number }> }).entities ?? {})
      .filter(e => !!e && e.type === 'monster' && !e.dead && !!e.visible);
    const danger = monsters.filter(e => e.target === c.name).length >= STOMP_AGGRO || !!ports.kiting?.() || ports.members().some(member => {
      if (!member || member.name === c.name || !roster.includes(member.name) || member.rip || member.map !== c.map || !ports.sameTeam(member) ||
          member.in != null && c.in != null && member.in !== c.in || !fresh(Number(member.seenAt || 0), Date.now(), 'recent')) return false;
      const hp = (typeof get_entity === 'function' ? get_entity(member.name) as unknown as Member | null : null) || member;
      return !hp.rip && (hp.max_hp > 0 && hp.hp / hp.max_hp < STOMP_ALLY_SHARE || !!member.kiting);
    });
    // Stomp spends MP only with an enemy in range on the warrior or the party. P2: an add-on may
    // Stomp where core would not; it never skips core's Stomp.
    const core = danger && monsters.some(e => Math.hypot(e.x - c.x, e.y - c.y) <= range && (e.target === c.name || roster.includes(String(e.target))));
    return chosen('stomp', core ? [true] : [false, true], core);
  }
  // The `stomp` need: on the role loop's pass, where b9b5c91e's tick asked it through `beforeTarget`.
  function stomp(v: NeedsView): Ask | undefined {
    if (!v.roleLoop || !stompWanted()) return undefined;
    return { skill: 'stomp', rank: 'survival', category: 'survival', reason: 'emergency Stomp', book: { rejected: error => { refused('stomp', error); } } };
  }
  // Scare before leaving: a character holding a jacko Scares the monsters that target it once
  // its verdict is `leave`. The server scares only non-immune monsters whose target is the caster
  // (server.js:10711-10734), so each monster's own `target` is the condition. Rank `task` (the rank
  // table's spend note).
  function scareWanted(): boolean {
    const c = character, orb = (c.slots as unknown as Record<string, { name: string } | null> | undefined)?.orb;
    if (c.rip || orb?.name !== 'jacko' || !G.skills.scare) return false;
    // P2: an add-on may Scare where core would not; it never skips core's Scare.
    const core = characterVerdict() === 'leave' && Object.values((parent as unknown as { entities?: Record<string, { type?: string; dead?: boolean; visible?: boolean; target?: string }> }).entities ?? {})
      .some(e => !!e && e.type === 'monster' && !e.dead && e.visible !== false && e.target === c.name);
    return chosen('scare', core ? [true] : [false, true], core);
  }
  function scare(): Ask | undefined {
    if (!scareWanted()) return undefined;
    return { skill: 'scare', rank: 'task', category: 'survival', reason: 'Scare before leaving', book: { rejected: error => { refused('scare', error); } } };
  }
  // The escape's potion rows: the table with the escape's MP budget.
  function escapePotion(budget: number): 'use_hp' | 'use_mp' | null {
    return potionChoice({ ...potionView(), escape: { budget } });
  }
  return { potion, regeneration, heal, stomp, scare, scareWanted, characterVerdict, escapePotion, healChoice, partyHealthy, potionView, mpPotion, channelling, stompHeld, lines: () => ports.lines() };
}
export type Needs = ReturnType<typeof createNeeds>;

// The danger model: the damage a monster set aims at a
// character per second, whether a protection transfer keeps the caster alive, and whether an ally is
// in danger. The turns owner's skill engine reads them through runtime/characters/survival/api.ts
// for its protection casts and its pull check; survival decides what danger is.
export function incomingDps(w: SkillWorld, actor: Combatant, extraTarget?: string): number {
  return w.context.monsters.filter(m => m.target === actor.name || !!extraTarget && m.target === extraTarget)
    .reduce((sum, m) => {
      if (!Number.isFinite(m.attack) || !Number.isFinite(m.frequency)) return Infinity;
      const defense = m.damage_type === 'magical' ? actor.resistance : actor.armor;
      return sum + m.attack * Number(m.frequency) * w.damageMultiplier(Number(defense) || 0) * 1.1;
    }, 0);
}
export function safeTransfer(w: SkillWorld, source: Combatant, fraction = 1): boolean {
  if (w.now - w.context.observedAt > 1500) return false;
  const current = incomingDps(w, w.actor);
  const added = fraction === 1 ? incomingDps(w, w.actor, source.name) - current : incomingDps(w, source) * fraction;
  const core = w.actor.hp - 2 * (current + added) > w.actor.max_hp * .3;
  // P2: an add-on may refuse a transfer core finds safe, never the reverse.
  return chosen('transfer', core ? [true, false] : [false], core, w.actor.name);
}
export function endangered(w: SkillWorld, ally: Combatant): boolean {
  const dps = incomingDps(w, ally);
  const core = dps > 0 && (health(ally) < .6 || ally.hp - 2 * dps < ally.max_hp * .3);
  // P2: an add-on may raise an ally's danger, never lower it.
  return chosen('danger', core ? [true] : [false, true], core, ally.name);
}

// The passive pulse's tick (b9b5c91e shared.js `passiveRegenerationTick`) waits while an escape owns
// the character outside its settled stages; otherwise the turns owner runs its pulse pass, whose the
// spend table pulse column decides whether regeneration and the top-off heal ask.
export function pulseHeld(escapeStage: string | null): boolean {
  return escapeStage !== null && !(ESCAPE_SETTLED as readonly string[]).includes(escapeStage);
}

// Whether the party is in a fight, the fact A9's regeneration wait reads. The two threat facts are
// targeting's answer (`targeting.threat`): a monster this client sees targets a party member, or a
// party member's reported target is alive in view. The farm half is `atFarm`: the farm holds a farm's
// kills together for every member, since between two kills neither threat fact holds until the next
// monster turns on the party.
export function partyUnderAttack(farm: () => boolean, ask: () => unknown): boolean {
  const threat = ask() as { attacking?: boolean; partyTarget?: boolean } | undefined;
  return !!threat?.attacking || !!threat?.partyTarget || farm();
}

type Body = Pick<Entity, 'x' | 'y'> & { name?: string; map?: string; in?: string; rip?: unknown; seenAt?: unknown };
// The farm fact over the hunting owner's `farming.focus`: the farm scope, its area and its search radius. The build
// added it; b9b5c91e regenerated by HP and MP share alone (shared.js
// `passiveRegenerationEligible`, :13810-13820).
export interface FarmPorts {
  scope(): { map?: string } | null | undefined;
  roster(): readonly string[];
  reports(): readonly Body[];
  // The coordinator's clock difference, which a report's `seenAt` is stamped on.
  clockOffset(): number;
  reportGap(): number;
  inFarmArea(entity: Body, scope: object): boolean;
  inFarmRadius(entity: Body): boolean;
}
// The character, or a party member, stands where its farm's targets come from: inside the saved farm
// area, or within the search radius of its spot. A priest supports from its range, beyond that area,
// so the member it supports places it at the farm. A member this client holds no entity for counts
// from its own report while it is fresh by the `walk` reading (A20, two report gaps), the source the
// heal choice reads for an unseen member (decided 2026-11-06).
export function atFarm(p: FarmPorts): boolean {
  const scope = p.scope();
  if (!scope || scope.map && scope.map !== character.map) return false;
  const now = Date.now() + p.clockOffset(), walk = { reading: 'walk' as const, attackerKnown: false, intervalMs: p.reportGap() };
  const bodies = p.roster().map((name): Body | null => {
    if (name === character.name) return null;
    const seen = get_player(name);
    if (seen) return seen;
    const report = p.reports().find(r => !!r && r.name === name);
    return report && fresh(Number(report.seenAt), now, walk) ? report : null;
  });
  const self: Body = character;
  return [self, ...bodies].some(e => !!e && !e.rip && (p.inFarmArea(e, scope) || p.inFarmRadius(e)));
}
