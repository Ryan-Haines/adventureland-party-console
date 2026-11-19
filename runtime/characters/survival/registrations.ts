// The survival owner's registration on the character (W5): `core:survival` answers `skills.request`
// with the potion, regeneration and heal needs, in today's chain order, then the emergency Stomp and
// Scare; `survival.verdict` for a character's own fight and an add-on's hold; `survival.respawn`;
// the character half of `survival.escaping` and `survival.healthy`; `survival.mpPotion` for the turns owner's
// ranking (TRN-Q-DPS); the Cave revival's tick; and the escape's step on each `skills.passed` of the
// role loop. install.ts publishes it at load and again at the role runner's install; each answer
// reads the installed module (`__partySurvivalCharacter` from load, `__partySurvival` from the role
// runner), so a CODE reload's new install answers through the same registration.
import type { Registration, SurvivalQuestion, SurvivalVerdict, RespawnAnswer } from '../../hooks/registry.ts';
import { holdCheck, type HoldInput } from '../../protocol/hold-check.ts';
import type { NeedsView } from './needs.ts';
import type { Survival, SurvivalCharacter } from './install.ts';

type Root = { __partySurvival?: Survival; __partySurvivalCharacter?: SurvivalCharacter };
const installed = () => (globalThis as Root).__partySurvival;
const half = () => (globalThis as Root).__partySurvivalCharacter;
// The spend table's death recovery row on the character: the party's recovery holds this character outside
// its `finishing` phase (install.ts `occupies`). The turns owner's occupied rows ask it through survival's door.
export const survivalOccupies = (): boolean => !!half()?.occupies();
const ask = (name: 'potion' | 'regeneration' | 'heal' | 'stomp' | 'scare') => (view: unknown) => installed()?.needs[name](view as NeedsView);
// The verdict's questions on the character: its own fight from the escape and the death recovery's
// phase, and an add-on's hold from the hold check over the input it sends, its own supply included,
// so the add-on judges with the same function as the walk defense. A group's fight and a walk are the
// coordinator's questions. While the Cave revival holds the priest the character's verdict is
// `revive` (the spend table H8), which refuses its attack and its class decisions.
export function characterVerdict(question: SurvivalQuestion): SurvivalVerdict | undefined {
  if ('character' in question) return half()?.cave.reserved() ? 'revive' : installed()?.needs.characterVerdict();
  if ('hold' in question) return holdCheck(question.supply as HoldInput).fails ? 'step' : 'hold';
  return undefined;
}
export const survivalRegistrations: readonly Registration[] = [
  { name: 'core:survival', folder: 'core', author: 'adventureland-party-console',
    summary: 'Drinks a potion below your potion lines, regenerates when a fight allows it, has the priest heal whoever needs it most, Stomps in an emergency, escapes with the party, and makes the one respawn.',
    hooks: { 'skills.request': [
      { name: 'potion', rank: 'survival', answer: ask('potion') },
      { name: 'regeneration', rank: 'maintenance', answer: ask('regeneration') },
      { name: 'heal', rank: 'survival', answer: ask('heal') },
      { name: 'stomp', rank: 'survival', answer: ask('stomp') },
      { name: 'scare', rank: 'task', answer: ask('scare') },
    ],
    'survival.verdict': characterVerdict,
    // The fight fact targeting's fight-start clear asks:
    // today's `partyUnderAttack(atFarm)`, the test regeneration reads, unchanged.
    'survival.fighting': name => name === character.name && !!installed()?.fighting(),
    // A realm whose role runner has not installed survival makes no respawn: the registry's own error
    // names it.
    'survival.respawn': (request): RespawnAnswer => { const s = installed(); if (!s) throw Error('survival is not installed on ' + character.name); return s.death.answer(request); },
    'survival.escaping': name => half()?.escape.answer(name),
    // A member's realm holds one recovery record, its own party's, from its report reply, so it
    // answers every group with that record (CF-S7; the targeting owner's A11 reads its finishing list, E05-t1).
    'survival.recovery': () => half()?.recoveryAnswer(),
    'survival.healthy': share => !!installed()?.partyHealthy(share),
    // The turns owner's ranking counts an MP potion only where the potion table drinks one (TRN-Q-DPS).
    'survival.mpPotion': mpAfter => installed()?.needs.mpPotion(mpAfter) ?? 0,
    // The Cave revival's tick at today's place in the role loop, after the pass:
    // true when it acted or still holds the priest, which ends the loop's turn before the class decisions.
    'survival.revival': name => name === character.name && half() ? half()!.cave.tick().then(acted => acted || half()!.cave.reserved()) : Promise.resolve(false),
    // The escape's step runs on each pass of the role loop.
    'skills.passed': () => { void half()?.escape.step(); } } },
];
