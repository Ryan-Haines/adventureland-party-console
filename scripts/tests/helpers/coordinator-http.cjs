function httpFixture(){
 const handlers=new Map();
 const router={get:(path,handler)=>handlers.set('GET '+path,handler),post:(path,handler)=>handlers.set('POST '+path,handler)};
 function invoke(method,path,body,params={}){
  const request={body,params,on(event,callback){this[event]=callback;}};
  const response={code:200,headers:{},chunks:[],ended:false,
   status(code){this.code=code;return this;},json(body){this.body=body;},end(){this.ended=true;},
   set(name,value){if(typeof name==='string')this.headers[name]=value;else Object.assign(this.headers,name);},
   flushHeaders(){this.flushed=true;},write(chunk){this.chunks.push(chunk);},sendStatus(code){this.code=code;}};
  const result=handlers.get(method+' '+path)(request,response);
  return {request,response,result};
 }
 return {router,handlers,invoke};
}
module.exports={httpFixture};
