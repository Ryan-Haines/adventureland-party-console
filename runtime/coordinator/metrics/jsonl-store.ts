import * as fs from 'node:fs';
import {spawnSync} from 'node:child_process';

import {processLockActive, processLockIdentity} from '../persistence/process-lock.ts';

/**
 * Compaction thresholds, the rule of the coordinator journal
 * (persistence/jsonl-store.ts): compact once superseded records exceed both
 * `supersededBytes` and `growth` times the live records, or `maxBytes` alone.
 * A compaction leaves only the live set, so a large live set does not
 * trigger the next one.
 */
export interface MetricsCompactionLimits { supersededBytes: number; growth: number; maxBytes: number }
export const METRICS_COMPACTION: MetricsCompactionLimits = {
  supersededBytes: 32 * 1024 * 1024, growth: 3, maxBytes: 128 * 1024 * 1024,
};

/** Metrics journal: ordered asynchronous writes, yielding compaction and explicit durable acknowledgement. */
export class MetricsJsonlStore {
  private pending: Promise<void> = Promise.resolve();
  private failure: unknown;
  private compacting = false;
  private enqueue(work: () => Promise<void>): void {
    this.pending = this.pending.then(work).catch(error => { this.failure ||= error; });
  }
  async flush(): Promise<void> { await this.pending; if(this.failure)throw this.failure; }
  private values = new Map<string,unknown>();
  private handle: number | undefined;
  private lock: number | undefined;
  private guard: number | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private bytes = 0;
  /** Bytes of the newest record of each live key; what a compaction writes. */
  private liveBytes = 0;
  private sizes = new Map<string,number>();
  private limits: MetricsCompactionLimits;
  private compactRetryAt = 0;
  private closed = false;
  private lockPath: string;
  private mainPath:string;
  private replacementPath:string;
  constructor(mainPath='garage.jsonl',replacementPath='garage.new.jsonl',interval=30000,limits=METRICS_COMPACTION) {
    this.mainPath=mainPath;this.replacementPath=replacementPath;this.limits=limits;
    if(mainPath===replacementPath)throw new Error('Storage main and replacement paths must differ');
    this.lockPath=mainPath+'.writer.lock';
    try {
      this.acquire();
      if(!fs.existsSync(mainPath) && fs.existsSync(replacementPath))fs.renameSync(replacementPath,mainPath);
      this.handle=fs.openSync(mainPath,'a+');
      this.replay();
      this.bytes=fs.fstatSync(this.handle).size;
      // Startup replay is synchronous, runtime compaction is incremental.
      // Startup rewrites only a journal with superseded records.
      if(this.bytes>this.liveBytes)this.refactor();
      // Every write checks growth; the timer retries a deferred compaction.
      this.timer=setInterval(()=>this.compactIfNeeded(),interval);
      this.timer.unref();
    } catch(error) {void this.close().catch(()=>{});throw error;}
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
    // The next append must start on its own line.
    else if(!terminated)fs.writeFileSync(this.handle!,'\n');
  }
  private corruption(failed:{number:number;offset:number;error:unknown}):Error {
    return new Error('Metrics journal '+this.mainPath+' is corrupt at line '+failed.number+', byte offset '+failed.offset+
      ' ('+(failed.error as Error).message+'). Records follow it, so this is not a torn last write. Stop the console, back up the'+
      ' file, then delete or repair that line.');
  }
  /**
   * The last line of a journal written by a process that crashed mid-append.
   * Its bytes go to a copy next to the journal, and the journal ends at the
   * last complete record, as in persistence/jsonl-store.ts.
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
    console.warn('Metrics journal ended with a torn write at line '+failed.number+' ('+tail.length+
      ' bytes); dropped it and kept a copy at '+copy);
  }
  private record(line:string,bytes:number):void {
    if(!line.trim())return;
    const entry=Object.entries(JSON.parse(line) as Record<string,unknown>)[0];
    if(!entry)throw new Error('Empty storage record');
    const [key,value]=entry;
    this.track(key,value===null?0:bytes);
    if(value===null)this.values.delete(key);else this.values.set(key,value);
  }
  /** Records `bytes` as the live record size of `key`; 0 for a deleted key. */
  private track(key:string,bytes:number):void {
    this.liveBytes+=bytes-(this.sizes.get(key)||0);
    if(bytes)this.sizes.set(key,bytes);else this.sizes.delete(key);
  }
  refactor():void {
    if(this.closed || this.compacting || Date.now()<this.compactRetryAt)return;
    this.compacting=true;
    const snapshot=[...this.values], queuedBytes=this.bytes;
    this.enqueue(async()=>{
      let bytes=0;
      const replacement=await fs.promises.open(this.replacementPath,'w');
      try {
        for(const [key,value] of snapshot){
          const record=JSON.stringify({[key]:value})+'\n';
          await replacement.writeFile(record);bytes+=Buffer.byteLength(record);
        }
        await replacement.sync();
      } finally {await replacement.close();}
      fs.closeSync(this.handle!);this.handle=undefined;
      try {await fs.promises.rename(this.replacementPath,this.mainPath);this.bytes=bytes+Math.max(0,this.bytes-queuedBytes);this.compactRetryAt=0;}
      catch(error){this.deferCompaction(error);}
      finally {this.handle=fs.openSync(this.mainPath,'a+');this.compacting=false;}
    });
  }
  private deferCompaction(error:unknown):void {
    const code=(error as NodeJS.ErrnoException).code;
    if(!['EPERM','EACCES','EBUSY'].includes(code || ''))throw error;
    // The append journal remains authoritative. Do not turn a Windows sharing
    // conflict during optional compaction into a failed, already-written request.
    this.compactRetryAt=Date.now()+30000;
    console.warn('Coordinator journal compaction deferred for 30 seconds: '+code);
  }
  private append(key:string,value:unknown):void {
    if(this.closed)throw new Error('Storage is closed');
    const record=JSON.stringify({[key]:value})+'\n',bytes=Buffer.byteLength(record);
    this.bytes+=bytes;this.track(key,value===null?0:bytes);
    this.enqueue(()=>new Promise<void>((resolve,reject)=>fs.writeFile(this.handle!,record,error=>error?reject(error):resolve())));
  }
  private compactIfNeeded():void {
    const superseded=this.bytes-this.liveBytes;
    if(superseded>=this.limits.maxBytes ||
      (superseded>this.limits.supersededBytes && superseded>this.limits.growth*this.liveBytes))this.refactor();
  }
  get(key:string):unknown {return this.values.get(key);}
  set(key:string,value:unknown):this {
    if(this.get(key)===value)return this;
    this.append(key,value);
    if(value===null)this.values.delete(key);else this.values.set(key,value);
    this.compactIfNeeded();return this;
  }
  delete(key:string):boolean {
    if(!this.values.has(key))return false;
    this.append(key,null);const removed=this.values.delete(key);
    this.compactIfNeeded();return removed;
  }
  entries():IterableIterator<[string,unknown]> {return this.values.entries();}
  async close():Promise<void> {
    if(this.closed)return;
    this.closed=true;clearInterval(this.timer);
    try { await this.flush(); } finally {
      if(this.handle!==undefined)fs.closeSync(this.handle);
      if(this.lock!==undefined){fs.closeSync(this.lock);fs.unlinkSync(this.lockPath);}
      if(this.guard!==undefined)fs.closeSync(this.guard);
    }
  }
}
