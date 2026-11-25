// A test add-on for the hooks that no installed add-on answers since the clean build removed
// tank-hold. It answers
// `group.anchor` with the member its `member` setting names and holds at the `formation` tier,
// so `addon:map --with` lists both answers and class-skills.test.cjs centres a group on it.
import type { Registration } from '../../../runtime/hooks/registry.ts';

export const ANCHOR_ADDON = 'anchor-fixture';

export const registration: Registration = {
  name: ANCHOR_ADDON, folder: 'addons', author: 'e2e',
  summary: 'Centres the group on the member you pick, or on the second member while that one steps away.',
  settings: {
    member: { label: 'Member', kind: 'character', default: null },
    second: { label: 'Second member', kind: 'character', default: null },
  },
  hooks: {
    'movement.request': [{ name: 'hold', tier: 'formation', answer: () => undefined }],
    'group.anchor'(members, settings) {
      const picked = members.find(m => m.name === settings.member);
      if (!picked) return undefined;
      return picked.positioning?.phase === 'stepping-away' && typeof settings.second === 'string' ? settings.second : picked.name;
    },
  },
};
