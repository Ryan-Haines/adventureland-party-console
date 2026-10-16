import { up, down, logs } from './manage.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));

export default async function setup(config) {
  // FullConfig can still expose projects excluded by the CLI project selector.
  const selectors = process.argv.flatMap((argument, index, argv) => argument.startsWith('--project=') ? [argument.slice(10)] : argument === '--project' ? [argv[index + 1]] : []);
  if(config.projects.some(project=>project.name==='simulation')&&(!selectors.length||selectors.some(name=>name==='simulation'||name.includes('*')))){
    if(Number(process.versions.node.split('.')[0])<24)throw Error('Accelerated gameplay E2E requires Node 24+; --project=live retains native-only execution');
    const pins=JSON.parse(readFileSync(new URL('../../tools/sim/pins.json',import.meta.url)));
    const installed=new URL('../../.build/sim/chronal/runtime/installed.json',import.meta.url);
    const head=new URL('../../.build/sim/chronal/.git/HEAD',import.meta.url);
    const dependencies=new URL('../../.build/sim/chronal/node_modules/jsdom/package.json',import.meta.url);
    const ready=existsSync(installed)&&existsSync(head)&&existsSync(dependencies)&&readFileSync(head,'utf8').trim()===pins.chronal&&['game','common','config'].every(key=>JSON.parse(readFileSync(installed))[key]===pins[key]);
    if(!ready)execFileSync(process.execPath,['tools/sim/setup.mts'],{cwd:root,stdio:'inherit',windowsHide:true});
  }
  if (selectors.length && !selectors.some(name => name === 'live' || name.includes('*'))) return;
  if (!config.projects.some(project => project.name === 'live')) return;
  // Debugging opt-in keeps this exact disposable project across selected reruns.
  // Normal local and CI runs always collect evidence and remove the database.
  try {
    await up();
  } catch (error) {
    await logs().catch(() => {});
    if (!process.env.E2E_KEEP_GAME) await down();
    throw error;
  }
  return async () => {
    try { await logs(); }
    finally { if (!process.env.E2E_KEEP_GAME) await down(); }
  };
}
