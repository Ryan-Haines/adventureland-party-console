const fs=require('node:fs');
const path=require('node:path');

/** Reads an installed game fixture without pinning tests to a cache the live coordinator can retire. */
function downloadedGameSource(filename){
 const root=path.resolve('.caracal/game_files');
 const versions=fs.readdirSync(root).filter(name=>/^\d+$/.test(name)).sort((a,b)=>Number(b)-Number(a));
 for(const version of versions){
  try{return fs.readFileSync(path.join(root,version,filename),'utf8');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
 throw new Error('No downloaded game fixture contains '+filename);
}
module.exports={downloadedGameSource};
