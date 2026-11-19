// Owner 03's published functions and types for add-ons: one re-export line each with its comment.
// Only 03's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// The turns owner's request shapes: a spend request and its requester, the spend table's ask and refusal,
// and the notice names.
export type { SpendAsk, SpendRequester, SkillsAllowsAsk, SkillsHold, SkillsNotice } from '../registry.ts';
// A spend's rank, the pass's view and a cooldown family's readiness.
export type { SpendRank, TurnsView, Readiness } from '../../characters/turns/api.ts';
