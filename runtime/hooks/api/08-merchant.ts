// Owner 08's published functions and types for add-ons: one re-export line each with its comment.
// Only 08's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// What a `merchant.jobKind` answer declares, what a `merchant.job` answer proposes and the view it receives.
export type { MerchantKindAsk, MerchantJobAsk, MerchantJobView } from '../registry.ts';
// The job owner's notices, read-only.
export type { MerchantJobNotice } from '../registry.ts';
// A J5 kind record, as `merchant.kind` answers it.
export type { JobKind } from '../../merchant-jobs/api.ts';
// A J4 ending row, as `merchant.job.ended` names it.
export type { EndingRow as JobEnding } from '../../merchant-jobs/api.ts';
