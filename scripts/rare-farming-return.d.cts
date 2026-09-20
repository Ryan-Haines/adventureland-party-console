import type { Party, Hooks, FarmingReturn, Status } from '../runtime/coordinator/navigation/rare-types.ts';
declare function createRareReturn(party: Party, hooks: Hooks & {realm(status?: Pick<Status, 'region' | 'server'>): string}): FarmingReturn;
export = createRareReturn;
