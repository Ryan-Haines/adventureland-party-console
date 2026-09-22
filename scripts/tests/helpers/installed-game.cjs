const fs=require('node:fs'),path=require('node:path');
const cache=path.resolve(__dirname,'../../../.caracal/game_files');
const versions=fs.readdirSync(cache).filter(v=>/^\d+$/.test(v) && fs.existsSync(path.join(cache,v,'data.js'))).map(Number);
if(!versions.length)throw Error('Installed-game tests require a complete downloaded game client in .caracal/game_files');
const version=Math.max(...versions);
module.exports={version,directory:path.join(cache,String(version))};
