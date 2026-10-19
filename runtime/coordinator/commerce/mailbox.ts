import {requestObject} from '../http/contracts.ts';
import type {MailInbox} from '../http/mail-inbox.ts';

export interface SentMailRecord {id:string;recipient:string;subject:string;message:string;sent:string;item?:unknown;quantity?:number}
export interface MailboxState {settings:{autoCollect:boolean;autoDelete:boolean};seenIds:string[];outbox:SentMailRecord[]}
export function initialMailbox(value:unknown):MailboxState {
  const saved=requestObject(value),settings=requestObject(saved.settings);
  return {settings:{autoCollect:settings.autoCollect===true,autoDelete:settings.autoDelete===true},
    seenIds:Array.isArray(saved.seenIds)?saved.seenIds.filter((id):id is string=>typeof id==='string'):[],
    outbox:Array.isArray(saved.outbox)?saved.outbox.flatMap(raw=>{const m=requestObject(raw);return typeof m.id==='string'&&typeof m.recipient==='string'&&typeof m.subject==='string'&&typeof m.message==='string'&&typeof m.sent==='string'?[{id:m.id,recipient:m.recipient,subject:m.subject,message:m.message,sent:m.sent,...(m.item?{item:m.item}:{}),...(typeof m.quantity==='number'?{quantity:m.quantity}:{})}]:[];}):[]};
}
/** Account observations decide collection/deletion; local history never recalls native mail. */
export function createMailbox(inner:MailInbox,state:{mailbox?:MailboxState},ports:{now():number;persist():void;collecting(id:string):boolean}):MailInbox {
  const saved=state.mailbox ||= initialMailbox(undefined);
  let flight:Promise<unknown>|undefined;
  let automationError:string|null=null;
  const retryAt=new Map<string,number>();
  const messages=()=>{const inbox=requestObject(inner.snapshot());return (Array.isArray(inbox.messages)?inbox.messages:[]).map(requestObject);};
  function snapshot(){const inbox=requestObject(inner.snapshot()),seen=new Set(saved.seenIds);return {...inbox,error:inbox.error||automationError,settings:{...saved.settings},outbox:saved.outbox.map(m=>({...m})),newCount:messages().filter(m=>typeof m.id==='string'&&!seen.has(m.id)).length};}
  async function refresh(){
    if(flight)return flight;
    flight=(async()=>{
      await inner.refresh();
      for(const mail of messages()){
        if(typeof mail.id!=='string'||!mail.item||ports.collecting(mail.id))continue;
        if(saved.settings.autoCollect&&mail.taken===false&&(!mail.collection||mail.collection==='failed'&&ports.now()>=(retryAt.get(mail.id)||0))){retryAt.set(mail.id,ports.now()+30000);await inner.collect(mail.id);}
        else if(saved.settings.autoDelete&&mail.taken===true&&(!mail.collection||mail.collection==='collected'))await inner.remove(mail.id);
      }
      automationError=null;return snapshot();
    })().catch(error=>{automationError=String(requestObject(error).message||error);throw error;});
    try{return await flight;}finally{flight=undefined;}
  }
  return {snapshot,refresh,collect:async id=>{await inner.collect(id);return snapshot();},remove:async id=>{await inner.remove(id);return snapshot();},
    complete(id,success,error){inner.complete(id,success,error);void refresh().catch(()=>{});},
    async configure(input){const settings=requestObject(input);if(typeof settings.autoCollect!=='boolean'||typeof settings.autoDelete!=='boolean')throw Error('Choose both mailbox automation settings');saved.settings={autoCollect:settings.autoCollect,autoDelete:settings.autoDelete};ports.persist();return refresh();},
    seen(){saved.seenIds=[...new Set([...saved.seenIds,...messages().flatMap(m=>typeof m.id==='string'?[m.id]:[])])];ports.persist();return snapshot();},
    removeSent(id){saved.outbox=saved.outbox.filter(m=>m.id!==id);ports.persist();return snapshot();},
    sent(id,input){const mail=requestObject(input);if(saved.outbox.some(m=>m.id===id)||typeof mail.recipient!=='string'||typeof mail.subject!=='string'||typeof mail.message!=='string')return;
      const source=requestObject(mail.source);saved.outbox.unshift({id,recipient:mail.recipient,subject:mail.subject,message:mail.message,sent:new Date(ports.now()).toISOString(),...(source.item?{item:structuredClone(source.item)}:{}),...(typeof mail.quantity==='number'?{quantity:mail.quantity}:{})});ports.persist();}
  };
}
