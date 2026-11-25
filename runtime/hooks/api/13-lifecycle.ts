// Owner 13's published functions and types for add-ons: one re-export line each with its comment.
// Only 13's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// `lifecycle.state`, `lifecycle.drain` and a `lifecycle.ready` answer, and the payloads of 13's
// notices.
export type { LifecycleState, Drain, ReadyAsk, ReadyAnswer, HoldChanged, ReadinessNotice, WorkerNotice } from '../../lifecycle/api.ts';
// One roster entry, as the `roster.members` read answers it.
export type { CharacterConnection } from '../../lifecycle/api.ts';
