// The one rank table: its tiers
// and spend ranks. Every owner ranks with it (runtime/protocol/).

// The rank table's tiers, in the settled order.
// `player` is its Player command column:
// `ends` lets a `manual` request take over whatever the rank; `rank` ranks it like any request.
// Event attendance ranks above the Hunt turn-in (the party never leaves an event early to
// hand in). `realm-hold` and `idle` are task rows with no movement row: the realm owner's hold
// moves nobody, and `idle` moves nothing. `app` takes `manual`'s movement row at its own rank
//.
export const TIERS = {
  escape: { rank: 100, player: 'ends' },
  'death-recovery': { rank: 95, player: 'ends' },
  cave: { rank: 90, player: 'rank' },
  lifecycle: { rank: 88, player: 'rank' },
  'realm-hold': { rank: 88, player: 'rank' },
  town: { rank: 85, player: 'rank' },
  manual: { rank: 75, player: 'rank' },
  app: { rank: 74, player: 'rank' },
  'event-attendance': { rank: 72, player: 'rank' },
  'hunt-turn-in': { rank: 70, player: 'rank' },
  'event-return': { rank: 68, player: 'rank' },
  errand: { rank: 65, player: 'rank' },
  rare: { rank: 64, player: 'rank' },
  'hunt-mission': { rank: 62, player: 'rank' },
  'addon-task': { rank: 60, player: 'rank' },
  farming: { rank: 56, player: 'rank' },
  formation: { rank: 46, player: 'rank' },
  approach: { rank: 44, player: 'rank' },
  follow: { rank: 40, player: 'rank' },
  idle: { rank: 0, player: 'rank' },
} as const satisfies Record<string, { rank: number; player: 'ends' | 'rank' }>;
export type Tier = keyof typeof TIERS;
// The rank table's add-on note: an add-on mover names a tier below `manual` that moves a
// character. The hook registry refuses any other tier at load (runtime/hooks/registry.ts).
export const ADDON_TIERS: readonly Tier[] = ['event-attendance', 'hunt-turn-in', 'event-return', 'errand', 'rare', 'hunt-mission', 'addon-task', 'farming', 'formation', 'approach', 'follow'];
// The rank table's spend ranks, highest first:
// the turns owner sends a cooldown family's highest request. Movement's own rules do not read them.
export const SPEND_RANKS = { survival: 4, task: 3, damage: 2, maintenance: 1 } as const;
export type SpendRank = keyof typeof SPEND_RANKS;
// An add-on asks for a spend at `task` or below, as an add-on mover stays below `manual`, so no
// add-on outranks a heal or a potion. The hook registry refuses a higher rank at load.
export const ADDON_SPEND_CAP: SpendRank = 'task';
