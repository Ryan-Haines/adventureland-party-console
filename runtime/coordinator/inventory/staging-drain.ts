import type { BankboiInventory } from './bankboi-completion.ts';
import type { CargoRequest } from './reserved-cargo.ts';

/** Outbound reservations fence new retrievals, but must not strand inbound cargo.
 * Draining only the unreserved cells lets a full merchant deposit before pickup.
 */
export function outgoingStagingDrain<Routes>(
  workers: BankboiInventory[],
  staged: CargoRequest[],
  routes: Routes,
  available: (worker: BankboiInventory) => boolean,
  accepts: (worker: BankboiInventory, request: CargoRequest, routes: Routes) => boolean,
) {
  const candidate = workers.find(worker => worker.state === 'provisioning') ||
    workers.find(worker => available(worker) &&
    staged.some(request => accepts(worker, request, routes)));
  if (!candidate) return null;
  return { candidate, routes,
    requests: staged.filter(request => accepts(candidate, request, routes)).slice(0, 7),
    retrievals: [] };
}
