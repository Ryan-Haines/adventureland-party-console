import { requestObject, requestText, type HttpRequest, type HttpResponse } from '../http/contracts.ts';
import { classifyGameLog, type GameLog } from '../../game-log-filters.ts';
export const gameLogs: Record<string,GameLog[]> = {};
export function appendGameLogs(req:HttpRequest,res:HttpResponse,owned:(name:string)=>boolean){
  const body=requestObject(req.body),name=requestText(body.character);
  if(!owned(name))return res.status(400).json({error:'Unknown character'});
  const entries=gameLogs[name] ||= [], keys=new Set(entries.map(e=>e.session+':'+e.seq));
  const incoming=Array.isArray(body.events)?body.events.slice(0,100):[];
  for(const value of incoming){const e=requestObject(value),session=requestText(e.session).slice(0,100),seq=Number(e.seq);
    if(!session || !Number.isSafeInteger(seq) || keys.has(session+':'+seq))continue;
    const message=requestText(e.message).slice(0,4000);
    entries.push({session,seq,at:Number(e.at)||Date.now(),message,color:requestText(e.color).slice(0,50),category:classifyGameLog(message)});keys.add(session+':'+seq);
  }
  if(entries.length>1000)entries.splice(0,entries.length-1000);
  return res.json({ok:true});
}
