const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createCrabRangeRecovery}=require('../../runtime/characters/roles/crab-range.ts');
const sample=()=>({targetId:'crab-1',map:'main',mtype:'crab',at:1000,range:30,
 actor:{x:0,y:0,width:26,height:36},target:{x:70,y:0,width:60,height:64},
 expected:{width:12,height:12},nativeDistance:27,correctedDistance:51});
test('native behavior is unchanged until a qualifying rejection; correction and backoff agree',()=>{
 const r=createCrabRangeRecovery(),s=sample();assert.equal(r.blocked(s,1000),false);
 r.reject(s,{reason:'too_far',dist:51},1000);
 assert.equal(r.distance(s,1001),51);assert.equal(r.blocked(s,1500),true);
 s.correctedDistance=28;assert.equal(r.blocked(s,1499),true);assert.equal(r.blocked(s,1500),false);
 assert.deepEqual(r.diagnostic().rejection,{reason:'too_far',dist:51});
});
test('repeated rejections cannot extend expiry; fixed server returns to native behavior',()=>{
 const r=createCrabRangeRecovery(),s=sample();r.reject(s,{},1000);r.reject(s,{},20000);
 assert.equal(r.diagnostic().expiresAt,31000);assert.equal(r.distance(s,31000),null);
 assert.equal(r.blocked(s,31001),false);assert.equal(r.diagnostic().active,false);
});
test('fixed client geometry immediately retires correction',()=>{
 const r=createCrabRangeRecovery(),s=sample();r.reject(s,{},1000);
 s.target.width=12;s.target.height=12;s.nativeDistance=51;
 assert.equal(r.distance(s,1001),null);assert.equal(r.diagnostic().reason,'native geometry agrees');
});
for(const mutate of [s=>s.mtype='bee',s=>s.nativeDistance=40,s=>s.correctedDistance=29])test('nonqualifying evidence never activates correction: '+mutate,()=>{
 const r=createCrabRangeRecovery(),s=sample();mutate(s);r.reject(s,{},1000);assert.equal(r.distance(s,1001),null);
});
test('selection/map/lifecycle changes reset recovery but inspecting another monster does not',()=>{
 const r=createCrabRangeRecovery(),s=sample();r.reject(s,{},1000);
 assert.equal(r.distance({...s,targetId:'other'},1001),null);assert.equal(r.distance(s,1001),51);
 assert.equal(r.distance(null,1001),null);assert.equal(r.distance(s,1001),51,'inspecting an uncorrected species preserves recovery');
 r.select({...s,targetId:'other'},1002);assert.equal(r.distance(s,1003),null);
 r.reject(s,{},2000);r.select({...s,map:'cave'},2001);assert.equal(r.distance(s,2002),null);
 r.reject(s,{},3000);r.reset();assert.equal(r.distance(s,3001),null);
});
test('installed game geometry reproduces crab mismatch and shared movement uses corrected distance',()=>{
 const source=fs.readFileSync('characters/shared.js','utf8');
 const native=require('./helpers/downloaded-game.cjs').downloadedGameSource('old_common_functions.js');
 const c={character:{x:0,y:0,map:'main',range:30,width:26,height:36},G:{dimensions:{},monsters:{crab:{size:0.5}}},Date};c.root=c;
 vm.runInNewContext(native.slice(native.indexOf('function distance(a, b)'),native.indexOf('function random_away('))+
 native.slice(native.indexOf('function get_xy('),native.indexOf('function calculate_vxy(')),c);
 const start=source.indexOf('    describeAttackRange: function');
 vm.runInNewContext('sharedRoutine={'+source.slice(start,source.indexOf('    start: function',start))+'};',c);
 const target={id:'crab-1',mtype:'crab',x:70,y:0,width:30,height:32,mscale:0.5};
 const s=c.sharedRoutine.describeAttackRange(target);assert.equal(s.nativeDistance,27);assert.equal(s.correctedDistance,51);
 const r=createCrabRangeRecovery();r.reject(s,{},Date.now());
 c.sharedRoutine.correctedCombatDistance=t=>r.distance(c.sharedRoutine.describeAttackRange(t),Date.now());
 vm.runInNewContext(source.slice(source.indexOf('  function desiredCombatRange()'),source.indexOf('  function resetCombatMovement()')),c);
 assert.equal(c.combatDistance(target),51);
 const point=c.combatApproachPoint(target);assert.ok(point.x>0,'movement approaches instead of retreating');
 assert.equal(target.width,30);assert.equal(target.mscale,0.5);
});
