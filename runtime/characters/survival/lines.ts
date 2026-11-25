// The survival owner's lines: each number the needs read, with where it comes from. "HP potion
// below" and "MP potion below", whole percents per character. The defaults are today's priest and
// mage values (priest.ts and mage.ts at an earlier build); the merchant keeps its 20 and 20 (the
// earlier console shared.js `regenerateHpOrMp`:13761-13790).
export const POTION_DEFAULTS = { hp: 50, mp: 20 } as const;
export const MERCHANT_POTION_DEFAULTS = { hp: 20, mp: 20 } as const;

// A9's line: in a fight, regeneration waits once a fighter has read below this share of its HP
// in that fight.
export const A9_LINE = 0.8;

// Today's regeneration order (v1.5.0 shared.js `regenerateHpOrMp`): HP below half,
// then MP below half, then any missing HP, then any missing MP. The halves are the console's own
// numbers.
export const REGENERATION_HALF = 0.5;

// The escape's settled stages: the party holds there, so the character's needs and the passive pulse
// run as outside an escape. v1.5.0 shared.js `passiveRegenerationEligible`
// lists complete and failed-hold, and `home` is A39's stage. In any other stage the escape's step
// makes the character's survival spends (escape.ts).
export const ESCAPE_SETTLED = ['complete', 'failed-hold', 'home'] as const;

export interface Lines { hp: number; mp: number }

// The character's two lines from the values its last report reply delivered, or the defaults for
// its class when it has no entry. The settings owner's declaration checks each value on write
// (saved-fields.ts `mapOf(wholeFrom(1, 100))`), so a delivered line is read as it comes.
export function linesOf(ctype: string, delivered: { hp?: number | null; mp?: number | null } | null | undefined): Lines {
  const base = ctype === 'merchant' ? MERCHANT_POTION_DEFAULTS : POTION_DEFAULTS;
  return { hp: delivered?.hp ?? base.hp, mp: delivered?.mp ?? base.mp };
}

// The 90% healthy share (v1.5.0 shared.js `isPartyHealthy`): the priest's Curse
// waits while a member reads below it (`survival.healthy`), the Cave revival heals a living member
// below it first (cave-revival.ts), and the A/B feed heals an enemy below it (turns/ab-feed.ts).
export const HEALTHY_SHARE = 0.9;

// The emergency Stomp's triggers, ("The Stomp does not change"): an ally below 60% of its HP, or
// two monsters on the warrior (v1.5.0's `emergencyWarriorStomp`).
export const STOMP_ALLY_SHARE = 0.6;
export const STOMP_AGGRO = 2;

// The largest offset the server's Magiport puts a member off its mage: one of nine offsets up to
// (20, 32) (server_functions.js:4070-4090), so a member that walked counts beside the mage within
// movement's arrival tolerance plus this.
export const MAGIPORT_OFFSET = Math.hypot(20, 32);

// The escape's two named picks: no game fact gives either number, so each keeps the earlier
// console's value and changes only with the code. ESCAPE_STEP is how far a member waiting for
// its port steps away from the nearest monster, the forward point a warrior Dashes toward, and
// the transporter landing's offset (shared.js `escapeForwardPoint`:135, `escapeLanding`:168,
// `escapePulse`:281). The landing's risk counts each monster within its range plus
// LANDING_MARGIN of a candidate (shared.js `escapeLanding`:183).
export const ESCAPE_STEP = 40;
export const LANDING_MARGIN = 120;
