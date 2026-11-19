// Owner 07's published functions and types for add-ons: one re-export line each with its comment.
// Only 07's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// `farming.focus(group)`: a group's focus, farm spot, Hunt target, mode answer and rare state.
export type { FarmingFocus } from '../../hunting/api.ts';
// A rejected rare in `farming.focus`'s rare state, which 04's grouped queue keeps out until its time.
export type { RareRejected } from '../../hunting/api.ts';
// `cave.state(member)` and `cave.state()`: a member inside the run, or the visit's phase and run.
export type { CaveState } from '../../hunting/api.ts';
// `cave.destination`'s question: the run, the floor, the points exploration may walk to next and the current one.
export type { CaveDestinationAsk } from '../../hunting/api.ts';
// `cave.rejoin`'s question: the member back online, the run, its clock and the member's live task.
export type { CaveRejoinAsk } from '../../hunting/api.ts';
// `passive.rule(monster)`'s rule: on or off, priority, level cap, keep moving, May interrupt Hunt.
export type { PassiveRule, PassiveRuleView } from '../../hunting/api.ts';
// `hunt.view(group)`: the Hunt cycle's stage, mission, target, owner and counts.
export type { HuntView } from '../../hunting/api.ts';
// A farm area of the spawn catalog, as `farm.spot` lists the alternatives.
export type { FarmArea } from '../../hunting/api.ts';
