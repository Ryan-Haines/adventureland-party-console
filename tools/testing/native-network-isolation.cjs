const {chromium}=require('playwright');
const http=require('node:http'),crypto=require('node:crypto'),os=require('node:os'),fs=require('node:fs'),path=require('node:path');
const {nativeNetworkIsolation}=require('../../e2e/native-network-isolation.ts');
(async()=>{
 const hits=[],sockets=new Set();
 const server=http.createServer((req,res)=>{hits.push({url:req.url,host:req.headers.host});res.setHeader('Access-Control-Allow-Origin','*');res.end(req.url==='/document'?'<!doctype html><body>Network isolation proof</body>':'ok');});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 server.on('upgrade',(req,socket)=>{hits.push({url:req.url,host:req.headers.host,ws:true});const accept=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');socket.write(Buffer.from([0x81,2,111,107]));});
 await new Promise(resolve=>server.listen(0,'::',resolve));const port=server.address().port;
 const proxyDenied=[];const network=await nativeNetworkIsolation(proxyDenied);
 const lan=Object.values(os.networkInterfaces()).flat().find(address=>address.family==='IPv4'&&!address.internal)?.address;
 if(!lan)throw Error('Need a controlled non-loopback interface');
 const browser=await chromium.launch({headless:true});const result={port,lan,trials:[]};
 try{
 for(const mode of ['intercept','proxy']){
  const context=await browser.newContext(mode==='proxy'?{proxy:network.proxy}:{});
  const denied=[];if(mode==='intercept')await context.route('**/*',route=>{const u=new URL(route.request().url());if(['127.0.0.1','localhost','[::1]'].includes(u.hostname))return route.continue();denied.push(u.href);return route.abort('blockedbyclient');});
  const page=await context.newPage();await page.goto('http://127.0.0.1:'+port+'/document');
  const allowed=await page.evaluate(async port=>{const out=[];for(const host of ['127.0.0.1','localhost','[::1]']){const response=await fetch('http://'+host+':'+port+'/allowed');out.push({host,text:await response.text()});}for(const host of ['127.0.0.1','localhost','[::1]'])out.push(await new Promise((resolve,reject)=>{const ws=new WebSocket('ws://'+host+':'+port+'/ws');ws.onmessage=e=>{resolve({host,ws:e.data});ws.close();};ws.onerror=reject;}));return out;},port);
  const external=await page.evaluate(async({port,lan})=>{const urls=['http://'+lan+':'+port+'/external','https://'+lan+':'+port+'/external','http://198.51.100.1:'+port+'/external','https://fixture-external.invalid/external'];return await Promise.all(urls.map(async url=>{try{await fetch(url);return {url,blocked:false};}catch{return {url,blocked:true};}}));},{port,lan});
  const wsExternal=await page.evaluate(({port,lan})=>new Promise(resolve=>{const ws=new WebSocket('ws://'+lan+':'+port+'/external-ws');ws.onopen=()=>{ws.close();resolve(false);};ws.onerror=()=>resolve(true);}),{port,lan});
  const timings=[];for(let trial=0;trial<3;trial++)timings.push(await page.evaluate(async port=>{const at=performance.now();for(let n=0;n<100;n++)await fetch('http://127.0.0.1:'+port+'/timing?n='+n,{cache:'no-store'});return performance.now()-at;},port));
  if(allowed.length!==6||allowed.some(value=>(value.text??value.ws)!=='ok')||external.some(value=>!value.blocked)||mode==='proxy'&&!wsExternal)throw Error('Network isolation proof failed '+JSON.stringify({mode,allowed,external,wsExternal}));
  result.trials.push({mode,allowed,external,wsExternal,timings,denied});await context.close();
 }
 result.proxyDenied=proxyDenied;result.hits=hits.length;result.externalServerHits=hits.filter(hit=>hit.url.startsWith('/external'));fs.mkdirSync(path.resolve(__dirname,'../../.build'),{recursive:true});fs.writeFileSync(path.resolve(__dirname,'../../.build/native-network-proof.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result.trials.map(({mode,timings,external,wsExternal})=>({mode,timings,external,wsExternal}))));
 }finally{await browser.close();await network.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
