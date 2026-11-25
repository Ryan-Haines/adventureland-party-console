import { mkdir, readFile, rename, writeFile, rm, lstat, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {isCoordinatorApplicationLauncher} from "./coordinator-launcher.mts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const target = path.resolve(process.argv[2] || path.join(root, ".caracal"));
const stageOption = process.argv.indexOf('--stage-dir');
if(stageOption>=0&&!process.argv[stageOption+1])throw new Error('Provide --stage-dir directory');
const stage = path.join(stageOption>=0?path.resolve(process.argv[stageOption+1]):path.join(root, ".build/caracal-upgrades"), randomUUID());
const artifactOption=process.argv.indexOf('--artifact-native');
if(artifactOption>=0&&!process.argv[artifactOption+1])throw new Error('Provide --artifact-native directory');
const artifactNative=artifactOption>=0?path.resolve(process.argv[artifactOption+1]):undefined;
const preparedNative=process.argv.includes('--prepared-native');
if(preparedNative&&!artifactNative)throw new Error('Prepared installation requires a verified native artifact');
if(preparedNative&&JSON.parse(await readFile(path.join(artifactNative!, 'prepared-runtime.json'),'utf8')).schema!==1)throw new Error('Unsupported prepared native runtime');
const files = ["src/CharacterThread.js", "src/ConfigUtil.js", "standalones/CharacterCoordinator.js", "game_files.js"];
const nativeRootFiles=['account_info.js','game_files.js','html_vars.js','ipcStorage.js','main.js','monitoring_util.js'];
function nativeIncluded(relative:string,name:string,directory:boolean):boolean{
  if(relative)return true;
  return directory?['src','standalones','presentation'].includes(name):nativeRootFiles.includes(name);
}
async function nativeFiles(directory:string,relative=''):Promise<string[]>{
  const result:string[]=[];
  for(const entry of await readdir(path.join(directory,relative),{withFileTypes:true})){
    const name=relative?relative+'/'+entry.name:entry.name;
    // The artifact store verifies the dependency junctions, so nativeFiles skips node_modules and
    // refuses any link inside the executable tree.
    if(!relative && entry.name==='node_modules')continue;
    if(entry.isSymbolicLink())throw new Error('Native artifact contains a redirected executable: '+name);
    if(!nativeIncluded(relative,entry.name,entry.isDirectory()))continue;
    if(entry.isDirectory())result.push(...await nativeFiles(directory,name));
    else if(entry.isFile())result.push(name);
  }
  return result;
}
// The prepared marker lists every native executable file of the artifact or the target.
for(const file of await nativeFiles(artifactNative||target))if(!files.includes(file))files.push(file);
const originals = new Map<string, string|null>();
async function cleanupStage():Promise<void>{
  const parent=stageOption>=0?path.resolve(process.argv[stageOption+1]):path.resolve(root,'.build/caracal-upgrades');
  const relative=path.relative(parent,path.resolve(stage));
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Refusing installer stage cleanup outside staging directory');
  const info=await lstat(stage).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return undefined;throw error;});
  if(info?.isSymbolicLink())throw new Error('Refusing redirected installer stage');
  if(info)await rm(path.resolve(stage),{recursive:true,force:true});
}
try{
for (const file of files) {
  const original=await readFile(path.join(target,file),'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
  const content = artifactNative?await readFile(path.join(artifactNative,file),'utf8'):original;
  if(content===null)throw new Error('Missing native executable: '+file);
  originals.set(file, original);
  await mkdir(path.dirname(path.join(stage, file)), { recursive: true });
  // CJS resolution preloading does not intercept ESM dynamic imports. Pin the
  // verified upstream node-fetch boundary explicitly for managed native code.
  const prepared=content.replaceAll('import("node-fetch")','import(process.env.AL_CONSOLE_ARTIFACT ? require("node:url").pathToFileURL(require("node:module").createRequire(require("node:path").join(process.env.AL_CONSOLE_ARTIFACT, ".caracal/package.json")).resolve("node-fetch")).href : "node-fetch")');
  await writeFile(path.join(stage, file), prepared);
  await writeFile(path.join(stage, file + ".before"), content);
}
async function run(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("caracAL upgrade validation failed")),
    );
  });
}
// The coordinator is replaced wholesale by the maintained launcher. Only the
// separate character runner still needs an upstream compatibility transform.
if(!preparedNative)await run([path.join(root, "tools/caracal/upgrade-runner.mts"), stage]);
// Setup builds the runtime after installation; start-console builds it before
// starting the supervisor. Installation itself never executes the application.
const launcher = await readFile(path.join(root, "tools/caracal/CharacterCoordinator.cjs"), "utf8");
if (!isCoordinatorApplicationLauncher(launcher)) throw new Error("Invalid coordinator launcher template");
await writeFile(path.join(stage, "standalones/CharacterCoordinator.js"), launcher);
await writeFile(path.join(stage, "game_files.js"),
  'module.exports = require(process.env.AL_CONSOLE_ARTIFACT ? require("node:path").join(process.env.AL_CONSOLE_ARTIFACT, "runtime/lifecycle/coordinator/client-files.cjs") : "../runtime/lifecycle/coordinator/client-files.cjs");\n');
if(!preparedNative)for (const file of files) if(/\.[cm]?js$/.test(file))await run(["--check", path.join(stage, file)]);
for (const file of files)
  if ((await readFile(path.join(target, file), "utf8").catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;})) !== originals.get(file))
    throw new Error("caracAL changed while preparing the upgrade; no hooks installed");

// The launcher calls this only after stopping the old supervisor. install.mts transforms and
// syntax-checks every staged file before it replaces any.
for (const file of files) {
  const content = await readFile(path.join(stage, file), "utf8");
  if (content === originals.get(file)) continue;
  const destination = path.join(target, file);
  await mkdir(path.dirname(destination),{recursive:true});
  const temporary = destination + "." + randomUUID() + ".tmp";
  await writeFile(temporary, content);
  await rename(temporary, destination);
}
console.log("Validated character runner and TypeScript coordinator launcher installed.");
if(!artifactNative)await writeFile(path.join(target,'prepared-runtime.json'),JSON.stringify({schema:1}));
}finally{
  await cleanupStage();
}
