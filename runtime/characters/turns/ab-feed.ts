// The A/B feed: on the A/B
// test's feed side the role loop runs this in place of the class decisions. Each cast asks
// the executor's readiness (`spendReady`) and pushes at `damage`, so the executor's one MP rule
// decides: the heal goes at any MP as the server allows, and Energize and the Curse keep the
// class reserve. A rejected
// cast lets the feed move on, as before. The executor asks no target rule for the feed's pushes
//. The A/B mode, the teams and the walks are today's, read through the
// stand-in ports (S-06c).
import type { Target } from './role-types.ts';
import type { TurnsFacts } from './stand-ins/holds.ts';
import type { CoreAsk, Readiness } from './api.ts';
import { eventFacts } from '../../events/api.ts';
import { HEALTHY_SHARE } from '../survival/api.ts';
import { energizeAmount } from './classes/mage.ts';

// The feeder's follow walk: it steps toward its target while farther than `FOLLOW_DISTANCE`
// (b9b5c91e shared.js:13178), and toward the enemy spawn while farther than `SPAWN_ARRIVAL`
// (:13183). Each is the distance the walk counts as arrived, not a skill's reach.
const FOLLOW_DISTANCE = 20, SPAWN_ARRIVAL = 30;

type Player = Target & { name: string; type?: string; visible?: boolean; rip?: boolean; dead?: boolean; in?: string | number;
  mp: number; max_mp: number; hp: number; max_hp: number; attack?: number; s?: { cursed?: unknown } };
export interface FeedPorts {
  facts: TurnsFacts;
  spend(ask: CoreAsk & { by: string }): Promise<unknown>;
  ready(skill: string): Readiness;
  setTargetId(id: string | null, by: string): void;
  // The card's combat state, replaced whole as today.
  setState(state: Record<string, unknown>): void;
}
export function createAbFeed(ports: FeedPorts) {
  const { facts } = ports;
  const team = (entity: unknown) => facts.feed.team(entity);
  function feedPush(skill: string, target: Player, amount?: number): Promise<boolean> {
    return ports.spend({ skill, targets: [target], argument: amount, rank: 'damage', category: 'damage', by: 'core:turns/ab-feed', reason: 'A/B feed ' + skill })
      .then(() => true, () => false);
  }
  // A cast of the turns owner's that is ready and the MP covers.
  function spendReady(skill: string): boolean {
    const answer = ports.ready(skill);
    return answer.ready && character.mp >= answer.cost;
  }
  async function sabotageSkill(enemies: Player[]): Promise<boolean> {
    if (character.ctype === 'mage' && spendReady('energize')) {
      const manaTargets = enemies.filter(target => target.max_mp > 0 && target.mp < target.max_mp && is_in_range(target, 'energize'))
        .sort((a, b) => a.mp / a.max_mp - b.mp / b.max_mp || a.mp - b.mp);
      if (manaTargets.length) {
        const manaTarget = manaTargets[0]!, available = Math.floor(character.mp - ports.ready('energize').reserve);
        const amount = energizeAmount(manaTargets, manaTarget, available);
        if (amount > 0 && await feedPush('energize', manaTarget, amount)) return true;
      }
    }
    if (character.ctype === 'priest' && spendReady('heal')) {
      // An enemy below survival's healthy share is one a heal helps (b9b5c91e's 0.9, the same line).
      const injured = enemies.filter(target => target.max_hp > 0 && target.hp / target.max_hp < HEALTHY_SHARE && is_in_range(target, 'heal'))
        .sort((a, b) => a.hp / a.max_hp - b.hp / b.max_hp);
      if (injured.length && await feedPush('heal', injured[0]!)) return true;
    }
    if (character.ctype === 'priest' && spendReady('curse')) {
      const ownTeam = (Object.values(parent.entities || {}) as unknown as Player[]).filter(target =>
        target && target.type === 'character' && target.visible !== false && !target.rip && target.name !== character.name &&
        team(target) === team(character) && !(target.s && target.s.cursed) && is_in_range(target, 'curse'))
        .sort((a, b) => (Number(b.attack) || 0) - (Number(a.attack) || 0));
      // A refused Curse lets the feed move on toward the enemy.
      if (ownTeam.length && await feedPush('curse', ownTeam[0]!)) return true;
    }
    return false;
  }
  // One feed turn: a cast on the enemy team, else a walk toward it or its spawn.
  async function run(): Promise<boolean> {
    const strategy = facts.feed.strategy();
    if (eventFacts().abtestingMode() !== 'feed' || !strategy) return false;
    ports.setTargetId(null, 'core:turns/ab-feed');
    const majority = new Set(strategy.majorityNames || []);
    const enemies = (Object.values(parent.entities || {}) as unknown as Player[]).filter(entity =>
      entity && entity.type === 'character' && entity.visible !== false && !entity.rip && !entity.dead &&
      team(entity) && team(entity) !== team(character) && (entity.in == null || character.in == null || entity.in === character.in));
    enemies.sort((a, b) => Number(majority.has(b.name)) - Number(majority.has(a.name)) || (Number(b.attack) || 0) - (Number(a.attack) || 0) ||
      Math.hypot(a.x - character.x, a.y - character.y) - Math.hypot(b.x - character.x, b.y - character.y));
    if (await sabotageSkill(enemies)) return true;
    const target = enemies[0];
    ports.setState({ at: Date.now(), stage: target ? 'abtesting-feed' : 'abtesting-feed-search', error: null });
    // The feeder's walks are combat steps (disposition TRN-002): the movement owner judges each one.
    if (target) {
      if (Math.hypot(target.x - character.x, target.y - character.y) > FOLLOW_DISTANCE && !character.moving)
        await facts.feed.step({ x: target.x, y: target.y }, 'abtesting-feed');
      return true;
    }
    const spawn = facts.feed.enemySpawn(team(character));
    if (!character.moving && Math.hypot(spawn.x - character.x, spawn.y - character.y) > SPAWN_ARRIVAL)
      await facts.feed.step({ x: spawn.x, y: spawn.y }, 'abtesting-feed-search');
    return true;
  }
  return { run };
}
