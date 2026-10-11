import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBuilder } from "../../dashboard/node_modules/vite/dist/node/index.js";
import { withBuildLock } from '../build-store.ts';
import {readFile,writeFile,readdir} from 'node:fs/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../dashboard");
process.chdir(root);
process.env.AL_DASHBOARD_OUT_DIR ||= ".build/validation";
// Vinext's CLI always cleans dashboard/dist. Use Vite's application builder
// directly so a build cannot remove files used by the active server.
await withBuildLock(path.join(root, '.build'), async () => {
// Older hosts may copy Vinext's cached font CSS into a private build snapshot.
// Rebase its machine-specific URLs before Vinext rewrites them to served assets.
const fontCache=path.join(root,'.vinext/fonts');
for(const family of await readdir(fontCache,{withFileTypes:true}).catch((error:NodeJS.ErrnoException)=>{
  if(error.code==='ENOENT')return [];throw error;
})){
  if(!family.isDirectory())continue;
  const cssFile=path.join(fontCache,family.name,'style.css');
  const css=await readFile(cssFile,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return '';throw error;});
  const rebased=css.replace(/url\(([^)]*\/\.vinext\/fonts\/[^/]+\/([^/)]+))\)/g,(_match,_old,name)=>
    `url(${path.join(fontCache,family.name,name).replaceAll('\\','/')})`);
  if(rebased!==css)await writeFile(cssFile,rebased);
}
const builder = await createBuilder({
  root,
  configFile: path.join(root, "vite.config.ts"),
  mode: "production",
});
await builder.buildApp();
});
