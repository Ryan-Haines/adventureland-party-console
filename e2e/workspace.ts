import {existsSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import path from 'node:path';

/** Dispose only this fixture's owned workspace, after Playwright copies its evidence. */
export function cleanupWorkspace(root:string,directory:string) {
  const base=realpathSync(path.join(root,'.build/e2e'));
  if(lstatSync(directory).isSymbolicLink())throw Error('E2E workspace cleanup rejects links');
  const target=realpathSync(directory);
  if(path.dirname(target)!==base||!/^(live|scenario|dashboard)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(path.basename(target)))
    throw Error('E2E workspace cleanup escaped its owned UUID directory');
  const retained=process.env.E2E_KEEP_WORKSPACES==='1';
  if(!retained)rmSync(target,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  return {workspace:path.relative(root,target),policy:'after-attachment-copy',retained,removed:!existsSync(target)};
}
