// The turns owner's port to the facts other owners hold today through characters/shared.js
// `turnsPorts()`: each port is one line of that
// owner's expression there, read by the spend table's occupied rows (rules.ts `occupiedRows`), the A/B feed, the
// class decisions and the combat context. A port goes when its owner publishes the fact through its
// api door, as O5 and O17 already read events/api.ts.

export interface TurnsFacts {
  // The tasks owner's character holds (runtime/tasks/character/holds.ts): the card's switches.
  hand(): { by?: string; combat?: boolean; usePotions?: boolean } | null;
  // The hunting owner's `cave.state`: a Cave owns the character, and the Cave is paused.
  dungeonOwned(): boolean;
  cavePaused(): boolean;
  // The lifecycle owner's run: this runtime is the character's current one.
  current(): boolean;
  previewing(): boolean;
  leased(): boolean;
  returnCombat(): boolean | null;
  // The movement owner's walk state, read whole: the group walk and the walk flags.
  walk(): { defensePaused?: boolean; continuousReturn?: number; purpose?: string; huntTarget?: unknown; phase?: string } | null | undefined;
  walkState(): { forceTraveling?: boolean; townTraveling?: boolean; townActive?: boolean; following?: boolean };
  merchantTidy(): boolean;
  // The movement owner's walk fight and departure flag; the targeting owner's departure fight and engaged monster; the hunting owner's Hunt defense
  // and Hunt loot pass; the items owner's queued bank visit. The spend table's rows O8, O9 and O18 combine them.
  travelCombat(): boolean;
  departing(): boolean;
  departureCombat(): boolean;
  monsterEngaged(): boolean;
  huntDefense(): boolean;
  huntLoot(): boolean;
  bankQueued(): boolean;
  escape(): boolean;
  rare(): boolean;
  // The tasks owner's farm reunion.
  reunion(): unknown;
  reunionBlocked(): boolean;
  errands(): boolean;
  gathering(): boolean;
  // The A/B feed's reads (ab-feed.ts).
  feed: { strategy(): { mode?: string; sabotageNames?: string[]; majorityNames?: string[] } | null; team(entity: unknown): unknown;
    enemySpawn(team: unknown): { x: number; y: number }; step(to: { x: number; y: number }, mode: string): Promise<unknown> };
  // Energize's and Dash's reads (classes/), and the ranking's: each member's turns report (TRN-Q-DPS).
  members(): { name: string; rip?: boolean; map?: string; mp: number; max_mp: number; ctype?: string; turns?: import('../skills/types.ts').TurnsReport }[];
  // The offset from this character's clock to the coordinator's (shared.js `walkState.clockOffset`),
  // which the reports' times use.
  clockOffset(): number;
  roster(): string[];
  sameTeam(member: unknown): boolean;
  franky(): boolean;
  // The movement owner's formation: whether the party farms grouped, and its members.
  groupedFarming(): boolean;
  formationMembers(): { ctype?: string }[];
  combatDistance(target: unknown): number;
  desiredCombatRange(): number;
  safeCombatPoint(point: { x: number; y: number }, target: unknown): boolean;
  // The combat context's reads (skills/context.ts).
  combatEvent(): { name: string; types: string[] } | null;
  joinedEvent(): string | null;
  leader(): string | null;
  farmingMode(): string;
  liveAbtesting(): boolean;
  // The routine's farming mode, which reads default in a Cave or a rare (the class decisions' read).
  roleFarmingMode(): string;
  // "Heal first below" as the last report reply delivered it.
  healFirstBelow(): unknown;
}
