import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {ConsoleBuildStore} from '../tools/console-build/store';

// The console build specs' candidate (console-build-prepared.spec.ts,
// console-build-transaction.spec.ts): a one-file build named and hashed by `label`, completed in
// the store. The store keeps its builds under <root>/.build/console, so the staged folder sits at
// <root>/<label>.
export async function stage(store:ConsoleBuildStore,label:string){
  const id=createHash('sha256').update(label).digest('hex'),dir=path.resolve(store.directory,'../..',label);
  await mkdir(path.join(dir,'app'),{recursive:true});await writeFile(path.join(dir,'app/item.txt'),label);
  return store.complete(dir,{schema:1,id,sourceHash:id,createdAt:new Date().toISOString(),components:{dashboard:id,coordinator:id,characters:id},files:{'item.txt':id}});
}
