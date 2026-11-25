// A scratch checkout with add-on folders, for the add-on system's tests.
// It is a git repository, so a test reads what an
// add-on command changed from `git status`, and it holds only runtime/addons/: an add-on's
// generated imports of the core are type imports, which Node's type stripping drops.
const {spawnSync}=require('node:child_process'), fs=require('node:fs'), os=require('node:os'), path=require('node:path');

// An add-on's index.ts: its registration, with the slot entries `slots` and the hooks source `hooks`.
const registrationSource=(name,{slots=[],hooks='{}'}={})=>
  `import type { Registration } from '../../hooks/addon-api.ts';\nexport const registration: Registration = { name: ${JSON.stringify(name)}, folder: 'addons', `+
  `author: 'test', summary: 'A scratch add-on.', hooks: ${hooks}, slots: ${JSON.stringify(slots)} };\n`;
function scratchRoot(folders={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'addon-root-'));
  // A git step that fails stops the setup with its command and stderr, so a caller never reads a
  // wrong file list from a repository git could not build.
  const git=(...args)=>{
    const result=spawnSync('git',['-C',dir,...args],{encoding:'utf8'});
    if(result.error||result.status!==0)throw Error(`git ${args.join(' ')} failed: ${result.error||result.stderr}`);
    return result;
  };
  git('init','-q');git('config','user.email','test@example.com');git('config','user.name','test');
  fs.writeFileSync(path.join(dir,'.gitignore'),'.build/\n');
  for(const [name,files] of Object.entries(folders))addFolder(dir,name,files);
  git('add','-A');git('commit','-qm','scratch');
  return {dir,git,status:()=>git('status','--porcelain','-uall').stdout.split('\n').filter(Boolean).map(l=>l.slice(3)),
    cleanup:()=>fs.rmSync(dir,{recursive:true,force:true})};
}
// `files` maps a file name in the folder to its text; `true` for index.ts writes a registration.
function addFolder(dir,name,files={'index.ts':true,'README.md':'# scratch\n'}){
  const at=path.join(dir,'runtime/addons',name);fs.mkdirSync(at,{recursive:true});
  for(const [file,text] of Object.entries(files)){fs.mkdirSync(path.dirname(path.join(at,file)),{recursive:true});
    fs.writeFileSync(path.join(at,file),text===true?registrationSource(name):text);}
}
module.exports={scratchRoot,addFolder,registrationSource};
