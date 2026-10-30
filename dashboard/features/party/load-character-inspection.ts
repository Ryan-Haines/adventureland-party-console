import {API} from './api';
import type {Char} from './char';
function object(value:unknown):Record<string,unknown>{return value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{};}
function inspection(value:unknown,name:string):value is Char {
 const character=object(value),source=object(character.inspection);
 return character.name===name && typeof character.ctype==='string' && typeof character.map==='string' && ['level','xp','max_xp','hp','max_hp','mp','max_mp','gold','x','y','seenAt'].every(key=>typeof character[key]==='number' && Number.isFinite(character[key])) && typeof character.rip==='boolean' && typeof character.banking==='boolean' && Array.isArray(character.items) && character.items.every(raw=>!raw || (typeof object(raw).slot==='number' && typeof object(object(raw).item).name==='string')) && !!character.slots && typeof character.slots==='object' && source.source==='account-snapshot' && typeof source.calculated==='boolean' && typeof source.note==='string';
}
/** The server owns the roster check and strips account access/billing fields. */
export async function loadCharacterInspection(name:string):Promise<Char>{
 const response=await fetch(`${API}/characters/${encodeURIComponent(name)}/inspection`),body=object(await response.json());
 if(!response.ok)throw Error(typeof body.error==='string'?body.error:'Could not read saved character');
 if(!inspection(body.character,name))throw Error('Invalid saved character response');
 return body.character;
}
