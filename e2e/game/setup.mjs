import { up, down, logs } from './manage.mjs';
import {execFileSync} from 'node:child_process';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {ConsoleBuildStore} from '../../tools/console-build/store.ts';
import {buildCandidate,sourceFingerprint} from '../../tools/console-build/builder.ts';
import {gameHosts} from './addresses.cjs';
import {startNetworkClock} from '../../tools/sim/network-clock-broker.mts';
const root=fileURLToPath(new URL('../../',import.meta.url));

export default async function setup(config) {
  // FullConfig can still expose projects excluded by the CLI project selector.
  const selectors = process.argv.flatMap((argument, index, argv) => argument.startsWith('--project=') ? [argument.slice(10)] : argument === '--project' ? [argv[index + 1]] : []);
  const liveSelected=config.projects.some(project=>project.name==='live')&&(!selectors.length||selectors.some(name=>name==='live'||name.includes('*')));
  const store=new ConsoleBuildStore(root),hash=await sourceFingerprint(root);
  const references=await store.references();
  const pinned=process.env.E2E_DASHBOARD_CANDIDATE_ID;
  const selected=pinned||references.latest;
  const latest=selected?await store.describe(selected):undefined;
  if(pinned&&latest?.sourceHash!==hash)throw Error('Pinned E2E dashboard candidate does not match source');
  const candidate=latest?.sourceHash===hash?undefined:await buildCandidate(root,store);
  const verified=await store.verify(candidate?.manifest.id||latest.id);
  if(verified.manifest.sourceHash!==hash)throw Error('E2E dashboard candidate does not match source');
  // Linux limits each environment entry to 128 KiB. Keep the verified full
  // manifest on disk; child processes inherit only its immutable location.
  process.env.E2E_DASHBOARD_CANDIDATE=JSON.stringify({directory:verified.directory,
    manifestPath:path.resolve(verified.directory,'../manifest.json')});
  const accelerated=process.env.E2E_GAMEPLAY_BACKEND!=='native';
  if(liveSelected&&accelerated){
    if(Number(process.versions.node.split('.')[0])<24)throw Error('ChronAL gameplay E2E requires Node 24+; E2E_GAMEPLAY_BACKEND=native selects native parity execution');
    const pins=JSON.parse(readFileSync(new URL('../../tools/sim/pins.json',import.meta.url)));
    const installed=new URL('../../.build/sim/chronal/runtime/installed.json',import.meta.url);
    const head=new URL('../../.build/sim/chronal/.git/HEAD',import.meta.url);
    const dependencies=new URL('../../.build/sim/chronal/node_modules/jsdom/package.json',import.meta.url);
    const ready=existsSync(installed)&&existsSync(head)&&existsSync(dependencies)&&readFileSync(head,'utf8').trim()===pins.chronal&&['game','common','config'].every(key=>JSON.parse(readFileSync(installed))[key]===pins[key]);
    if(!ready)execFileSync(process.execPath,['tools/sim/setup.mts'],{cwd:root,stdio:'inherit',windowsHide:true});
    execFileSync(process.execPath,['tools/sim/build-browser-clock.mts'],{cwd:root,stdio:'inherit',windowsHide:true});
  }
  process.env.E2E_CLOCK_RATE=accelerated?(process.env.E2E_CLOCK_RATE||'4'):'1';
  process.env.E2E_CLOCK_WALL_EPOCH=String(Date.now());
  process.env.E2E_CLOCK_VIRTUAL_EPOCH=process.env.E2E_CLOCK_WALL_EPOCH;
  if (selectors.length && !selectors.some(name => name === 'live' || name.includes('*'))) return;
  if (!config.projects.some(project => project.name === 'live')) return;
  if(config.workers>gameHosts.length)throw Error('At most four isolated local gameplay workers are supported');
  const pools=[];
  try {
    for(let index=0;index<config.workers;index++){
      const clock=accelerated?await startNetworkClock(Number(process.env.E2E_CLOCK_RATE)):undefined;
      const environment={E2E_CLOCK_RATE:process.env.E2E_CLOCK_RATE,
        E2E_CLOCK_WALL_EPOCH:String(Date.now()),E2E_CLOCK_VIRTUAL_EPOCH:String(clock?.epoch||Date.now()),
        E2E_CLOCK_TOKEN:clock?.token||'',E2E_CLOCK_BROKER:clock?`http://127.0.0.1:${clock.port}`:'',
        E2E_CLOCK_DOCKER_BROKER:clock?`http://host.docker.internal:${clock.port}`:''};
      const pool={project:`al-e2e-pr21-${index}`,host:gameHosts[index],environment,clock};
      pools.push(pool);
      await up(pool);
    }
    process.env.E2E_GAME_POOLS=JSON.stringify(pools.map(({clock,...pool})=>pool));
  } catch(error){await cleanup();throw error;}
  async function cleanup(){
    const failures=[];
    for(const pool of pools){
      try{try{await logs(pool);}finally{
        try{if(!process.env.E2E_KEEP_GAME)await down(pool);}finally{await pool.clock?.close();}
      }}catch(error){failures.push(error);}
    }
    if(failures.length)throw new AggregateError(failures,'Isolated game cleanup failed');
  }
  return cleanup;
}
