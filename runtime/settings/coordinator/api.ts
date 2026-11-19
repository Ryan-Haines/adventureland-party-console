// Settings' coordinator door:
// the coordinator table and the persistence values, which import node built-ins
// (jsonl-store.ts and legacy-storage.ts), so runtime/settings/api.ts stays loadable in a character
// bundle and the dashboard.
export { coordinatorSettings, declared, hiddenValue } from './table.ts';
export type { DeliveredField } from './table.ts';
export { modeSlot } from './slots.ts';
export { migrateCoordinatorLegacyStorage } from './persistence/legacy-storage.ts';
export { synchronizeStorage } from './persistence/worker-storage.ts';
export { snapshotSaveDue } from './persistence/roster-snapshots.ts';
export { CoordinatorJsonlStore } from './persistence/jsonl-store.ts';
export { selectSnapshot } from './persistence/snapshots.ts';

// What the lifecycle owner's composition root (runtime/coordinator/application.ts) and its contract check
// (initialization.contract-check.ts) compose of this owner.
export { createSettingsRoutes } from './routes/settings.ts';
export { installCoordinatorSettings } from './install.ts';
export { readLegacyStorage } from './persistence/legacy-storage.ts';
export { initializeCoordinatorState, initialMerchantRuntime, initialGatheringState, initialEventState, initialCommandState, initialRecoveryState, createInitialCoordinatorState, initialMerchantSales } from './initial.ts';
export { createFormationRoute } from './routes/formation.ts';
export { createCoordinatorDashboardImport } from './routes/import.ts';
export { createThresholdRoute } from './routes/thresholds.ts';
