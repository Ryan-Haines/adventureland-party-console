import type { HuntCycle } from '../../../runtime/hunting/api.ts';

// The Hunt record the dashboard reads: the hunting owner's HuntCycle as the state route carries it, cut to the
// fields the Hunt panel and the farming controls read.
export type MonsterHuntState = Pick<HuntCycle, 'backup' | 'batchPickup' | 'returnLocation' | 'cycleId' | 'stage' | 'participants'
  | 'owner' | 'turnIn' | 'target' | 'currentIndex' | 'missions'>;
