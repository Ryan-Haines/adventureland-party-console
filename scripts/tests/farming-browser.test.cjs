const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),path=require('node:path'),fs=require('node:fs');
const {createRequire}=require('node:module');const {pathToFileURL}=require('node:url');
test('production browser bundle exposes geometry and renders shared and individual farming choices',async()=>{
 const requireDashboard=createRequire(path.resolve('dashboard/package.json'));
 const {build}=await import(pathToFileURL(requireDashboard.resolve('vite')).href);
 const {default:commonjs}=await import(pathToFileURL(requireDashboard.resolve('vite-plugin-commonjs')).href);
 // Match vinext's production transform: explicit project .cjs stays native CommonJS.
 const output=await build({plugins:[(commonjs.default || commonjs)({filter:id=>/\.c[jt]s$/i.test(id)&&!id.includes('node_modules')?false:undefined})],root:path.resolve('dashboard'),configFile:false,logLevel:'silent',build:{write:false,minify:true,
 lib:{entry:path.resolve('scripts/tests/fixtures/farming-browser-entry.mjs'),name:'FarmingBrowserRegression',formats:['iife']}}});
 const code=(Array.isArray(output)?output[0]:output).output.find(x=>x.type==='chunk').code;const context=vm.createContext({});vm.runInContext(code,context);
 const areas=context.farmingBrowserResult;assert.ok(areas.length>=3);assert.equal(areas[0].monsterIds.length,2);
 assert.ok(areas.some(a=>a.monsterIds.length===1));
});
test('browser runner geometry and CommonJS bundler entry stay identical',()=>{
 assert.equal(fs.readFileSync('characters/farming-zones.js','utf8'),fs.readFileSync('characters/farming-zones.cjs','utf8'));
});
