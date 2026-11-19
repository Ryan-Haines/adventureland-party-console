// The lifecycle owner's judgement that a member is lost, on its existing stale bound: its last report is
// `steamRunnerStaleMs` old, the age at which the Steam window restarts its CODE (roster/recovery.ts).
// Movement's walk reads it when every member falls silent at once (the user's decision of
// 2026-11-17): the walk holds until then, and then lets them go to recovery.
import { lifecycleSavedFields } from '../fields.ts';

export const memberLost = (report: { seenAt?: unknown } | undefined, now: number): boolean =>
  !report || now - Number(report.seenAt) >= lifecycleSavedFields.settings.steamRunnerStaleMs.default;
