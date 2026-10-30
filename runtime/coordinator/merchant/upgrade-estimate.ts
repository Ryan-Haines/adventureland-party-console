import {setImmediate} from 'node:timers';
import {estimateUpgradeBatch as estimateBatch, type EstimateLine, type UpgradeChoice} from '../../upgrade-estimate.ts';
export {highestUpgradeLevel} from '../../upgrade-estimate.ts';
// The caracAL sandbox intentionally lacks a global setImmediate. Resolve the
// native I/O yield through its module loader, independently of gameplay timers.
export function estimateUpgradeBatch(lines: EstimateLine[], signal?: AbortSignal) {
  return estimateBatch(lines, signal, () => new Promise<void>(resolve => setImmediate(resolve)));
}
export function estimateUpgrade(choice: UpgradeChoice, quantity: number, target: number) {
  return estimateUpgradeBatch([{choice, quantity, target}]).then(results => results[0]!);
}
export type { UpgradeChoice } from "../../upgrade-estimate.ts";
