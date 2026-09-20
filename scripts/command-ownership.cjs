// Bounded command ownership diagnostics; never logs command payloads or inventory.
module.exports=function commandOwnership(party) {
 const describe=c=>c?{id:c.id,type:c.type,convoyId:c.convoyId||null,jobId:c.jobId||null,cycleId:c.cycleId||null}:null;
 const record=(name,before,after)=>{
  if(!before?.convoyId&&!after?.convoyId)return;
  const entries=party.combatLogs[name] ||= [];
  entries.push({at:Date.now(),type:'navigation',message:'Command ownership changed',details:{before:describe(before),after:describe(after),
   source:String(new Error().stack).split('\n').slice(3,6).map(s=>s.trim())}});
  if(entries.length>200)entries.splice(0,entries.length-200);
 };
 party.commands=new Proxy(party.commands,{set(target,name,value){record(name,target[name],value);target[name]=value;return true;},
  deleteProperty(target,name){record(name,target[name],null);return Reflect.deleteProperty(target,name);}});
 return {clear(name,match){const command=party.commands[name];if(command&&match(command))delete party.commands[name];}};
};
