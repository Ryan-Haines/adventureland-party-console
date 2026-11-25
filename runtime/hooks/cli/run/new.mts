// npm run addon:new <name> [-- --root <dir>]: writes runtime/addons/<name>/ with its README
// (Part 1 for the author, Part 2 for the agent, from runtime/addons/README.md) and an empty
// registration. It writes no tracked file outside the folder: the build finds the folder
// (runtime/hooks/build/installed.mts), so installing edits no core file. It then writes the
// git-ignored installed list again, so the next command loads the new add-on.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { ADDON_NAME, rootOf, writeInstalled } from '../../build/installed.mts';

const args = process.argv.slice(2), name = args[0] ?? '', root = rootOf(args);
function fail(message: string): never { console.error(message); process.exit(1); }
if (!ADDON_NAME.test(name)) fail(`An add-on name is lower case letters, digits and dashes, such as boss-zones; got ${JSON.stringify(name)}.`);
const folder = path.join(root, 'runtime/addons', name);
if (existsSync(folder)) fail(`runtime/addons/${name} already exists.`);
mkdirSync(folder, { recursive: true });
writeFileSync(path.join(folder, 'README.md'), `# ${name}

Answer Part 1 in your own words before any code; your agent answers Part 2 from
\`npm run addon:map\` and runtime/addons/HOOKS.md, and checks it with \`npm run addon:check\`
(runtime/addons/README.md).

## Part 1: what it does in game
1. Is this a new feature or a bug fix? A bug fix goes into core and stops here.
2. In one sentence, what does it make the party do?
3. When does it start, and when does it stop?
4. Does it replace something the party does now, such as the farming mode? What should the party go back to when it stops?
5. Does it move characters? What should be allowed to interrupt it, and should it wait or give up?
6. Does it keep, use, buy, sell or move items? Which, and how many?
7. Does it cast skills, attack, or pick which monster to fight?
8. Can it get a character killed? What should happen when a character is in danger?
9. What settings should the player see, and what should they start at?
10. What should the character's card say while it runs, and when it cannot make progress?
11. What should it try next when it cannot reach its goal?
12. How should the player be able to stop or override it, and does that need a warning?
13. How will you know it works? Describe what you would watch for in game.

## Part 2: where it lands in the console
- A. Group task slot (01):
- B. Movement tier (02), between which two named tiers, and cancel or wait:
- C. Item claims (10):
- D. Turns and targets (03, 04):
- E. Survival (05):
- F. Settings (11), each number from game data, a setting with a default, or a progress rule:
- G. Card text (12), and the next strategy when progress stops:
- H. Overrides and their warning:
- I. Conflicts \`npm run addon:check\` reports, resolved in the owner's table:
- J. Tests: the E2E scenario with its measures and thresholds:
- K. Dashboard section (only for a target mode entry with settings of its own): \`dashboard.tsx\` here,
  exporting \`dashboard\` and starting with \`/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */\`;
  it imports only dashboard/features/party/addon-kit.ts and this folder.
`);
writeFileSync(path.join(folder, 'index.ts'), `// ${name}: see README.md here. It answers only the hooks runtime/hooks/registry.ts declares.
import type { Registration } from '../../hooks/addon-api.ts';

export const registration: Registration = {
  name: '${name}', folder: 'addons', author: '',
  summary: '',
  hooks: {},
};
`);
writeInstalled(root);
console.log(`Wrote runtime/addons/${name}/. Answer README.md Part 1 next; the next build loads it.`);
