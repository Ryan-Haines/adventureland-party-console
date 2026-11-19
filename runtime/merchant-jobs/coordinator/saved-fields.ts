// The saved fields of merchant jobs (08), its declarations for the settings owner (11), which
// builds its table from them at load.
import { object, number, boolean, mapOf, listOf, item, wholeFrom, type Declarations } from '../../settings/api.ts';
import { defaultMerchantAutomations, defaultMerchantRoutinePriorities, migrateRoutinePriorities, validStandLocation, isGatheringMode, ROUTINE_PRIORITY, HANDOFF } from '../rules.ts';

export const merchantJobsSavedFields = {
  name: 'core:merchant-jobs',
  settings: {
    // A fresh install loads the configured merchant, or none until the first owned merchant connects
    // (b9b5c91e application.ts:157 passed `cfg.merchant || null`). The settings owner's initialMerchantRuntime
    // (settings/coordinator/initial.ts) gives the same null, so a reset and the loader agree.
    merchantCharacter: { label: 'Merchant', kind: 'character', default: null, deliver: ['characters', 'dashboard'] },
    // The routine priorities' whole 0 to 100 rule and the gathering modes' choices live in their
    // checks, so a route write and an import refuse the same values.
    merchantRoutinePriorities: { label: 'Merchant routine priorities', kind: 'value', default: defaultMerchantRoutinePriorities(),
      importable: true, check: mapOf(wholeFrom(ROUTINE_PRIORITY.min, ROUTINE_PRIORITY.max)),
      // An imported file's older routine keys load as today's (rules.ts `migrateRoutinePriorities`).
      imported: file => ({ merchantRoutinePriorities: migrateRoutinePriorities(file.merchantRoutinePriorities as Record<string, number>) }), deliver: ['dashboard'] },
    merchantAutomations: { label: 'Merchant automations', kind: 'value', default: defaultMerchantAutomations(),
      importable: true, check: mapOf(boolean), deliver: ['dashboard'] },
    merchantForceStand: { label: 'Keep the stand open', kind: 'boolean', default: false, deliver: ['characters', 'dashboard'] },
    // Unset until the first setup picks a clear point (owner.ts `migrateMerchantSettings`), so the
    // check takes null; the import's own check refuses it.
    merchantStandLocation: { label: 'Merchant stand location', kind: 'value', default: null, importable: true,
      check: value => value === null || validStandLocation(value), deliver: ['characters', 'dashboard'] },
    gatheringModes: { label: 'Gathering', kind: 'value', default: [], importable: true, check: listOf(isGatheringMode), deliver: ['dashboard-core'] },
    goldTargets: { label: 'Gold to keep', kind: 'value', default: {}, scope: 'character', importable: true, check: mapOf(number), deliver: ['dashboard'] },
    // The distance within which a fighter's visit (character/visits.ts) sends to the merchant, today's
    // 400 (shared.js `waitForHandoffSendWindow`), the game's send range: the send handler refuses past `B.dist`, 400
    // (server.js:224, 8454 at the pin).
    handoffSendDistance: { label: 'Merchant handoff send distance', kind: 'value', check: wholeFrom(1, Infinity), default: HANDOFF.sendDistance, hidden: true },
  },
  records: {
    // A record: the merchant's report of a missing tool sets it (routes.ts `gatherStatus`), and
    // switching the mode back on clears it.
    gatheringNoTool: { default: {}, importable: true, check: mapOf(boolean), deliver: ['characters', 'dashboard-core'] },
    giveawayAttempts: { default: {} },
    statScrolls: { default: {}, scope: 'character', importable: true, check: mapOf(listOf((value) => object(value) && item(value.item))), deliver: ['dashboard'] },
    purchases: { default: {}, deliver: ['dashboard-core'] },
    merchantQueue: { default: [] },
    merchantCurrent: { default: null },
    merchantCargo: { default: { bank: [], gold: 0 }, deliver: ['dashboard-core'] },
    gatheringCooldowns: { default: { fishing: 0, mining: 0 }, deliver: ['characters', 'dashboard-core'] },
    mluckCastAt: { default: {} },
    luckySlotLocks: { default: {}, deliver: ['characters', 'dashboard-core'] },
    // The add-on job kinds the last dispatch pass admitted, which the routine priorities
    // dialog's merchant-routines slot lists (dispatch.ts `addonJobs`).
    merchantAddonKinds: { default: [], deliver: ['dashboard'] },
  },
} satisfies Declarations;
