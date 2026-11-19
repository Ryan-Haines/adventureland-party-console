// The downloaded game client the installed-game rows read, from .caracal/game_files. `gameFiles()`
// answers the newest complete version and `gameFiles(version)` the one a row names. A missing cache
// or version throws with the command that restores the pinned fixtures, so a row fails with the
// path it needs, not a skip.
const fs=require('node:fs'),path=require('node:path');
const cache=path.resolve(__dirname,'../../../.caracal/game_files');
const restore='node scripts/ci/restore-game-fixtures.cjs';
const complete=version=>fs.existsSync(path.join(cache,String(version),'data.js'));
function gameFiles(version){
 if(version!==undefined){
  const directory=path.join(cache,String(version));
  if(!complete(version))throw Error('Installed-game tests need game client '+version+' at '+directory+'; run '+restore);
  return {version:Number(version),directory};
 }
 const versions=fs.existsSync(cache)?fs.readdirSync(cache).filter(v=>/^\d+$/.test(v)&&complete(v)).map(Number):[];
 if(!versions.length)throw Error('Installed-game tests need a complete game client in '+cache+'; run '+restore);
 const newest=Math.max(...versions);
 return {version:newest,directory:path.join(cache,String(newest))};
}
module.exports={gameFiles,get version(){return gameFiles().version;},get directory(){return gameFiles().directory;}};
