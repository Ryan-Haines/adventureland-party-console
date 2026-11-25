// Owner 12's published functions and types for add-ons: one re-export line each with its comment.
// Only 12's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// The card line `status.cardLine` answers, and the line an add-on's `status.line` receives (D4 parts 1 and 3).
export type { CardLine } from '../../status/api.ts';
// A diagnostics view's read of one character, with the rings its lease names (table G).
export type { DiagnosticsLease } from '../../status/api.ts';
// An app key as the key screen shows it, and its scopes (table K).
export type { AppKey, AppScope } from '../../status/api.ts';
// D4 part 2's event payloads, one per event.
export type { StatusLineChanged, StatusReceived, StatusReplied, DashboardCommand, DashboardClients, DiagnosticsLeaseNotice,
  AppKeyNotice } from '../../status/api.ts';
// An add-on's own ring, which the `diagnostics-ring` slot draws as a tab of the diagnostics view.
export type { AddonRing } from '../registry.ts';
// The view a `status.report` answer gets.
export type { StatusReportView } from '../rows/12-status.ts';
