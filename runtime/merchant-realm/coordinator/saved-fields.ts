// The saved fields of the merchant realm (09), its declarations for the settings owner (11), which
// builds its table from them at load.
// They moved from the held block runtime/settings/held/08-09-merchant.ts with no change to a field;
// the realm blacklist is the one new field.
import { wholeFrom, type Declarations } from '../../settings/api.ts';
import { MERCHANT_HOME_REPORT_MS } from '../../protocol/reports.ts';
import type { SavedEventState } from '../../events/api.ts';
import { validRealmBlacklist } from '../rules.ts';

export const merchantRealmSavedFields = {
  name: 'core:merchant-realm',
  settings: {
    // How long the merchant's last report counts while it waits at home on a delayed heartbeat,
    // read through movement's `merchant-home` reading (runtime/protocol/reports.ts). Kept at today's
    // value; no game fact gives it.
    merchantHomeReportMs: { label: 'Merchant home report window (ms)', kind: 'value', check: wholeFrom(1, Infinity), default: MERCHANT_HOME_REPORT_MS, hidden: true },
    // Realms automatic merchant work skips; an order you give for one asks your
    // confirmation. Empty at first, so a fresh console behaves as today; the refusals already cover PVP.
    merchantRealmBlacklist: { label: 'Merchant realm blacklist', kind: 'value', default: [], importable: true,
      check: validRealmBlacklist, deliver: ['dashboard'] },
  },
  records: {
    merchantRealmRequests: { default: {} },
    // A fresh install loads the realm the coordinator starts on (initial-core.ts).
    activeRealm: { default: null satisfies SavedEventState['activeRealm'] },
    nativeOwner: { default: null, document: 'roster' },
    steamMembers: { default: [], document: 'roster' },
    // The headless worker slots. A fresh install fills up to three from the console
    // configuration's enabled characters (runtime/lifecycle/roster/initial-roster.ts `initialHeadlessSlots`);
    // with none enabled, four empty slots.
    headlessSlots: { default: [null, null, null, null], document: 'roster' },
  },
} satisfies Declarations;
