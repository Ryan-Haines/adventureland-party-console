// The missed attack edges, apart from turns-rows.ts so
// scripts/tests/turns-tc2.test.cjs loads them without the live stack.
import {skipStretch,SELECTION_MS,type SkipRecord} from './turns-tc11.ts';
export type Tc2Input={actions:number[];samples:{at:number;cooldown?:number;tid?:string|null;skip?:SkipRecord|null}[];
  replies:{at:number;place:string|null;response:string|null;ms?:number|null}[];spends:{at:number;method:string}[];
  cooldown:number;rtt:number;step:number;busy:(s:any)=>boolean;from:number};
// An edge is missed where no accepted attack or heal lands within one cooldown and one
// round trip while the priest has a target or the warrior is below the line. The cooldown is the
// game's at that edge: the server checks an attack against the frequency it holds when the call
// arrives, so an edge after a party warcry ends sits one plain cooldown after the last action
// (an earlier run: 705.7 ms under the warcry, 961.5 ms after its `ex_condition`). Each gap reads the
// largest cooldown its samples saw, and the row's start reading where no sample holds one.
export function tc2({actions,samples,replies,spends,cooldown,rtt,step,busy,from}:Tc2Input){
  let missed=0;const gapsMissed:any[]=[],skipped:any[]=[];
  // Decided 2026-11-09: a gap the overkill skip held from within a pass of
  // its start to within a pass of its end is no missed edge, and is recorded.
  const selection=SELECTION_MS+(Number.isFinite(step)?step:0);
  // A send the server answers `cooldown` resends once the gameplay clock has stepped past the
  // reply, so such an edge's slot holds one more step. So does a send
  // whose target dies in flight: the server answers it with the target's `death` or
  // `disappear` (`not_found` in the log), and the executor resends on that reply (r2: three
  // edges of 1250 ms against a slot of 1108).
  const cooled=(a:number,b:number)=>replies.some(r=>r.at>a&&r.at<b&&(r.response==='cooldown'||r.response==='not_found')&&(r.place==='attack'||r.place==='heal'));
  for(let i=1;i<actions.length;i++){const gap=actions[i]!-actions[i-1]!;
    const inGap=samples.filter(s=>s.at>actions[i-1]!&&s.at<actions[i]!);
    const edge=Math.max(cooldown,...inGap.map(s=>Number(s.cooldown)).filter(Number.isFinite)),slot=edge+rtt+(Number.isFinite(step)?step:0);
    if(gap<=slot+(cooled(actions[i-1]!,actions[i]!)&&Number.isFinite(step)?step:0))continue;
    const skip=skipStretch(inGap,selection);
    if(skip&&skip.first.at-actions[i-1]!<=slot&&actions[i]!-skip.last.at<=slot){skipped.push({from:actions[i-1]!-from,gap,target:skip.first.skip!.target,damage:skip.first.skip!.damage,hp:skip.first.skip!.hp});continue;}
    if(inGap.length&&inGap.every(busy)){missed+=Math.floor((gap-slot+edge)/edge);gapsMissed.push({from:actions[i-1]!-from,gap,sends:spends.filter(s=>s.at>actions[i-1]!&&s.at<actions[i]!).map(s=>[s.at-from,s.method]),replies:replies.filter(r=>r.at>actions[i-1]!&&r.at<actions[i]!).map(r=>[r.at-from,r.place,r.response,r.ms])});}}
  return {missed,gapsMissed,skipped};
}
