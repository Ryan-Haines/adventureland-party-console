// The setup of the add-on build row: a candidate
// build of a copy of the committed source with two added add-on folders, one with no dashboard.tsx
// and one whose section keeps state with the kit's `useState` and writes a class no other file
// has, through the candidate
// builder the dashboard's update and the E2E harness use. The candidate lands in a store the fixture
// owns, on the checkout store's dependency cache (the store refuses a redirected cache), and the
// fixture deletes that store after, so nothing in the checkout store moves: its references, its
// completion counts and its summaries stay as they were.
import {spawnSync} from 'node:child_process';
import {cp,lstat,mkdir,readdir,readFile,rm,rmdir,unlink,writeFile} from 'node:fs/promises';
import {readdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {buildCandidate} from '../../tools/console-build/builder.ts';
import {ConsoleBuildStore} from '../../tools/console-build/store.ts';

export const CANDIDATE_FIXTURE='candidate-fixture',SECTION_FIXTURE='candidate-section',SECTION_CLASS='bg-[#123457]';
const SECTION=`/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
import { useState, type AddonDashboard } from '../../../dashboard/features/party/addon-kit';
function Section() {
  const [clicks, setClicks] = useState(0);
  return <button type="button" className="${SECTION_CLASS}" onClick={() => setClicks(clicks + 1)}>{clicks}</button>;
}
export const dashboard: AddonDashboard = { section: Section };
`;
// Every file under `dir` whose name ends with `ext`.
const filesOf=(dir:string,ext:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?filesOf(path.join(dir,e.name),ext):e.name.endsWith(ext)?[path.join(dir,e.name)]:[]);
// Links first, so removing a tree never follows a junction into the dependency cache.
async function removeLinks(dir:string):Promise<void>{
  for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){
    const at=path.join(dir,entry.name),info=await lstat(at);
    if(info.isSymbolicLink())await (process.platform==='win32'?rmdir(at).catch(()=>unlink(at)):unlink(at));
    else if(info.isDirectory())await removeLinks(at);
  }
}
// The built coordinator bundle and generated runtime module of the copy's candidate.
// `checkout` is the checkout's store, whose dependency cache the fixture's own store builds on.
export async function addonCandidate(root:string,build:typeof buildCandidate,checkout:ConsoleBuildStore){
  const run=path.resolve(root,'.build/addon-candidate',randomUUID()),copy=path.join(run,'copy'),owned=path.join(run,'store');
  const store=new ConsoleBuildStore(owned,checkout.dependencies);
  await mkdir(copy,{recursive:true});
  try{
    const archive=copy+'.tar';
    // tar reads `F:` in a path as a remote host, so it takes the archive relative to the copy.
    for(const [command,args,cwd] of [['git',['archive','--format=tar','--output='+archive,'HEAD'],root],['tar',['-xf','../'+path.basename(archive)],copy]] as const){
      const result=spawnSync(command,[...args],{cwd,encoding:'utf8'});if(result.status!==0)throw Error(`${command} failed: ${result.stderr}`);
    }
    await rm(archive);
    // The game client's install is not tracked; the candidate builder takes its sources.
    // A worktree links .caracal to the main checkout's install, and cp would recreate that link
    // (EPERM for a symlink on Windows), so it copies what the link points at.
    await cp(path.join(root,'.caracal'),path.join(copy,'.caracal'),{recursive:true,dereference:true,filter:source=>!/[\\/](node_modules|CODE|TYPECODE|localStorage|logs|game_files)$/.test(source)});
    for(const name of [CANDIDATE_FIXTURE,SECTION_FIXTURE]){
      const folder=path.join(copy,'runtime/addons',name);
      await mkdir(folder,{recursive:true});
      await writeFile(path.join(folder,'README.md'),`# ${name}\n`);
      await writeFile(path.join(folder,'index.ts'),"import type { Registration } from '../../hooks/addon-api.ts';\n"+
        `export const registration: Registration = { name: '${name}', folder: 'addons', author: 'e2e', summary: 'Proves the candidate build finds an add-on folder.', hooks: {} };\n`);
    }
    await writeFile(path.join(copy,'runtime/addons',SECTION_FIXTURE,'dashboard.tsx'),SECTION);
    const started=Date.now(),candidate=await build(copy,store);
    const client=path.join(candidate.directory,'dashboard/.build/container/client'),scripts=filesOf(client,'.js');
    return {id:candidate.manifest.id,seconds:(Date.now()-started)/1000,
      // The client chunks that hold React's internals: one per React copy.
      reactCopies:scripts.filter(file=>readFileSync(file,'utf8').includes('__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE')).length,
      sectionBuilt:scripts.some(file=>readFileSync(file,'utf8').includes(SECTION_CLASS)),
      css:filesOf(client,'.css').map(file=>readFileSync(file,'utf8')).join('\n'),
      bundle:await readFile(path.join(candidate.directory,'.build/runtime/coordinator-application.cjs'),'utf8'),
      generated:await readFile(path.join(candidate.directory,'.build/addons/runtime.ts'),'utf8').catch(()=>'')};
  }finally{await removeLinks(run);await rm(run,{recursive:true,force:true});}
}
