import {test} from './live-fixtures';
import type {LiveGame} from './live-fixtures';
import type {TestInfo} from '@playwright/test';
import {onlyRows,runRows,type TableRow} from './fixtures';

// Scenario tables for gameplay E2E: rows that can
// share one game run are steps of one test, so the stack boots once for all rows.
// The row loop, its reset and E2E_ROWS are e2e/fixtures.ts `runRows`, which the console
// fixture's tables share. A row that drives the dashboard takes the test's page as its third
// argument.
export type Row = TableRow<LiveGame>;
type Evidence = (live: LiveGame, info: TestInfo, label: string) => Promise<void>;
// Each fighter's own reads: its nomination (blocked reason, rejections, eligible), its pending Hunt
// loot, its farming and potion holds, and its targeting answers, with whether it may fight `monster`
// when the row names one.
const fighterRead = (monster?: string) => `(()=>{if(character.ctype==='merchant')return undefined;
  const id=f=>{try{const t=f();return t?String(t.id):null;}catch(e){return 'threw '+String(e).slice(0,80);}},t=globalThis.sharedRoutine?.targeting,n=globalThis.__partyNomination;
  const m=${JSON.stringify(monster ?? null)},e=m!=null?parent.entities[m]:null;
  return {at:[character.map,Math.round(character.real_x),Math.round(character.real_y)],target:character.target??null,
    nomination:n?{blocked:n.blocked??null,rejected:n.rejected??null,eligible:n.eligible??null,focus:n.focus??null}:null,
    event:(()=>{const f=globalThis.__partyEventFacts,read=g=>{try{return g();}catch(e){return 'threw '+String(e).slice(0,80);}};
      return f?{eventTypes:read(()=>f.eventTargets().types),eventJoined:read(()=>f.joinedEventName()),eventTravelling:read(()=>f.travellingEventName()),
        onEventMap:read(()=>!!(G.maps[character.map]&&G.maps[character.map].event))}:null;})(),
    lootPending:(()=>{try{return globalThis.partyHunting.facts.focus.lootPending;}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    // The farming mode and the walk facts that block the nomination: the coordinator's travel hold
    // and the farm reunion's phase with its command.
    farming:(()=>{try{const f=globalThis.partyHunting.farm,r=globalThis.__partyReunion;return {mode:f.mode(),grouped:!!f.grouped(),travelCombat:globalThis.__partyTravelCombat??null,
      reunion:r?{phase:r.phase??null,command:r.command?{id:r.command.id,type:r.command.type,handoff:r.command.convoyHandoff??null}:null}:null};}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    // What holds the potion family: each potion skill's game edge (ms from now), the turns owner's
    // answer for the family and its last potion records.
    potions:(()=>{try{const k=['use_hp','use_mp','regen_hp','regen_mp'],tu=globalThis.__partyTurns,ns=parent.next_skill||{},fam=tu?tu.family('use_hp'):null;
      return {edges:Object.fromEntries(k.map(s=>[s,ns[s]?Math.round(+ns[s]-Date.now()):null])),family:fam,
        ready:tu?Object.fromEntries(k.map(s=>{const r=tu.ready(s);return [s,{ready:r.ready,flying:r.flying}];})):null,
        records:tu?tu.records().filter(r=>r.family===fam).slice(-6).map(r=>[r.at,r.kind,r.skill,r.reason??null]):null};}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    // The Town send's gate (executor.ts readyTown): targeting's departure answer, the lootPending read above,
    // the game's own use_town answers, and the call budget's town answers per band, its waits and held count.
    // The turns ring keeps refusals, waits, lost replies, cooldown and stale replies; it records no sends, so the
    // last 10 per family are those, with the turns meter's send count beside them.
    town:(()=>{const r=g=>{try{return g();}catch(e){return 'threw '+String(e).slice(0,80);}},h=globalThis.__partyHooks,c=globalThis.__partyCalls,v=r(()=>c.view());
      return {departurePending:r(()=>h.ask('targeting.departurePending')),canUseTown:r(()=>!!can_use('use_town')),townCooldown:r(()=>!!is_on_cooldown('use_town')),
        townAnswers:typeof v==='object'?Object.fromEntries(Object.entries(v.answers).filter(([,a])=>a.town).map(([b,a])=>[b,a.town])):v,
        callsHeld:typeof v==='object'?{held:v.held,heldHead:v.heldHead,waiting:v.waiting,used:v.used,limit:v.limit}:v,
        callRecords:r(()=>c.records().filter(x=>x.method==='town').slice(-5))};})(),
    turnsRing:(()=>{try{const tu=globalThis.__partyTurns,by={};for(const x of tu.records()){(by[x.family]??=[]).push([x.at,x.kind,x.skill,x.rank??null,x.by??null,x.reason??null,x.ms??x.waitedMs??null]);}
      return {meter:tu.meter(),hold:(h=>({stop:h.stop,asks:h.asks,pulse:h.pulse,roleLoop:h.roleLoop,combat:h.combat,potions:h.potions,refusal:h.refusal}))(tu.hold()),
        families:Object.fromEntries(Object.entries(by).map(([f,l])=>[f,l.slice(-10)]))};}catch(e){return 'threw '+String(e).slice(0,80);}})(),
    targeting:t?{grouped:id(()=>t.getGroupedTarget()),preferred:id(()=>t.getPreferredTarget()),focused:id(()=>t.getNearestFocusedMonster()),
      monster:m==null?undefined:e?(()=>{const d={};const ok=t.isAllowedTarget?.(e,undefined,d);return {ok,reason:d.reason??null};})():'not in sight'}:null};})()`;
