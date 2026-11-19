import { CALL_LIMIT } from '../../../runtime/merchant-hands/api.ts';

// The CC meter fills to the game server's call limit per window, which the call budget owner's call budget keeps, and
// turns red at 90% of it, a display mark ahead of the server's disconnect.
export const CC_MAX = CALL_LIMIT;
export const ccWarning = (calls: unknown): boolean => Number(calls) >= CALL_LIMIT * 0.9;
