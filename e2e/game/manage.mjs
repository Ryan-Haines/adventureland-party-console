import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createWriteStream, readFileSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import bootstrapModule from './bootstrap.cjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const pins=JSON.parse(readFileSync(resolve(root,'tools/sim/pins.json'),'utf8'));
const args = pool => ['compose', '--project-name', pool.project || 'al-e2e-pr21', '-f', 'e2e/game/compose.yml'];
const started = new Map();
function docker(command,pool={}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', [...args(pool), ...command], { cwd: root, stdio: 'inherit', windowsHide: true, env:{...process.env,E2E_GAME_REV:pins.game,E2E_COMMON_REV:pins.common,E2E_CONFIG_REV:pins.config,...pool.environment,E2E_GAME_HOST:pool.host||'127.0.0.1'} });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error('Docker exited ' + code)));
  });
}
export async function up(pool={}) {
  started.set(pool.project,new Date().toISOString());
  await docker(['up', '--build', '--detach', '--wait', '--wait-timeout', '300'],pool);
  const game=bootstrapModule.createGame({host:pool.host});
  const manifest=await game.bootstrap();
  if(process.env.E2E_SEED_BOOTSTRAP_CODES==='1')await game.seedPreviousBootstrapCodes(manifest);
  return manifest;
}
export async function logs(pool={}) {
  const since=started.get(pool.project);
  const destination = resolve(root, `.build/e2e-live/${pool.project||'server'}.log`);
  await mkdir(dirname(destination), { recursive: true });
  const command = ['logs', '--no-color', '--timestamps', ...(since ? ['--since', since] : [])];
  const child = spawn('docker', [...args(pool), ...command], {
    cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true,
  });
  const completed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() :
      reject(new Error('Docker logs exited ' + code + (signal ? ' (' + signal + ')' : ''))));
  });
  try {
    // Backpressure bounds memory independently of the amount of retained output.
    await Promise.all([pipeline(child.stdout, createWriteStream(destination)), completed]);
  } catch (error) {
    child.kill();
    await completed.catch(() => {});
    throw error;
  }
  console.log(destination);
}
export async function down(pool={}) { await docker(['down', '--volumes', '--remove-orphans'],pool); }
const command = process.argv[2];
if (command === 'up') await up();
else if (command === 'down') await down();
else if (command === 'logs') await logs();
else if (command === 'reset') await bootstrapModule.reset();
else if (process.argv[1] === fileURLToPath(import.meta.url)) throw new Error('Usage: node e2e/game/manage.mjs up|down|logs|reset');
