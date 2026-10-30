import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import type {CoordinatorFileStore} from '../infrastructure/platform-contracts.ts';
import {processLockActive, processLockIdentity} from './process-lock.ts';

/**
 * One saved value. `json` is the exact text of its last record; replayed
 * values get it on first comparison. get() parses `value` on first read.
 */
interface StoredValue { json?: string; value?: unknown; parsed: boolean; bytes: number }

/**
 * Compact once superseded records exceed both this size and COMPACT_GROWTH
 * times the live records. A compaction rewrites the live set, so its write
 * rate is the append rate times live / superseded: about a quarter of the
 * appends for the 7.6 MB live set of a console in use.
 */
export const COMPACT_SUPERSEDED_BYTES = 32 * 1024 * 1024;
export const COMPACT_GROWTH = 3;
/**
 * Shutdown compacts only a live set up to this size, so close() stays far
 * inside the 30 s stop grace; a larger journal compacts at the next start.
 */
export const CLOSE_COMPACT_MAX_BYTES = 64 * 1024 * 1024;
/** Bounds the journal even if a busy event loop delays the growth check. */
const COMPACT_MAX_BYTES = 128 * 1024 * 1024;

/** Compatible JSONL store: replay one record at a time, never the entire journal. */
export class CoordinatorJsonlStore implements CoordinatorFileStore {
  private values = new Map<string,StoredValue>();
  private handle: number | undefined;
  private lock: number | undefined;
  private guard: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pendingCompaction: ReturnType<typeof setImmediate> | undefined;
  private bytes = 0;
  /** Bytes of the newest record of each live key; what a compaction writes. */
  private liveBytes = 0;
  private opened = false;
  private compactRetryAt = 0;
  private closed = false;
  private lockPath: string;
  private mainPath:string;
  private replacementPath:string;
  constructor(mainPath='garage.jsonl',replacementPath='garage.new.jsonl',interval=30000) {
    this.mainPath=mainPath;this.replacementPath=replacementPath;
    if(mainPath===replacementPath)throw new Error('Storage main and replacement paths must differ');
    this.lockPath=mainPath+'.writer.lock';
    try {
      this.acquire();
      if(!fs.existsSync(mainPath) && fs.existsSync(replacementPath))fs.renameSync(replacementPath,mainPath);
      this.handle=fs.openSync(mainPath,'a+');
      this.replay();
      this.bytes=fs.fstatSync(this.handle).size;
      // Superseded records from the previous run. Startup leaves a journal
      // that the last shutdown compacted as it is.
      if(this.bytes>this.liveBytes)this.refactor();
      // The growth check runs on every append; the timer retries a deferred
      // compaction when no append follows.
      this.timer=setInterval(()=>this.compactIfNeeded(),interval);
      this.timer.unref();
      this.opened=true;
    } catch(error) {this.close();throw error;}
  }
  private acquire():void {
    if (process.platform === 'linux') this.acquireGuard();
    const identity = JSON.stringify({...processLockIdentity(), ...(this.guard !== undefined ? {advisory:true} : {})});
    try {this.lock=fs.openSync(this.lockPath,'wx');}
    catch(error) {
      if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
      const owner=fs.readFileSync(this.lockPath,'utf8');
      if(processLockActive(owner, this.guard !== undefined))throw new Error('Storage already has a live writer: '+this.mainPath);
      fs.unlinkSync(this.lockPath);
      this.lock=fs.openSync(this.lockPath,'wx');
    }
    fs.writeFileSync(this.lock,identity);
    fs.fsyncSync(this.lock);
  }
  private acquireGuard():void {
    // flock attaches to the inherited open file description. The parent keeps
    // that description after the helper exits; close/crash releases ownership.
    // Never unlink this inode: another writer may already have opened it.
    this.guard = fs.openSync(this.lockPath.replace(/\.lock$/, '.guard'), 'a+');
    const result = spawnSync('flock', ['--exclusive', '--nonblock', '3'], {
      stdio: ['ignore', 'pipe', 'pipe', this.guard], timeout: 5000,
    });
    if (result.error) throw new Error('Storage requires Linux flock: '+result.error.message);
    if (result.status === 1) throw new Error('Storage already has a live writer: '+this.mainPath);
    if (result.status !== 0) throw new Error('Storage advisory ownership is unverifiable: '+result.stderr.toString());
  }
  private replay():void {
    const chunk=Buffer.allocUnsafe(64*1024);
    let fragments:Buffer[]=[],offset=0,number=0,terminated=true;
    let failed:{number:number;offset:number;error:unknown}|undefined;
    const line=(bytes:Buffer)=>{
      number++;
      const text=bytes.toString('utf8');
      if(failed) {
        // Records after an unreadable line mean corruption, not a torn write.
        if(text.split('\0').join('').trim())throw this.corruption(failed);
      } else {
        try {this.record(text,bytes.length+1);}
        catch(error) {failed={number,offset,error};}
      }
      offset+=bytes.length+1;
    };
    for(;;) {
      const count=fs.readSync(this.handle!,chunk,0,chunk.length,null);
      if(!count)break;
      let start=0;
      for(let i=0;i<count;i++)if(chunk[i]===10) {
        fragments.push(Buffer.from(chunk.subarray(start,i)));
        line(Buffer.concat(fragments));
        fragments=[];start=i+1;
      }
      if(start<count)fragments.push(Buffer.from(chunk.subarray(start,count)));
    }
    if(fragments.length){line(Buffer.concat(fragments));terminated=false;}
    if(failed)this.dropTornTail(failed);
    // A v1.4.0 journal can end with a complete record and no newline; the
    // next append must start on its own line.
    else if(!terminated)fs.writeFileSync(this.handle!,'\n');
  }
  private corruption(failed:{number:number;offset:number;error:unknown}):Error {
    return new Error('Coordinator journal '+this.mainPath+' is corrupt at line '+failed.number+', byte offset '+failed.offset+
      ' ('+(failed.error as Error).message+'). Records follow it, so this is not a torn last write. Stop the console, back up the'+
      ' file, then delete or repair that line; the coordinator starts with every other record.');
  }
  /**
   * The last line of a journal written by a process that crashed mid-append.
   * Its bytes go to a copy next to the journal, and the journal ends at the
   * last complete record.
   */
  private dropTornTail(failed:{number:number;offset:number}):void {
    const size=fs.fstatSync(this.handle!).size,tail=Buffer.alloc(size-failed.offset);
    fs.readSync(this.handle!,tail,0,tail.length,failed.offset);
    const copy=this.mainPath+'.torn-'+Date.now();
    fs.writeFileSync(copy,tail);
    // Windows refuses ftruncate on an append handle; truncate by path and reopen.
    fs.closeSync(this.handle!);this.handle=undefined;
    fs.truncateSync(this.mainPath,failed.offset);
    this.handle=fs.openSync(this.mainPath,'a+');fs.fsyncSync(this.handle);
    const key=/^\{"((?:[^"\\]|\\.)*)":/.exec(tail.toString('utf8'))?.[1];
    console.warn('Coordinator journal ended with a torn write'+(key ? ' of "'+key+'"' : '')+' at line '+failed.number+
      ' ('+tail.length+' bytes); dropped it and kept a copy at '+copy);
  }
  private record(line:string,bytes:number):void {
    if(!line.trim())return;
    const entry=Object.entries(JSON.parse(line) as Record<string,unknown>)[0];
    if(!entry)throw new Error('Empty storage record');
    const [key,value]=entry;
    this.liveBytes-=this.values.get(key)?.bytes||0;
    if(value===null)this.values.delete(key);
    else {this.values.set(key,{value,parsed:true,bytes});this.liveBytes+=bytes;}
  }
  private json(stored:StoredValue):string {
    return stored.json??=JSON.stringify(stored.value);
  }
  private static record(key:string,json:string):string {
    return '{'+JSON.stringify(key)+':'+json+'}\n';
  }
  refactor():void {
    if(this.closed || Date.now()<this.compactRetryAt)return;
    const replacement=fs.openSync(this.replacementPath,'w');
    let bytes=0;
    try {
      for(const [key,stored] of this.values) {
        const record=CoordinatorJsonlStore.record(key,this.json(stored));
        stored.bytes=Buffer.byteLength(record);
        fs.writeFileSync(replacement,record);bytes+=stored.bytes;
      }
      fs.fsyncSync(replacement);
    } finally {fs.closeSync(replacement);}
    fs.closeSync(this.handle!);this.handle=undefined;
    try {fs.renameSync(this.replacementPath,this.mainPath);this.bytes=this.liveBytes=bytes;this.compactRetryAt=0;}
    catch(error) {this.deferCompaction(error);}
    finally {this.handle=fs.openSync(this.mainPath,'a+');}
  }
  private deferCompaction(error:unknown):void {
    const code=(error as NodeJS.ErrnoException).code;
    if(!['EPERM','EACCES','EBUSY'].includes(code || ''))throw error;
    // The append journal remains authoritative. Do not turn a Windows sharing
    // conflict during optional compaction into a failed, already-written request.
    this.compactRetryAt=Date.now()+30000;
    console.warn('Coordinator journal compaction deferred for 30 seconds: '+code);
  }
  /** Returns the record's size in bytes. */
  private append(key:string,json:string):number {
    if(this.closed)throw new Error('Storage is closed');
    const record=CoordinatorJsonlStore.record(key,json),bytes=Buffer.byteLength(record);
    fs.writeFileSync(this.handle!,record);this.bytes+=bytes;
    return bytes;
  }
  private grown():boolean {
    const superseded=this.bytes-this.liveBytes;
    return superseded>COMPACT_SUPERSEDED_BYTES && superseded>COMPACT_GROWTH*this.liveBytes;
  }
  private compactIfNeeded():void {
    if(this.bytes>=COMPACT_MAX_BYTES){this.refactor();return;}
    // Growth compaction runs after the current request or status report, so
    // the save that crossed the threshold returns at its own cost.
    if(this.pendingCompaction || !this.grown())return;
    this.pendingCompaction=setImmediate(()=>{
      this.pendingCompaction=undefined;
      if(this.grown())this.refactor();
    });
    this.pendingCompaction.unref();
  }
  get(key:string):unknown {
    const stored=this.values.get(key);
    if(stored && !stored.parsed){stored.value=JSON.parse(stored.json!);stored.parsed=true;}
    return stored?.value;
  }
  /**
   * The store serializes the value before it returns, so callers may keep
   * mutating their object. Equal content appends nothing; replay would
   * produce the same value.
   */
  set(key:string,value:unknown):this {
    const json=value===null ? undefined : JSON.stringify(value);
    // undefined and functions have no JSON form; a record without a value
    // would make the journal unreadable, so they save as a deletion.
    if(json===undefined){this.delete(key);return this;}
    return this.setSerialized(key,json);
  }
  /** Save text the caller already produced with JSON.stringify. */
  setSerialized(key:string,json:string):this {
    const stored=this.values.get(key);
    if(stored && this.json(stored)===json)return this;
    const bytes=this.append(key,json);
    this.liveBytes+=bytes-(stored?.bytes||0);
    this.values.set(key,{json,parsed:false,bytes});
    this.compactIfNeeded();return this;
  }
  delete(key:string):boolean {
    const stored=this.values.get(key);
    if(!stored)return false;
    this.append(key,'null');this.values.delete(key);this.liveBytes-=stored.bytes;
    this.compactIfNeeded();return true;
  }
  *entries():IterableIterator<[string,unknown]> {
    // Map iteration tolerates the deletes a storage "clear" makes while it runs.
    for(const key of this.values.keys())yield [key,this.get(key)];
  }
  close():void {
    if(this.closed)return;
    clearInterval(this.timer);
    // The vm host in scripts/tests/helpers/coordinator-host.cjs defines no clearImmediate.
    if(this.pendingCompaction!==undefined)clearImmediate(this.pendingCompaction);
    // Leave a compact journal for the next start. A failed open keeps its
    // source untouched, and a failed compaction still releases the lock.
    if(this.opened && this.bytes>this.liveBytes && this.liveBytes<=CLOSE_COMPACT_MAX_BYTES) {
      try {this.refactor();}
      catch(error) {console.warn('Coordinator journal compaction at shutdown failed; the append journal is intact',error);}
    }
    this.closed=true;
    if(this.handle!==undefined)fs.closeSync(this.handle);
    if(this.lock!==undefined){fs.closeSync(this.lock);fs.unlinkSync(this.lockPath);}
    if(this.guard!==undefined)fs.closeSync(this.guard);
  }
}
