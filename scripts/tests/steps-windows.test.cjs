const test=require('node:test'),assert=require('node:assert/strict');
const {windowsOpen,standingAt}=require('../../e2e/steps-windows.ts');

// SV51: the steps windows open at the first kill after
// both fighters stand inside the farm area. The harness builder runs over a recorded log, shaped as
// the fix passes' runs record it: the warrior reaches the farm first and kills on the way while the
// priest still walks in. The farm is the box x 0 to 100 on main.
test('SV51: a steps window opens at the first kill after both fighters stand at the farm', () => {
  const inFarm=p=>p.map==='main'&&p.x>=0&&p.x<=100;
  const at=(at,name,x)=>({at,name,map:'main',x,y:0});
  const log=[at(0,'W',-300),at(0,'P',-400),at(1000,'W',-50),at(1000,'P',-300),at(2000,'W',20),at(2000,'P',-150),
    at(3000,'W',40),at(3000,'P',-20),at(4000,'W',50),at(4000,'P',10),at(5000,'W',60),at(5000,'P',30)];
  // Kills while the priest walks in (2500, 3500) belong to the walk, not the window.
  const kills=[2500,3500,4600,5200];
  assert.equal(standingAt(log,['W','P'],inFarm),4000,'both stand at the farm from the priest\'s first sample inside');
  assert.equal(windowsOpen(log,kills,['W','P'],inFarm),4600,'the first kill after both stand there opens the window');
  assert.equal(windowsOpen(log.filter(p=>p.name==='W'),kills,['W','P'],inFarm),null,'no window while a fighter has no sample at the farm');
  assert.equal(windowsOpen(log,[2500,3500],['W','P'],inFarm),null,'no window before a kill after both stand there');
});
