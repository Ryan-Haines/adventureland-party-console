/** Separate from kill logs so movement and ownership transitions remain inspectable. */
export function installCombatTrace(root:any,shared:any){
 const entries=root.__partyCombatTrace||[];root.__partyCombatTrace=entries;
 let signature='';
 const timer=setInterval(()=>{
  const next=shared.combatTraceSnapshot?.();if(!next)return;
  const key=JSON.stringify(next);if(key===signature)return;signature=key;
  entries.push({at:Date.now(),...next});while(entries.length>160)entries.shift();
 },250);
 return {stop:()=>clearInterval(timer)};
}
