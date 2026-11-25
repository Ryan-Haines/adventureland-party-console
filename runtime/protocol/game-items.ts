// The game's item table, from the data.js the coordinator's planner prepares (movement's
// coordinator/runtime.ts `prepareMovement` sets it). the items owner's ignored market items name its keys
// (items/saved-fields.ts `validMarketIgnoredItem`) and its bank fates read stack sizes
// (items/coordinator/fates.ts). The saved fields load in both runtimes, so the table sits in the
// protocol with no node module behind it. Null until the game data loads, and always null in a
// character bundle, where the check reads the shape only.
let items: Readonly<Record<string, unknown>> | null = null;
export function setGameItems(table: Readonly<Record<string, unknown>> | null): void { items = table; }
export function gameItems(): Readonly<Record<string, unknown>> | null { return items; }
