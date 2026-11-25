import type {QueryClient} from '@tanstack/react-query';
import type {Char} from './char';
import {performAction} from './query-actions';
function object(value:unknown):Record<string,unknown>{return value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{};}
function inspection(value:unknown,name:string):value is Char {
 const character=object(value),source=object(character.inspection);
 return character.name===name && typeof character.ctype==='string' && typeof character.map==='string' && ['level','xp','max_xp','hp','max_hp','mp','max_mp','gold','x','y','seenAt'].every(key=>typeof character[key]==='number' && Number.isFinite(character[key])) && typeof character.rip==='boolean' && typeof character.banking==='boolean' && Array.isArray(character.items) && character.items.every(raw=>!raw || (typeof object(raw).slot==='number' && typeof object(object(raw).item).name==='string')) && !!character.slots && typeof character.slots==='object' && source.source==='account-snapshot' && typeof source.calculated==='boolean' && typeof source.note==='string';
}
/** The server owns the roster check and strips account access/billing fields. The read goes
 *  through the action client's GET, so a lost session ends as every other request's does, and a
 *  refusal throws its route's error. */
export async function loadCharacterInspection(client:QueryClient,name:string):Promise<Char>{
 const body=await performAction(client,`/characters/${encodeURIComponent(name)}/inspection`,{},{method:'GET'});
 if(!inspection(body.character,name))throw Error('Invalid saved character response');
 return body.character;
}
