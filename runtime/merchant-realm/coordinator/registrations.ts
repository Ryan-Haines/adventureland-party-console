// The realm owner's registrations on the coordinator:
// the `realm` source, which describes the merchant group's `realm-hold` task while
// The realm owner's move is in flight and decides nothing (the tasks owner's table ranks it at 88). It
// also answers the two reads an add-on may ask: the move's realm and whether it is in flight,
// and the events owner's A/B exit rung's `realm.reconnect`.
import type { Registration } from '../../hooks/registry.ts';
import type { MerchantRealmOwner } from './owner.ts';
import { wakeReportWaits } from './report-wait.ts';

export function merchantRealmSource(realm: () => Pick<MerchantRealmOwner, 'moving' | 'target' | 'reconnect'>, owner: () => string | undefined): Registration {
  return { name: 'core:merchant-realm', folder: 'core', author: 'adventureland-party-console',
    summary: "Asks for the merchant's realm move.",
    hooks: {
    'realm.target': () => realm().target(),
    'realm.moving': () => realm().moving(),
    'realm.reconnect': (character: string) => realm().reconnect(character),
    // A member's report wakes the switch's waits on arrivals and homes (report-wait.ts).
    'status.received': () => wakeReportWaits(),
    'task.request': view => {
      const g = view as { groupKind?: string; members: string[] };
      if (g.groupKind !== 'merchant') return [];
      const moving = realm().moving(), target = realm().target();
      return [{ slot: 'realm', end: 'realm-done', ask: moving ? { kind: 'realm-hold', owner: `realm:${owner() ?? 'home'}:${target}`,
        phase: owner() ?? 'home', label: 'Merchant realm: ' + (target ?? 'home') } : null }];
    } } };
}