// A fighter's event facts (types, joined, travelling, event map) are the conditions that stop it grouping.
// A failed row prints the coordinator's rare, Hunt and walk state, each group's task ring and each
// fighter's own reads as they stand at the failure. A read that fails prints its error, so the dump
// never hides the row's own error. A row that cleans up its own plants calls it before that cleanup.
export async function failedRowState(live: LiveGame, name: string, monster?: string) {
  const read = async (get: () => Promise<any>) => { try { return await get(); } catch (error) { return { error: String((error as Error)?.message ?? error) }; } };
  const fighters: Record<string, unknown> = {};
  for (const [member, client] of Object.entries(live.clients)) {
    const answer = await read(() => client.run(fighterRead(monster)));
    if (answer != null) fighters[member] = answer;
  }
  const state = await read(() => live.state()), tasks = await read(() => live.tasks());
  const rare = state.error ? state : { rareHuntState: state.rareHuntState ?? null, passiveHunting: state.passiveHunting ?? null,
    passiveRareHunts: state.passiveRareHunts ?? null, rareRetryEvidence: state.rareRetryEvidence ?? null, rarePursuitProgress: state.rarePursuitProgress ?? null };
  const hunt = state.error ? state : { targetMode: state.targetMode ?? null, followers: state.followers ?? null, monsterHunt: state.monsterHunt ?? null,
    activeConvoy: state.activeConvoy ?? null, groupedCombat: state.groupedCombat ?? null };
  const groups = tasks.error ? tasks : (tasks.groups ?? []).map((g: any) => ({ id: g.id, members: g.members, live: g.live ?? null, status: g.status ?? null, ring: g.ring ?? [] }));
  console.log(`ROW-STATE ${name} ${JSON.stringify({ rare, hunt, groups, fighters })}`);
}
export function liveScenarioTable(title: string, timeoutMs: number, reset: (live: LiveGame, info: TestInfo) => Promise<void>, rows: Row[], evidence?: Evidence) {
  rows = onlyRows(title, rows);
  test(title, async ({live, page}, info) => {
    test.setTimeout(timeoutMs);
    // Each row's registered plants come undone as the row ends, pass or fail (live-fixtures.ts
    // undo); a failed row's state prints before the undo changes it.
    const undone: Row[] = rows.map(([name, run]) => [name, async (world, rowInfo, rowPage) => {
      try { await run(world, rowInfo, rowPage); }
      catch (error) { await failedRowState(world, name); throw error; }
      finally { await world.undoRow(); }
    }]);
    await runRows(live, info, page, undone, reset, evidence);
  });
}
