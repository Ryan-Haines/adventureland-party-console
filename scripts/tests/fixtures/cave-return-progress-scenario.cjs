// The coordinator over a Cave return (a shared setup lives in the harness).
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createReturnProgressRoute}=require('../../../runtime/events/coordinator/routes.ts');
const source=fs.readFileSync('characters/shared.js','utf8');
function coordinator(){
 const state={townCycle:{id:'town',pending:['L']},deferredEventReturns:{},returnProgress:{}};let saves=0,revision=2;
 const route=createReturnProgressRoute(state,{owned:()=>true,intent:()=>({revision}),persist:()=>saves++});
 return {state,saves:()=>saves,rev:n=>revision=n,call(body){const res={code:200,status(n){this.code=n;return this;},json(body){this.body=body;return this;}};
 route({body:{character:'L',kind:'town',cycleId:'town',navigationRevision:2,...body}},res);return res;}};
}

module.exports = { coordinator };
