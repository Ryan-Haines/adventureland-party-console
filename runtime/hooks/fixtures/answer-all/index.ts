// The add-on-neutral fixture.
// It answers every hook an add-on may answer and fills each slot an entry can take, and it stays
// switched off, as every new add-on starts. `npm run test:addon-neutral` installs it beside the real
// add-ons and runs the core unit suite, which must pass as it does without it. writeInstalled adds
// this folder only under PARTY_ADDON_FIXTURE=1 and after every real add-on, so a real add-on keeps a
// one-answer hook it shares with the fixture, and no shipped build carries it.
import { HOOKS, type Registration } from '../../registry.ts';
import { ADDON_SPEND_CAP, ADDON_TIERS } from '../../../protocol/ranks.ts';

const NAME = 'answer-all';
const nothing = () => undefined;
const hooks: Record<string, unknown> = {};
for (const [hook, row] of Object.entries(HOOKS) as [string, { core?: true; pending?: string }][])
  if (!row.core && !row.pending) hooks[hook] = nothing;
hooks['movement.request'] = [{ name: `${NAME}-mover`, tier: ADDON_TIERS[0], answer: nothing }];
hooks['skills.request'] = [{ name: `${NAME}-spend`, rank: ADDON_SPEND_CAP, answer: nothing }];

const button = { label: 'Answer all', description: 'The add-on-neutral fixture.', color: 'slate' } as const;
export const registration: Registration = {
  name: NAME, folder: 'addons', author: 'fixture', summary: 'Answers every hook while switched off.',
  taskTier: 'addon-task',
  overlays: ['eventPrioritiesByCharacter'],
  slots: [
    { slot: 'target-mode', mode: NAME, fills: 'choice', button, status: { title: 'Answer all', field: 'answerAllMessage', idle: 'Off' } },
    { slot: 'combat-mode', mode: NAME, fills: 'choice', button },
    { slot: 'combat-routine', mode: NAME, fills: 'choice', button },
    { slot: 'formation', mode: NAME, fills: 'choice', button },
    { slot: 'merchant-routine', mode: NAME, fills: 'choice', button },
  ],
  hooks: hooks as Registration['hooks'],
};
