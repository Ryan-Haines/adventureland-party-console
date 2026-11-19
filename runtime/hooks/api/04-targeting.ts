// Owner 04's published functions and types for add-ons: one re-export line each with its comment.
// Only 04's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// The party `targeting.aggroOwner` answers for, each member's view of its last report, and the
// view `targeting.candidates` and `targeting.prefers` ask with.
export type { AggroParty, CandidatesView, MemberView } from '../registry.ts';
// The targeting owner's published types, from runtime/characters/targeting/api.ts.
// `targeting.target`'s answer: the target, its passing flag, support, the due flag, range and
// revision.
export type { TargetAnswer } from '../../characters/targeting/api.ts';
// `targeting.threat`'s answer.
export type { ThreatAnswer } from '../../characters/targeting/api.ts';
// The payloads of `targeting.changed` and `targeting.passed`.
export type { ChangedNotice, PassedNotice } from '../../characters/targeting/api.ts';
// The payload of `targeting.refused`, `skipped`, `retired` and `cleared`.
export type { RingNotice } from '../../characters/targeting/api.ts';
// The payloads of `targeting.nominated`, `fightState`, `granted` and `revoked`.
export type { NominatedNotice, FightStateNotice, GrantNotice } from '../../characters/targeting/api.ts';
