// Owner 02's published functions and types for add-ons: one re-export line each with its comment.
// Only 02's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// A mover's answer, the mover itself, and a member `group.anchor` weighs.
export type { MoverAnswer, Mover, AnchorMember } from '../registry.ts';
// The view a `movement.request` mover and a `step.safety` answer receive, and its two helpers.
export { member, position, type MoverView, type ViewEntity, type Point } from '../view.ts';
// Movement's aggro geometry: the cell the game files idle aggressive monsters in and the
// two block tests `stepSafe` uses, read-only.
export { AGGRO_CELL, inBlock, entersBlock } from '../../movement/geometry/step-safety.ts';
// The console's one report freshness rule, read-only: a reader names its reading, `walk` for
// the rule a party walk uses.
export { fresh, type Reading, type WalkReading } from '../../protocol/reports.ts';
// The request kinds an add-on's request names.
export type { MovementKind } from '../../protocol/records.ts';
// The rank table's tiers an add-on mover names.
export type { Tier } from '../../protocol/ranks.ts';
