import type {Page} from '@playwright/test';
import {expect,type LiveGame} from './live-fixtures';

// The Cave dashboard view and action the Cave specs and rows drive (cave-pacing-row.ts,
// live-cave.spec.ts, live-cave-headless.spec.ts, live-cave-talk.spec.ts).
export type CaveView=()=>Promise<any>;
export type CaveAct=(body:Record<string,unknown>)=>Promise<any>;
export const caveView=(live:LiveGame,page:Page):CaveView=>async()=>await (await page.request.get(live.url+'/party-api/daily-dungeons',{maxRetries:1})).json();
export const caveAct=(live:LiveGame):CaveAct=>body=>live.post('/daily-dungeons',{operationId:crypto.randomUUID(),...body});

// Votes the first free option of an open choice and waits until both members show the resolved
// vote for it. It reads the leader's current choice when the caller passes none, and returns the
// option, or false when no choice is open.
export async function voteAndSettle(view:CaveView,act:CaveAct,cave?:any,message='Both native participant votes must settle for this exact choice'){
  const c=cave??(await view()).members[0]?.observation?.cave;
  if(!c?.choice||c.choice.resolved)return false;
  const option=c.choice.options.find((o:any)=>!o.unavailable&&!o.cost&&!o.amber);
  expect(option,'The open choice must offer a free option').toBeTruthy();
  await act({action:'vote',run:c.run,choice:c.choice.id,option:option.id});
  await expect.poll(async()=>{
    const current=await view();
    return current.state.run===c.run&&current.members.length===2&&current.members.every((m:any)=>{
      const observed=m.observation?.cave,choice=observed?.choice;
      return m.fresh&&m.observation?.alive&&observed?.run===c.run&&observed.floor===c.floor&&
        choice?.id===c.choice.id&&choice.resolved&&choice.votes?.[m.name]===option.id;
    });
  },{timeout:30_000,message}).toBe(true);
  return option;
}
