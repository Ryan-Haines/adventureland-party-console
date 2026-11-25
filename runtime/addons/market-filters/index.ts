// market-filters: see README.md here. It answers no game hook; its whole work is the filter bar
// dashboard.tsx puts in each Market tab's list-view slot.
import type { Registration } from '../../hooks/addon-api.ts';

export const registration: Registration = {
  name: 'market-filters', folder: 'addons', author: 'Icelocked',
  summary: 'Adds one filter bar to each Market tab: level, price and server bounds beside the Market search box.',
  hooks: {},
};
