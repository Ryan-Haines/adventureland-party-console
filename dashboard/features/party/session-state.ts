"use client";
import {useEffect,useState} from 'react';
// A session UI preference's one stored form: JSON under party-ui:<key>. Blocked storage reads as unset
// and drops the write; the preference then lives for the page only.
export function readSession<T>(key:string):T|undefined{
  try{const saved=sessionStorage.getItem('party-ui:'+key);return saved===null?undefined:JSON.parse(saved) as T;}catch{return undefined;}
}
export function writeSession(key:string,value:unknown){
  try{sessionStorage.setItem('party-ui:'+key,JSON.stringify(value));}catch{return;}
}
/** Session UI preferences only: never restore a submitted command or item action. */
export function useSessionState<T>(key:string,initial:T){
  const [value,setValue]=useState(initial),[ready,setReady]=useState(false);
  useEffect(()=>{const saved=readSession<T>(key);if(saved!==undefined)setValue(saved);setReady(true);},[key]);
  useEffect(()=>{if(ready)writeSession(key,value);},[key,value,ready]);
  return [value,setValue] as const;
}
