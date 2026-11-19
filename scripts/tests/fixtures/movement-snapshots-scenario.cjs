// The movement snapshot store (a shared setup lives in the harness).
// Isolated test for the saved movement snapshots.
// Failure list first, in
// e2e/movement-owner-failures.md. The walks scenario saves snapshots in
// play; eight days of virtual time and 25 triggers are run here on an injected clock.
const test=require('node:test'), assert=require('node:assert/strict');
const {createMovementRecords,SNAPSHOTS_KEPT}=require('../../../runtime/movement/coordinator/records.ts');

function store(){
  // The snapshot directory as an in-memory file system: one entry per file path, and a missing
  // file throws as node:fs does.
  let now=1_000_000;const paths=new Map(),root='/snapshots';
  const files={readdirSync:d=>[...paths.keys()].filter(p=>p.startsWith(d+'/')).map(p=>p.slice(d.length+1)),
    readFileSync:p=>{if(!paths.has(p))throw Error('ENOENT '+p);return paths.get(p);},mkdirSync(){},
    writeFileSync:(p,b)=>{paths.set(p,b);},unlinkSync:p=>{if(!paths.delete(p))throw Error('ENOENT '+p);}};
  const service=createMovementRecords({now:()=>now,directory:root,files,notify:(hook,payload)=>told.push([hook,payload])});
  const told=[];
  return {service,files:c=>files.readdirSync(root+'/'+encodeURIComponent(c)),write:(c,file,body)=>files.writeFileSync(root+'/'+encodeURIComponent(c)+'/'+file,body),
    advance:ms=>{now+=ms;},get now(){return now;},told};
}

module.exports = { store };
