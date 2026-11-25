// Owner 05's published functions and types for add-ons: one re-export line each with its comment.
// Only 05's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// The `survival.died` payload.
export type { DiedNotice } from '../../coordinator/survival/died.ts';
// The escape notices' payload.
export type { EscapeNotice } from '../../coordinator/survival/escape.ts';
// The recovery notices' payload.
export type { RecoveryNotice } from '../../coordinator/survival/recovery.ts';
// The verdict `survival.verdict` answers.
export type { SurvivalVerdict } from '../registry.ts';
