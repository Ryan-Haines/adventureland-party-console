import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBuildLock, readJson } from './build-store.ts';
import { gameStore, gameHistory, rememberCurrent, rollbackGame, resumeGame, cleanGame } from './game/history.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const [action = 'list', stream = 'all', id] = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const port = Number(process.env.AL_DASHBOARD_PUBLIC_PORT || 3010);
async function dashboard(body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${port}/__dashboard/builds`, {
    method: body ? 'POST' : 'GET', headers: {'Content-Type': 'application/json', Origin: `http://127.0.0.1:${port}`},
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(180000),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
async function game() {
  if (action === 'rollback') { if (!id) throw new Error('Provide the full build ID from list'); await rollbackGame(root, id); return {pinned: id}; }
  if (action === 'resume') { await resumeGame(root); return {resumed: true}; }
  return withBuildLock(gameStore(root), async () => {
    const directories = [path.join(root, 'characters'), gameStore(root)];
    const results = [];
    for (const directory of directories) {
      const current = await rememberCurrent(directory);
      results.push(action === 'clean' ? await cleanGame(directory, process.argv.includes('--apply')) : {
        directory, active: current?.generation, builds: (await gameHistory(directory)).map(({id, createdAt}) => ({id, createdAt})),
      });
    }
    return {publication: await readJson(path.join(gameStore(root), 'publication.json')), stores: results};
  });
}
if (!['list', 'rollback', 'resume', 'clean'].includes(action) || !['game', 'dashboard', 'all'].includes(stream))
  throw new Error('Usage: node tools/build-history.mts list|clean [all|game|dashboard] [--apply], or rollback|resume game|dashboard [ID]');
if (['rollback', 'resume'].includes(action) && stream === 'all') throw new Error('Choose game or dashboard');
const result: Record<string, unknown> = {};
if (stream !== 'dashboard') result.game = await game();
if (stream !== 'game') result.dashboard = await dashboard(action === 'list' ? undefined : {action, id, apply: process.argv.includes('--apply')});
console.log(JSON.stringify(result, null, 2));
