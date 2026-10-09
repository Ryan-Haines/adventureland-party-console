import {requestObject,type HttpHandler} from '../http/contracts.ts';
import {isUpgradeOffering,offeringRule,type UpgradeOfferingRule,type UpgradeOffering} from '../../upgrade-offerings.ts';
import type {MerchantWork} from '../merchant/work.ts';
import type {InventoryEntry} from '../contracts/item.ts';
import type {SharedScope} from './shared-rules.ts';

interface State extends SharedScope {
  merchantCharacter:string|null;
  merchantCurrent:MerchantWork|null;
  upgradeOfferingRules?:UpgradeOfferingRule[];
  upgrades?:Record<string,unknown[]|undefined>;
  statuses?:Record<string,{items?:(InventoryEntry|null)[]}|undefined>;
  commands?:Record<string,unknown>;
  autoUpgradeMarks?:Record<string,Record<string,unknown>|undefined>;
}
/** Slot handoff is queued here; the issuing character must yield before storage runs. */
export function createOfferingSupplyRoute(state:State,queue:(offering:UpgradeOffering)=>boolean):HttpHandler {
  return (req,res)=>{
    const body=requestObject(req.body),job=state.merchantCurrent;
    if(!job || job.id!==body.jobId || job.commandId!==body.commandId)
      return res.status(409).json({error:'upgrade job is no longer current'});
    if(!isUpgradeOffering(body.offering) || !authorized(state,job,body))
      return res.status(409).json({error:'upgrade offering intent changed'});
    return res.json({pending:queue(body.offering)});
  };
}
function authorized(state:State,job:MerchantWork,body:Record<string,unknown>):boolean {
  const item=requestObject(body.item),mark=requestObject(body.mark);
  if(!liveItem(state,item) || typeof item.name!=='string') return false;
  const marks=intentMarks(state,job);
  if(mark.auto!==true) return manualIntent(marks,mark,body.offering);
  if(!selectedOffering(state,item,body.offering)) return false;
  return currentUpgradeRule(state,item,mark) && (automaticIntent(marks,item,mark) || authorizedBankRule(state,job,item,mark));
}
function intentMarks(state:State,job:MerchantWork):unknown[] {return state.upgrades?.[String(job.target || state.merchantCharacter)] || [];}
function selectedOffering(state:State,item:Record<string,unknown>,offering:unknown):boolean {
  return offeringRule(state.upgradeOfferingRules || [],String(item.name),Number(item.level)||0)?.offering===offering;
}
function currentUpgradeRule(state:State,item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  const key=String(item.name)+'@+'+Number(requestObject(mark.item).level||0);
  const owners=state.merchantRules?[state.autoUpgradeMarks?.[String(state.merchantCharacter)]]:Object.values(state.autoUpgradeMarks || {});
  return owners.some(rules=>{
    const saved=rules?.[key],data=requestObject(saved);
    const tiers=typeof saved==='object'?data.tiers:saved;
    return Number(tiers)===Number(mark.tiers) && data.quantity!==0;
  });
}
function liveItem(state:State,item:Record<string,unknown>):boolean {
  const live=state.statuses?.[String(state.merchantCharacter)]?.items?.some(entry=>entry?.item &&
    Object.keys(item).every(key=>JSON.stringify(entry.item![key])===JSON.stringify(item[key])));
  return live===true;
}
function automaticIntent(marks:unknown[],item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  return marks.some(raw=>{
      const saved=requestObject(raw),start=requestObject(saved.item);
      return saved.auto===true && start.name===item.name && start.level===requestObject(mark.item).level;
    });
}
function manualIntent(marks:unknown[],mark:Record<string,unknown>,offering:unknown):boolean {
  return marks.some(raw=>{const saved=requestObject(raw);return saved.requestId===mark.requestId &&
    typeof saved.requestId==='string' && saved.offering===offering;});
}
function authorizedBankRule(state:State,job:MerchantWork,item:Record<string,unknown>,mark:Record<string,unknown>):boolean {
  const command=requestObject(state.commands?.[String(state.merchantCharacter)]);
  if(command.id!==job.commandId || !Array.isArray(command.bankUpgradeRules)) return false;
  const start=requestObject(mark.item),level=Number(item.level)||0;
  return command.bankUpgradeRules.some(raw=>{
    const rule=requestObject(raw),sourceLevel=Number(rule.level)||0,tiers=Number(rule.tiers);
    return rule.name===item.name && sourceLevel===Number(start.level||0) &&
      Number(mark.tiers)===tiers && level>=sourceLevel && level<sourceLevel+tiers;
  });
}
