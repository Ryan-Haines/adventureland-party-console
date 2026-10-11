import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withBuildLock, readJson } from './build-store.ts';
import { gameStore, gameHistory, rememberCurrent, rollbackGame, resumeGame, cleanGame } from './game/history.ts';
import { ConsoleBuildStore } from './console-build/store.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const [action = 'list', stream = 'console', id] = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
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
async function consoleBuilds() {
  const store = new ConsoleBuildStore(root);
  if (action === 'clean') {
    if (!process.argv.includes('--apply')) return {directory: store.directory, apply: false, message: 'Use clean console --apply to remove unpinned history beyond twenty candidates and unused dependency caches'};
    await store.cleanup();
  }
  if (['rollback', 'resume', 'deploy'].includes(action)) {
    const refs = await store.references();
    const selected = action === 'resume' ? refs.latest : id;
    if (!selected) throw new Error('Provide the full completed candidate ID from list');
    await store.verify(selected);
    const origin = process.env.AL_CONSOLE_URL || `http://127.0.0.1:${Number(process.env.AL_PORT) || 3010}`;
    const credential = process.env.AL_CONSOLE_BROWSER_TOKEN;
    const response = await fetch(new URL('/console-build', origin), {
      method: 'POST', headers: {'Content-Type': 'application/json', Origin: origin, ...(credential ? {Cookie: `party=${credential}`} : {})},
      body: JSON.stringify({buildId: selected}), signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
  return {directory: store.directory, ...await store.references(), operation: await store.journal(), builds: await store.history()};
}
async function runHistory() {
  if (!['list', 'rollback', 'resume', 'deploy', 'clean'].includes(action) || !['console', 'game', 'dashboard', 'all'].includes(stream))
    throw new Error('Usage: node tools/build-history.mts list|clean [console] [--apply], or deploy|rollback console ID, or resume console');
  if (['console', 'all'].includes(stream)) return {console: await consoleBuilds()};
  if ((await new ConsoleBuildStore(root).history()).length)
    throw new Error('Managed console candidates include all components. Use the console history stream to deploy or roll back complete builds.');
  if (action === 'deploy') throw new Error('Deploy requires the console history stream');
  return stream === 'game' ? {game: await game()} : {dashboard: await dashboard(action === 'list' ? undefined : {action, id, apply: process.argv.includes('--apply')})};
}
console.log(JSON.stringify(await runHistory(), null, 2));
