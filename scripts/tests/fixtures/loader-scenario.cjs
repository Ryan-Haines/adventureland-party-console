// A game window for the built CODE loader (.build/runtime/universal-loader.js), in the shared harness
//: jsdom on adventure.land with WebCrypto, a captured
// setInterval and the row's `fetch` stub.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash,webcrypto}=require('node:crypto');
const {JSDOM}=require('../../../.caracal/node_modules/jsdom');
const loaderSource=()=>fs.readFileSync('.build/runtime/universal-loader.js','utf8');
// The class manifest the loader checks a warrior's CODE file against.
const sha=code=>createHash('sha256').update(code).digest('hex');
const manifestFor=code=>({schema:1,classes:{warrior:{file:`generated/${sha(code)}/warrior.js`,sha256:sha(code)}}});
// `globals` replaces or adds window globals (a timed AbortSignal, the bridge's hooks); `resources`
// is jsdom's script loader for a row that loads the bundle through a script tag.
function loaderWindow({fetch,globals={},resources}){
 const dom=new JSDOM('',{url:'https://adventure.land',runScripts:'dangerously',...(resources?{resources}:{})}),w=dom.window;
 let interval;
 Object.defineProperty(w.crypto,'subtle',{value:webcrypto.subtle});
 Object.assign(w,{TextEncoder,AbortSignal,AbortController,character:{name:'P',ctype:'warrior'},game_log(){},
  setInterval:fn=>{interval=fn;return 1;},clearInterval(){},fetch},globals);
 // WebCrypto completes on a worker thread, so `until` waits on real 10 ms timers, not event-loop turns.
 const until=async predicate=>{for(let i=0;i<200&&!predicate();i++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate());};
 return {w,until,interval:()=>interval(),close(){w.__partyCodeLoader?.dispose();w.close();}};
}
module.exports={loaderWindow,loaderSource,manifestFor,sha};
