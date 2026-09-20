import type { Party, Combat, Status } from '../runtime/coordinator/navigation/rare-types.ts';
declare function createRareCombat(party: Party, members: () => string[], realm: (status?: Pick<Status, 'region' | 'server'>) => string): Combat;
export = createRareCombat;
