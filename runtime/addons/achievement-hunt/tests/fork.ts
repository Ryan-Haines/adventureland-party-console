// The fork's Achievement Hunt as it ships on 972c9fce: a toggle that runs beside the farming
// mode (runtime/coordinator/hunt/achievement-hunt.ts there). The add-on test registers it next
// to core Hunt, and `addon:check` must report the target mode slot conflict. It is named
// apart from the shipped add-on (runtime/addons/achievement-hunt), which fills the slot as an
// entry.
import type { Registration } from '../../../hooks/addon-api.ts';

export const registration: Registration = {
  name: 'achievement-hunt-fork', folder: 'addons', author: 'Icelocked',
  summary: 'Farms the monster whose next achievement is closest, beside the target mode.',
  hooks: {},
  slots: [{ slot: 'target-mode', mode: 'achievement-hunt', fills: 'beside' }],
};
