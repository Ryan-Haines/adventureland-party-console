import {createServer,type IncomingMessage} from 'node:http';
import type {Socket} from 'node:net';

/** Owned local denial endpoint: never resolve, connect to or forward a target. */
export async function nativeNetworkIsolation(blocked:string[]) {
  const sockets=new Set<Socket>();
  const deny=(request:IncomingMessage,socket:{destroy():unknown})=>{
    const target=request.method==='CONNECT'?'https://'+request.url:request.url;
    try{const url=new URL(target||'');blocked.push(url.origin+url.pathname);}catch{blocked.push('invalid proxy target');}
    socket.destroy();
  };
  const server=createServer((request)=>deny(request,request.socket));
  server.on('connect',(request,socket)=>deny(request,socket));
  server.on('upgrade',(request,socket)=>deny(request,socket));
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{server.removeListener('error',reject);resolve();});});
  const address=server.address();
  if(!address||typeof address==='string')throw Error('Native denial proxy did not bind');
  return {proxy:{server:'http://127.0.0.1:'+address.port,bypass:'localhost,127.0.0.1,127.0.0.2,127.0.0.3,127.0.0.4,[::1]'},
    close:async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}};
}
