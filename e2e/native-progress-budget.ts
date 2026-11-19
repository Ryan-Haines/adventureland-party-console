/** Fixture wall-clock limits; only authoritative native progress may renew quiet time. */
export function createNativeProgressBudget(clock:()=>number,idleMs:number,totalMs:number){
 const startedAt=clock(),seen=new Set<string>();let seeded=false,lastProgressAt=startedAt;
 function check(){
  const now=clock();
  if(now-startedAt>=totalMs)throw Error('Native required rooms exceeded the absolute completion budget');
  if(now-lastProgressAt>=idleMs)throw Error('Native required rooms made no new native progress within the quiet completion budget');
 }
 return {
  check,
  observe(markers:readonly string[]){
   let changed=false;
   for(const marker of markers){if(!seen.has(marker)){seen.add(marker);changed=true;}}
   if(seeded&&changed)lastProgressAt=clock();seeded=true;check();
  },
  snapshot(){return{startedAt,lastProgressAt,elapsedMs:clock()-startedAt,quietMs:clock()-lastProgressAt,
   idleMs,totalMs,markers:[...seen]};},
 };
}
