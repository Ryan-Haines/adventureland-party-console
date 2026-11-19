// The attack edge counts and the gameplay clock's step,
// apart from turns-rows.ts so scripts/tests/turns-tc11.test.cjs loads them without the live stack.
import {HEAL_FIRST_BELOW as HEAL_FIRST_BELOW_PERCENT} from '../runtime/characters/turns/saved-fields.ts';
import {targetingSavedFields} from '../runtime/characters/targeting/saved-fields.ts';
type Party=Record<string,{hp:number;max:number;dist:number}>;
export type Tc11Log={ring:{at:number;kind:string;family:string}[];
  spends:{at:number;method:string;name?:string;item?:string;edge?:number}[];
  replies:{at:number;place:string|null;response:string|null;failed:boolean;ms:number|null}[];
  samples:{at:number;target:boolean;inRange?:boolean;mpAttacks?:boolean;party:Party;tid?:string|null;skip?:SkipRecord|null}[]};
// Targeting's overkill skip on the sample's target, as the page sampler copies it from
// `__partyTargeting.skip.held` (runtime/characters/targeting/retire.ts `HeldSkip`).
export type SkipRecord={target:string;damage:number;hp:number;last:number};
// Decided 2026-11-09: an empty attack edge is no
// fault only where the skip recorded that it passed over the character's target on that edge. A
// sample holds the skip when the skip's record names the sample's own target, its damage in flight
// covers that target's HP, and its last pass is at most one selection before the sample: the role
// runner asks the selection once per targeting's `targetPassMs` (runtime/characters/targeting/
// saved-fields.ts), and its answer stands between two asks (a skip's passes once came 1201 ms
// apart, the clock's step included).
export const SELECTION_MS=targetingSavedFields.settings.targetPassMs.default;
export const skipHeld=(s:{at:number;tid?:string|null;skip?:SkipRecord|null},pass:number)=>
  !!s.skip&&!!s.tid&&s.skip.target===s.tid&&s.skip.hp>0&&s.skip.damage>=s.skip.hp&&s.at-s.skip.last<=pass;
// A gap's skipped stretch: the first and last sample the skip held, or null where it held none. The
// stretches before and after it are judged as any other part of the gap.
export function skipStretch<T extends {at:number;tid?:string|null;skip?:SkipRecord|null}>(samples:T[],pass:number){
  const held=samples.filter(s=>skipHeld(s,pass));
  return held.length?{first:held[0]!,last:held.at(-1)!}:null;
}
// The default: the priest heals first while anyone is below this share of HP.
export const HEAL_FIRST_BELOW=HEAL_FIRST_BELOW_PERCENT/100;
export const below=(s:{party:Party},name:string,line:number)=>{const m=s.party[name];return !!m&&m.max>0&&m.hp/m.max<line;};
// A family sent while its `next_skill` edge has not passed, and the
// attack family left waiting more than one pass after the server's edge with its attack open: a
// target in range with MP for the attack above the priest's attack forecast (forecast.ts
// `priestAttacks`), or for a healer a member below "Heal first below", on every sample of the
// gap, and no `not-now` wait or refusal in the executor's ring. The edge is the cooldown from the
// accepted reply less the smallest ping, as the game client's `next_skill` and its ping
// compensation set it, or a `cooldown` reply's `ms` less that ping. A pass is the gameplay
// clock's step alone: the turns executor arms a one-shot timer at the family's edge
// (runtime/characters/turns/executor.ts `armAttack`), so no role loop tick sits between the edge
// and the send.
export function tc11(log:Tc11Log,from:number,to:number,step:number,cooldown:number,rtt:number,healer:boolean){
  const spends=log.spends.filter(s=>s.at>=from&&s.at<to);
  // A potion goes as an `equip` of a potion slot or a regeneration `use` (executor.ts `question`);
  // an `equip` of gear is no turns family's send.
  const potionSend=(s:Tc11Log['spends'][number])=>s.method==='use'||s.method==='equip'&&/^[hm]pot/.test(String(s.item));
  const sendsBeforeEdge=spends.filter(s=>s.method!=='equip'||potionSend(s)).filter(s=>(s.edge??0)>s.at).map(s=>({at:s.at-from,method:s.method,name:s.name??null,earlyMs:(s.edge??0)-s.at}));
  // The heal shares the attack family (game data `share`), so either frees it and either is its send.
  const family=(x:string|null)=>x==='attack'||x==='heal';
  const attacks=spends.filter(s=>family(s.method)),slot=Number.isFinite(step)?step:0,waits:any[]=[],skipped:any[]=[];
  // The time the skip held a ready family over the window, for the attack rate.
  let skipHeldMs=0;
  for(const reply of log.replies.filter(r=>r.at>=from&&r.at<to&&family(r.place))){
    const free=reply.at,next=attacks.find(s=>s.at>free);
    if(!next)continue;
    const edge=!reply.failed?free+cooldown-rtt:reply.response==='cooldown'&&Number.isFinite(reply.ms)?free+Number(reply.ms)-rtt:free;
    const ready=Math.max(free,edge),gap=next.at-ready,inGap=(at:number)=>at>ready&&at<next.at;
    if(gap<=0)continue;
    const samples=log.samples.filter(s=>inGap(s.at)),skip=skipStretch(samples,SELECTION_MS+(Number.isFinite(step)?step:0));
    // A skipped edge: the skip held from within a pass of the edge to within a pass of the send.
    const covered=!!skip&&skip.first.at-ready<=slot&&next.at-skip.last.at<=slot;
    if(covered){skipHeldMs+=gap;if(gap>slot)skipped.push({at:ready-from,gap,target:skip!.first.skip!.target,damage:skip!.first.skip!.damage,hp:skip!.first.skip!.hp});continue;}
    if(gap<=slot)continue;
    if(log.ring.some(e=>(e.kind==='wait'||e.kind==='refusal')&&e.family==='attack'&&e.at>=free&&e.at<=next.at+slot))continue;
    const open=(s:Tc11Log['samples'][number])=>s.target&&s.inRange&&s.mpAttacks!==false||healer&&Object.keys(s.party).some(n=>below(s,n,HEAL_FIRST_BELOW));
    if(samples.length&&samples.every(open))waits.push({at:ready-from,gap,...(skip?{skipFrom:skip.first.at-ready,skipTo:skip.last.at-ready}:{})});
  }
  return {sendsBeforeEdge,waitsWithoutNotNow:waits,skipped,skipHeldMs};
}
// The gameplay clock's step, read from replies as the smallest gap between two of them.
export const replyStep=(replies:{at:number}[])=>{const times=[...new Set(replies.map(r=>r.at))].sort((a,b)=>a-b);
  return times.slice(1).reduce((least,at,i)=>Math.min(least,at-times[i]!),Infinity);};
