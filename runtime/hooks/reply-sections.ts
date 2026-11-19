// the add-on owner's sections of the heartbeat reply (addon-capabilities.md C1, C4; status/rules.ts table R): the
// add-on stores newer than the character holds with its scope's add-on values, the actions the
// coordinator asked, and the commands it forwarded. The scope's owner is the group's leader, as the
// add-on routes name it, else the character's own solo scope.
import { partyHooks } from './index.ts';

interface AddonReplyState {
  leader: string | null;
  statuses: Record<string, { seenAt?: unknown } | undefined>;
  addonFarming?: Record<string, Record<string, unknown>>;
  addonSettings?: Record<string, Record<string, unknown>>;
}
export function addonReplySections(state: AddonReplyState) {
  const hooks = partyHooks();
  hooks.attach({ side: 'coordinator' });
  const ownerOf = (name: string) => String(state.leader || name);
  const enabledAddons = () => hooks.registrations().filter(r => r.folder === 'addons' && hooks.enabled(r.name)).map(r => r.name);
  // The coordinator's `addon.tick` runs once per received report of the character, so a reply read
  // twice, as the combat channel's comparison reads it, ticks once.
  const ticked = new Map<string, unknown>();
  return {
    stores(name: string) {
      const addons = enabledAddons();
      return { addonStores: hooks.stores.book.down(name, addons, ownerOf(name), state),
        addonScope: { owner: ownerOf(name), settings: Object.fromEntries(addons.map(addon => [addon, { ...state.addonSettings?.[addon] }])) } };
    },
    actions(name: string) {
      const seenAt = state.statuses[name]?.seenAt;
      if (ticked.get(name) !== seenAt) { ticked.set(name, seenAt); hooks.tick(name, { owner: ownerOf(name), state }); }
      return { addonActions: hooks.carriedAsks(name) };
    },
    inbox: (name: string) => ({ addonInbox: hooks.inbox(name) }),
  };
}
