// The hosting tests' servers and setup page (tools/hosting), in the shared harness.
// A server on a free local port, answering with the port.
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(server.address().port)));
// close drops kept-alive connections first, so the close resolves without waiting on a client.
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});
// The setup page (tools/hosting/page.ts) in jsdom at `url`. `plant` sets the window's fetch and
// timer stubs before the page's script runs; `flush` lets the page's pending replies land.
function setupDom(plant,url='http://lan:3010/setup'){
 const {JSDOM}=require('../../../.caracal/node_modules/jsdom'),{setupPage}=require('../../../tools/hosting/page.ts');
 const dom=new JSDOM(setupPage,{url,runScripts:'dangerously',beforeParse:plant});
 return {dom,el:id=>dom.window.document.getElementById(id),flush:()=>new Promise(resolve=>setImmediate(resolve))};
}
module.exports={listen,close,setupDom};
