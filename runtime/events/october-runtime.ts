// The October runtime on the character:
// Trick or Treat's door route and knocks, and the Witch's Cipher (the gathering plan, the merchant's
// walk to the Witch and the brew), each step saved in the runtime's journal so a reload resumes it.
import { eventKey, leadFor } from './rules.ts';
import { partyHooks } from '../hooks/index.ts';
import {affordableMix, cipherCandidates, cipherIngredients, defaultCipherSettings, solveCipher, trickOrTreatRoute, validMix, type CipherBoard, type CipherSettings, type CipherGatheringPlan, type CipherGatheringContext} from './october.ts';

interface Point {map:string;x:number;y:number}
interface EventDefinition {
  doors?: [string,number,number][];
  knocks?: number;
  ingredients?: [string,string[]][];
}
interface Activity {name:string;state:Record<string,unknown>;types:string[];kind:string}
interface Receipt {success?:boolean;failed?:boolean;reason?:string;mixes?:number;mixes_left?:number;server?:string;[key:string]:unknown}
interface Journal {
  day:string; doors:number[]; doorLimit?:boolean;
  gathering?:CipherGatheringPlan;
  pending?: {key:string;round:string;cracks:number;mix:string[];before:number;at:number};
  handled?:string[]; last?:{at:number;action:string;result:unknown};
}
export interface OctoberPorts {
  now():number; realm():string; name():string; merchant():boolean;
  // This character is the party's merchant, and its bag's free cells (1.5 row 37).
  merchantClass():boolean; freeSlots():number;
  // The schedule's `due` leads of this member's group, which the last reply carried (the Cipher merchant's walk lead).
  leads():Record<string,number>|null;
  settings():Record<string,{monsters?:string[];cipher?:CipherSettings}>;
  status():{halloween?:unknown;witchcipher?:CipherBoard};
  definitions():Record<string,EventDefinition>;
  position():Point; stock():Record<string,number>;
  gathering():CipherGatheringContext|null;
  doorStatus():{doors?:number[];doors_left?:number}|null;
  load():Journal|null; save(journal:Journal):void;
  walk(point:Point,owns:()=>boolean):Promise<unknown>;
  // A fighter's own walk, with no party walk around it: its hand-over trip to the Witch (rule 2).
  walkAlone(point:Point,owns:()=>boolean):Promise<unknown>;
  knock(door:number):Promise<Receipt>; info():Promise<Receipt>; brew(mix:string[]):Promise<Receipt>;
  farmDestination(monster:string):Point|null; witch():Point|null;
  transfer():Promise<void>;
}
export function createOctoberRuntime(ports:OctoberPorts) {
  // `failedOn` is what a failed step read: the step runs again once that changes.
  let journal=ports.load(), phase='idle', detail='', failedOn:string|null=null, working=false;
  // `infoBoard` is the Witch's board (its round id) the day's info was read on.
  let dayInfo:Receipt|null=null, infoBoard:string|null=null, solutionKey='', solution:ReturnType<typeof solveCipher>|null=null;
  // The game's daily reset (logic/halloween_events.js `trick_or_treat_status`, `trick_or_treat_day`):
  // the server's day is the UTC date, and its loop re-sends every character's door status once the
  // day changes. A status that has not changed since an earlier day is that day's until the resend,
  // unless it already reads as a new day's: no door knocked and the whole quota left.
  // A status first seen after a code reload counts for the schedule, but only a status that changed
  // during the server's day, or reads as a new day's, sets the day's door list: in the first moments
  // of a UTC day the first sighting may still be the day before's, ahead of the resend.
  let doorsSeen:{key:string;day:string;changed:boolean}|null=null;
  // The ingredient the stock holds fewest of, the first of the scarcest in `ids`' order.
  const scarcest=<T extends string>(ids:readonly T[],stock:Record<string,number|undefined>):T=>
    ids.reduce((lowest,id)=>(stock[id]??0)<(stock[lowest]??0)?id:lowest);
  // The journal's handled brews and requests: b9b5c91e keeps the last 32 ids, which no reread of an
  // older board or request reaches.
  const handled=(journal:{handled?:unknown[]},id:unknown)=>{journal.handled=[...(journal.handled??[]),id].slice(-32);};
  // The server's UTC day, which the door list and the journal both key.
  const today=()=>new Date(ports.now()).toISOString().slice(0,10);
  // The day's door count, from the game's door list (G.events.trickortreat.doors).
  const doorCount=()=>ports.definitions().trickortreat?.doors?.length??0;
  function sighting() {
    const native=ports.doorStatus(), day=today();
    if(!native)return null;
    const key=JSON.stringify(native), rules=ports.definitions().trickortreat;
    if(!doorsSeen || doorsSeen.key!==key)doorsSeen={key,day,changed:!!doorsSeen};
    const fresh=!native.doors?.length && native.doors_left===Math.min(rules?.doors?.length??0,Number(rules?.knocks));
    return {native, current:doorsSeen.day===day || fresh, today:doorsSeen.changed && doorsSeen.day===day || fresh};
  }
  function doorStatus() { const seen=sighting(); return seen?.current ? seen.native : null; }
  function current() {
    const day=today();
    if(!journal || journal.day!==day){journal={day,doors:[],handled:journal?.handled??[],pending:journal?.pending,gathering:journal?.gathering};ports.save(journal);dayInfo=null;infoBoard=null;}
    const seen=sighting(), native=seen?.today ? seen.native : null;
    if(native?.doors){
      const merged=[...new Set([...journal.doors,...native.doors.filter(id=>Number.isInteger(id)&&id>=0&&id<doorCount())])];
      if(merged.length!==journal.doors.length){journal.doors=merged;ports.save(journal);}
    }
    return journal;
  }
  function config(){return {...defaultCipherSettings,...ports.settings().witchcipher?.cipher};}
  function planFor(board:CipherBoard){
    const saved=current(), context=ports.gathering();
    if(!board.id || !context || context.round!==board.id)return undefined;
    const matches=(plan:CipherGatheringPlan|undefined)=>!!plan&&plan.round===board.id&&plan.realm===ports.realm()&&plan.owner===context.owner;
    if(matches(context.plan)&&(!matches(saved.gathering)||context.plan!.selectedAt>saved.gathering!.selectedAt)){
      saved.gathering=context.plan;ports.save(saved);
    }
    if(matches(saved.gathering)){
      if(saved.gathering!.mode==='gathering'&&ports.now()>=Number(board.gather_end)){
        if(context.owner===ports.name()&&context.ready)return selectPlan(board,undefined,'gathering ended',!cipherIngredients.every(id=>(context.stock[id]??0)>0));
        // Stop pulling immediately at the native cutoff while the owner's
        // fresh inventory decision propagates to the rest of the party.
        return undefined;
      }
      return saved.gathering;
    }
    // One owner chooses from a fresh party inventory snapshot. Every follower
    // and the merchant adopt its persisted plan, never their individual stock.
    if(context.owner!==ports.name() || !context.ready)return undefined;
    const ingredient=cipherIngredients.every(id=>(context.stock[id]??0)>0)?undefined:
      scarcest(cipherIngredients,context.stock);
    return selectPlan(board,ingredient,'initial stock',!!ingredient&&ports.now()>=Number(board.gather_end));
  }
  function selectPlan(board:CipherBoard,ingredient:typeof cipherIngredients[number]|undefined,reason:CipherGatheringPlan['reason'],finished=false){
    const context=ports.gathering();if(!context||!board.id)return undefined;
    const monster=monsterFor(ingredient);
    if(ingredient&&!monster)return undefined;
    current().gathering={round:board.id,realm:ports.realm(),owner:context.owner,mode:finished?'finished':ingredient?'gathering':'brewing',reason,
      ingredient,monster,stock:{...context.stock},selectedAt:ports.now()};
    ports.save(current());
    // `cipher.plan`: the owner's chosen plan (gather, brew or finished) and its ingredient.
    partyHooks().notify('cipher.plan',{round:board.id,mode:current().gathering!.mode,ingredient:ingredient??null,monster:monster??null,reason,by:'core:events'});
    return current().gathering;
  }
  // The player's pick of monster for an ingredient, else the game's first monster that drops it.
  function monsterFor(ingredient:string|undefined){
    const rules=ports.definitions().witchcipher?.ingredients??[];
    const index=rules.findIndex(entry=>entry[0]===ingredient);
    const selected=config().gatherMonsters?.[index];
    return rules[index]?.[1].includes(selected??'')?selected:rules[index]?.[1][0];
  }
  // The Cipher handoff. The game reports the
  // round's `phase: "gathering"` until `gather_end` (logic/witch_cipher.js:64, 118).
  function gatherPhase(board:CipherBoard){return ports.now()<Number(board.gather_end);}
  // Rule 1: a fighter gathers until `gather_end` whatever the plan's mode. A brewing plan names no
  // ingredient, so the fighter gathers the scarcest one in the stock the owner chose the plan from.
  // The fighter keeps that destination while the party's stock changes, so a tie that the gathering
  // itself makes never moves it to another ingredient's map before `gather_end`.
  function gatherType(plan:CipherGatheringPlan){
    if(plan.mode==='gathering')return plan.monster;
    return monsterFor(scarcest(cipherIngredients,plan.stock));
  }
  function holdsIngredients(){const stock=ports.stock();return cipherIngredients.some(id=>(stock[id]??0)>0);}
  // The mix the solver picks for the board from `stock`, kept until either changes.
  function solved(board:CipherBoard,stock:Record<string,number>){
    const key=JSON.stringify([board,stock]);
    if(key!==solutionKey){solution=solveCipher(board,stock);solutionKey=key;}
    return solution?.mix??null;
  }
  // Before `gather_end` the merchant goes to the Witch only for a mix its bag affords now.
  // The stored ingredients reach the bag first through the items owner's claim fetch.
  function earlyMix(board:CipherBoard){
    const request=manual(board), stock=ports.stock();
    if(!request&&(board.mixes??board.board?.length??0)<config().minClues)return false;
    const mix=request?request.mix:solved(board,stock);
    return !!mix&&affordableMix(mix,stock);
  }
  // The merchant leaves for the Witch to arrive by `gather_end`. Its lead is the schedule's for the
  // walk `witchWalk` names: the group's walk estimate plus one report interval, and with
  // no estimate yet it leaves at `gather_end` (`leadFor`).
  function merchantDue(board:CipherBoard){return ports.now()>=Number(board.gather_end)-leadFor({eventLeads:ports.leads()},'witchcipher');}
  // The walk the schedule times: the Cipher merchant's to the Witch by `gather_end`, on the server's
  // clock, while the round gathers.
  function witchWalk(){
    const board=ports.status().witchcipher, destination=ports.witch();
    return ports.merchant()&&ports.merchantClass()&&board&&gatherPhase(board)&&destination?{at:Number(board.gather_end),destination}:null;
  }
  function manual(board:CipherBoard){const value=config().manual;return value && value.round===board.id && value.cracks===(board.cracks??0) && !current().handled?.includes(value.id)?value:null;}
  function activity(name:string):Activity|null {
    const status=ports.status(), saved=current();
    if(name==='trickortreat'){
      if(!(status.halloween && ports.doorStatus()?.doors_left!==0 && !saved.doorLimit && saved.doors.length<doorCount()))return null;
      // 1.5 row 37: a door's candy needs a cell, so the merchant waits with a full bag and resumes on
      // the first poll that finds one free.
      if(ports.merchantClass() && ports.freeSlots()<1){phase='waiting for inventory capacity';detail='Free inventory space before visiting doors';return null;}
      return {name,state:{id:'doors:'+saved.day},types:[],kind:'interaction'};
    }
    const board=status.witchcipher;
    if(name!=='witchcipher' || !board?.live || !(Number(board.end)>ports.now()))return null;
    const plan=planFor(board);
    if(!plan){phase='waiting for inventory';detail='Waiting for a fresh shared ingredient inventory';return null;}
    if(plan.mode==='finished'&&!manual(board)){phase='finished';detail='Gathering ended without enough ingredients; returning to farming';return null;}
    if(!ports.merchant()&&gatherPhase(board)){
      const type=gatherType(plan);
      phase='gathering';detail=type?'Farming '+type+' for '+(plan.mode==='gathering'?plan.ingredient:'the Cipher'):'Waiting for a fresh shared ingredient inventory';
      return type?{name,state:board as Record<string,unknown>,types:[type],kind:'monster'}:null;
    }
    if(!config().automatic && !manual(board) && !saved.pending)return null;
    if(ports.gathering()?.mixesLeft===0&&!saved.pending)return null;
    if(dayInfo && Number(dayInfo.mixes_left)<=0 && !saved.pending)return null;
    // Rule 2: after `gather_end` a fighter's trip to the Witch lasts until it holds no ingredient.
    if(!ports.merchant()){
      if(!holdsIngredients()){phase='handed over';detail='Ingredients handed to the merchant; returning to farming';return null;}
      phase='handing over';detail='Taking ingredients to the merchant at the Witch';
    }else if(ports.gathering()?.fetching&&!saved.pending&&gatherPhase(board)&&!merchantDue(board)){
      // Rule 3: the walk waits while 10 fetches the stored ingredients to the bag, until its own due
      // start (the lead before gather_end); then it goes with what the bag holds, so the merchant
      // reaches the Witch by gather_end as b9b5c91e's merchant did.
      phase='fetching from bank';detail='Taking the banked Cipher ingredients before the Witch';return null;
    }else if(gatherPhase(board)&&!saved.pending&&!merchantDue(board)&&!earlyMix(board)){
      phase='waiting for gathering';detail='Brewing at the Witch from the end of gathering';return null;
    }
    return {name,state:board as Record<string,unknown>,types:[],kind:'interaction'};
  }
  function destination(name:string):Point|null {
    if(name==='trickortreat'){
      const id=trickOrTreatRoute.find(door=>!current().doors.includes(door));
      const point=id===undefined?null:ports.definitions().trickortreat?.doors?.[id];
      return point?{map:point[0],x:point[1],y:point[2]+40}:null;
    }
    const board=ports.status().witchcipher, plan=board&&planFor(board);
    const type=board && plan && plan.mode!=='finished' && !ports.merchant() && gatherPhase(board)?gatherType(plan):null;
    return type?ports.farmDestination(type):ports.witch();
  }
  function saveResult(action:string,result:unknown){current().last={at:ports.now(),action,result};ports.save(current());}
  async function doors(owns:()=>boolean){
    const saved=current();
    for(const door of trickOrTreatRoute){
      if(!owns() || saved!==current() || saved.doorLimit)return;
      if(saved.doors.includes(door))continue;
      const point=ports.definitions().trickortreat?.doors?.[door];
      if(!point)throw Error('Native door catalog unavailable');
      phase='visiting door '+(door+1);detail='';
      await ports.walk({map:point[0],x:point[1],y:point[2]+40},owns);
      if(!owns())return;
      const position=ports.position();
      if(position.map!==point[0] || Math.hypot(position.x-point[1],position.y-point[2])>75)return;
      try{const receipt=await ports.knock(door);if(receipt.failed)throw receipt;saved.doors.push(door);saveResult('knock '+door,receipt);}
      catch(error){const reason=(error as Receipt)?.reason;
        if(reason==='trickortreat_knocked')saved.doors.push(door);
        else if(reason==='trickortreat_limit')saved.doorLimit=true;
        else throw error;
        saveResult('knock '+door,error);
      }
    }
    phase='complete';detail='Daily door route complete; returning to farming';
  }
  async function refreshInfo(){dayInfo=await ports.info();infoBoard=String(ports.status().witchcipher?.id??'');return dayInfo;}
  async function reconcile(){
    const saved=current(), pending=saved.pending;
    if(!pending)return true;
    const day=await refreshInfo();
    // An unknown request may have consumed one of the shared attempts. Never
    // replay it merely because the callback or a new board was lost.
    if(Number(day.mixes)>pending.before){
      handled(saved,pending.key);delete saved.pending;
      saveResult('reconciled brew',{mixes:day.mixes,unknownOutcome:true});return true;
    }
    phase='uncertain';detail='Waiting for confirmation of the previous brew; no retry will spend another mix';return false;
  }
  async function cipher(owns:()=>boolean){
    let board=ports.status().witchcipher;
    if(!board)return;
    if(!ports.merchant()){
      if(gatherPhase(board))return;
      const witch=ports.witch();if(!witch)throw Error('Witch location unavailable');
      // Each fighter's trip lasts until it holds no ingredient (rule 2), so it walks alone: a party
      // walk would wait for a member that has nothing to hand over and never asks for the walk.
      phase='walking to witch';detail='';await ports.walkAlone(witch,owns);if(!owns())return;
      await ports.transfer();return;
    }
    if(!await reconcile() || !owns())return;
    const settings=config(), request=manual(board);
    if(!settings.automatic && !request)return;
    // The day's info is read again when the board's round changes; a brew the game refused clears it.
    if(!dayInfo || infoBoard!==String(board.id??''))await refreshInfo();
    if(!owns() || !dayInfo || Number(dayInfo.mixes_left)<=0){phase='daily limit';return;}
    if(dayInfo.server && dayInfo.server!==ports.realm()){phase='other realm';detail='Today’s mixes belong to '+dayInfo.server;return;}
    const target=ports.witch();if(!target)throw Error('Witch location unavailable');
    phase='walking to witch';detail='';await ports.walk(target,owns);if(!owns())return;
    board=ports.status().witchcipher;if(!board?.live || Number(board.end)<=ports.now())return;
    if(!request && (board.mixes??board.board?.length??0)<config().minClues){phase='waiting for clues';detail=`Need ${config().minClues} clues`;return;}
    const position=ports.position();if(position.map!==target.map||Math.hypot(position.x-target.x,position.y-target.y)>55)return;
    const stock=ports.stock(), liveRequest=manual(board);
    let mix:string[]|null=null;
    if(request){
      if(liveRequest?.id!==request.id)return;
      mix=request.mix;
      if(!validMix(mix)||!cipherCandidates(board).some(candidate=>candidate.join(',')===mix!.join(','))){phase='manual conflict';detail='The requested mix no longer fits this recipe’s clues';return;}
    }else{
      if(!config().automatic || (board.mixes??board.board?.length??0)<config().minClues)return;
      mix=solved(board,ports.gathering()?.ready?ports.gathering()!.stock:stock);
    }
    if(!mix){phase='waiting for clues';detail='No untried recipe fits the available clues';return;}
    if(!affordableMix(mix,stock)){
      // Rule 4: no brew waits at the Witch before `gather_end` on ingredients the fighters still gather.
      if(gatherPhase(board)){phase='waiting for gathering';detail='Brewing at the Witch from the end of gathering';return;}
      const context=ports.gathering();
      if(!context?.ready||affordableMix(mix,context.stock)){phase='waiting for ingredients';detail='Waiting for the party to transfer ingredients';return;}
      const missing=cipherIngredients.filter(id=>mix!.filter(value=>value===id).length>(context.stock[id]??0));
      const ingredient=scarcest(missing,context.stock);
      if(request)handled(current(),request.id);
      selectPlan(board,ingredient,'recipe shortage',ports.now()>=Number(board.gather_end));
      phase='ingredients needed';detail='Recipe needs '+ingredient;return;
    }
    if(board.board?.some(clue=>clue.mix.join(',')===mix!.join(','))){phase='already tried';return;}
    await refreshInfo();if(!owns() || Number(dayInfo?.mixes_left)<=0)return;
    const latest=ports.status().witchcipher;
    if(JSON.stringify(latest)!==JSON.stringify(board))return;
    const key=request?.id??`${board.id}:${board.cracks??0}:${mix.join(',')}`;
    if(current().handled?.includes(key)){phase='waiting for board';detail='Previous brew is confirmed; waiting for the realm board update';return;}
    current().pending={key,round:String(board.id),cracks:board.cracks??0,mix:mix.slice(),before:Number(dayInfo?.mixes)||0,at:ports.now()};
    ports.save(current());phase='brewing';
    try{
      const receipt=await ports.brew(mix);if(receipt.failed)throw receipt;
      handled(current(),key);delete current().pending;
      dayInfo={...dayInfo,mixes:Number(dayInfo?.mixes)+1,mixes_left:receipt.mixes_left};
      saveResult('brew',receipt);phase=receipt.cracked?'recipe solved':'clue received';solutionKey='';
    }catch(error){
      const reason=(error as Receipt)?.reason;
      if(reason && !['timeout','disconnected','queue_overflow'].includes(reason)){delete current().pending;dayInfo=null;}
      saveResult('brew failed',error);throw error;
    }
  }
  // What an October step reads from the merchant's report: its bag, its position and the event's
  // event's own state: the Witch's board from the feed, and for the `doors` view the door status
  // (character.trickortreat), so a changed door list runs a failed door step again.
  function stepState(name:string){
    const at=ports.position(), state=eventKey(name)?.view==='doors'?ports.doorStatus():(ports.status() as Record<string,unknown>)[name];
    return JSON.stringify([ports.stock(),at.map,at.x,at.y,state]);
  }
  async function run(name:string,owns:()=>boolean){
    if(working||failedOn===stepState(name))return;
    working=true;failedOn=null;
    try{if(name==='trickortreat')await doors(owns);else if(name==='witchcipher')await cipher(owns);}
    catch(error){detail=String((error as Receipt)?.reason??(error as Error)?.message??error);phase='retry waiting';failedOn=stepState(name);}
    finally{working=false;}
  }
  return {activity,destination,run,doorStatus,witchWalk,transfer:()=>ports.transfer(),snapshot:()=>({phase,detail,day:dayInfo,journal:current(),stock:ports.stock(),candidates:solution?.candidates})};
}
