// One Arena session per escape window (test-windows DESIGN.md 2.2 W43-W46): the party stays in the
// one world, and each round is one death or one Escape from the cgoo farm. Rounds of one session stay
// apart only where the behaviours need different ends (DEVIATIONS.md "Live B"): a walk home a
// player's command ends against one that reaches home and ends the death recovery; a fight the party
// wins against one it leaves; a mage whose MP covers two Magiports against one that covers one, or a
// member dead after the Blink. Between rounds the party comes back to the farm by a player travel,
// never a reset teleport.
import {expect, restoreArena, arenaPositions, type LiveGame} from './live-fixtures';
import {walkUntil} from './event-window-helpers';
import {caseARow, caseBRow, caseCRow, caseDRow, caseERow, caseFRow} from './escape-rows';
import type {TestInfo} from '@playwright/test';

const W = 'E2EWarrior', P = 'E2EPriest', B = 'E2EBankBoi';

// backToFarm waits for a round's escape and death recovery to end before the next round. It gives
// each member back its own MP, since case D (2) plants the mage's MP to its Blink and one Magiport.
// Then the player sends the
// party to the fixture's farm spot: case B's walk home is measured from the farm, and a death on the
// Arena's spawn takes the door.
export async function backToFarm(live: LiveGame, names: string[]) {
  await restoreArena(live);
  await live.admin(`output=(()=>{for(const n of ${JSON.stringify(names)}){const p=get_player(n);p.mp=p.max_mp;resend(p,'u');}return true;})()`);
  await expect.poll(async () => {
    const state = await live.state(), escape = (await (await fetch(live.url + '/party-api/escape')).json()).escape;
    return names.every(n => state.characters[n] && !state.characters[n].rip) && (!escape || ['complete', 'home', 'released', 'failed-hold'].includes(escape.stage)) &&
      (!state.combatRecovery || ['complete', 'cancelled'].includes(state.combatRecovery.phase));
  }, {timeout: 240_000, message: 'The party must be at rest before the next round'}).toBe(true);
  const farm = (arenaPositions(names) as Record<string, {map: string; x: number; y: number}>)[W]!;
  await live.post('/travel', farm);
  await walkUntil(live, names, async () => {
    const s = await live.state();
    return !s.activeConvoy && names.every(n => s.characters[n]?.map === farm.map && !s.characters[n].moving);
  }, 'The player\'s travel must bring the party back to the Arena farm');
}

// W43: the farming death whose walk home climbs past four blocked doors while a Hunt turn-in comes
// due (E58 with E59 in one death, caseBRow's `turnIn`), then a second death whose walk home the
// player's travel command ends (E57), then the player's Escape of the two with no mage (E60).
export async function blockedWalkSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await caseBRow(live, info, true);
    await backToFarm(live, [W, P]);
    await caseCRow(live, info);
    await backToFarm(live, [W, P]);
    await caseERow(live, info);
  } finally { await restoreArena(live); }
}

// W44: a death in a fight the party wins (E61), then one under a monster that out-damages the
// priest's heals, which the party leaves (E62).
export async function deathFightSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await caseFRow(true)(live, info);
    await backToFarm(live, [W, P]);
    await caseFRow(false)(live, info);
  } finally { await restoreArena(live); }
}

// W45: three Escapes of a ranger, a priest and a mage: the mage ports both (E68), ports whom its MP
// covers while the other walks (E69), and a priest dead after the Blink leaves to its own recovery
// (E70).
export async function magiportSessionPlay(live: LiveGame, info: TestInfo) {
  try {
    await caseDRow('ports')(live, info);
    await backToFarm(live, [W, P, B]);
    await caseDRow('one-port')(live, info);
    await backToFarm(live, [W, P, B]);
    await caseDRow('dead')(live, info);
  } finally { await restoreArena(live); }
}

// W46: the trio Escape of the warrior, the priest and the mage that lands in the Arena (E56).
export async function trioEscapePlay(live: LiveGame, info: TestInfo) {
  await caseARow(live, info);
}
