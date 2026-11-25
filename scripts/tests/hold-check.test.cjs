// The hold check (runtime/protocol/hold-check.ts): a fighter holds while its healing keeps up with
// the damage it takes. Movement's group walk defense and survival's `{hold}` verdict
// call it. Failure list first.
// Each case
// needs an exact damage, potion or HP schedule that no run can hold. The clean build (2026-11-07)
// moved these rows here from tank-hold-check.test.cjs, which left with the tank-hold add-on.
// Every expected value is worked by hand below; the potion figures are game data
// (G.skills.use_mp cooldown 2000 ms, regen_mp 100 MP per 4 s).
const assert=require('node:assert/strict');
const {holdCheck,nextBlows,fightWinnable}=require('../../runtime/protocol/hold-check.ts');
// Every case is a row of one scenario table: one behaviour, the hold
// check's arithmetic, with the warrior and priest builders below as its shared setup.
const tables=require('./helpers/row-table.cjs').rowTables();
const row=(name,check)=>tables.row('the hold check keeps back the next blow of every attacker and the HP potion a planned MP potion blocks, and returns without flipping at the edge',name,check);

const potions=(hp=0,mp=0,hpGives=400,mpGives=500)=>({hp:{count:hp,gives:hpGives},mp:{count:mp,gives:mpGives},cooldownSeconds:2,regenMp:{output:100,cooldownSeconds:4}});
// A warrior tank healed by a priest that heals 250 per second, one heal a second.
const warrior=extra=>({hp:2000,mp:0,priest:false,heal:{amount:250,perSecond:1,mpPerHeal:0},attackers:[{dps:300,hp:5000}],
  killRate:250,stepSeconds:0.5,healCycleSeconds:1,potions:potions(),energizeMp:0,...extra});
// A priest tank: its own heal of 300 per second costs 100 MP per heal.
const priest=extra=>({hp:3000,mp:3000,priest:true,heal:{amount:300,perSecond:1,mpPerHeal:100},attackers:[{dps:400,hp:4000}],
  killRate:200,stepSeconds:0.5,healCycleSeconds:1,potions:potions(),energizeMp:0,...extra});

row('the HP must outlast the next blow of every attacker in a pack, which can land at once',()=>{
  // Three attackers at 100/s each, one 100-damage blow each, no heal: net loss 300/s. 560 HP
  // less one blow lasts 1.53 s, past the 1.5 s step and heal cycle; less all three blows it
  // lasts 0.87 s, under it.
  const pack=[0,1,2].map(()=>({dps:100,hp:5000,blow:100}));
  const r=holdCheck(warrior({hp:560,heal:null,attackers:pack}));
  assert.equal(r.fails,true);assert.equal(r.reason,'hp');
  // A measured 150 crit stands in for the biggest attacker's blow: 560 - 350 lasts 0.7 s.
  assert.equal(nextBlows({attackers:pack,largestHit:150}),350);
  assert.equal(holdCheck(warrior({hp:800,heal:null,attackers:pack})).fails,false);
});

row('item 14: an MP potion during heavy damage takes the HP potion it blocks out of the HP check',()=>{
  // 500 damage against a 300 heal is a 200/s loss; HP potions (400 per 2 s) cover it.
  const heavy={hp:250,attackers:[{dps:500,hp:4000}],potions:potions(5,10)};
  assert.equal(holdCheck(priest({...heavy,mp:3000})).fails,false);
  // With mana short the potion group goes to mana: the HP check loses the HP potions, and
  // 250 HP at 200/s lasts 1.25 s, under the 1.5 s of a step and a heal cycle.
  const short=holdCheck(priest({...heavy,mp:300}));
  assert.equal(short.fails,true);assert.equal(short.reason,'hp');
  assert.equal(short.rates.hpPotions,0);
});

row('a mage in energize range holds a priest tank whose own mana runs out before the fight ends',()=>{
  // The priest's heal costs 100 MP a second and regeneration gives 25, a 75/s drain; the fight
  // is 4000 HP at 200/s, 20 s. 1000 MP lasts 13.3 s, and with a mage's 1000 MP of energize it
  // lasts 26.7 s.
  const low=holdCheck(priest({mp:1000}));
  assert.equal(low.fails,true);assert.equal(low.reason,'mana');
  assert.equal(holdCheck(priest({mp:1000,energizeMp:1000})).fails,false);
});

row('item 15: the tank returns only when HP and mana last the fight, so it does not flip',()=>{
  // Net loss 50/s and a 20 s fight: 1000 HP lasts the fight, 900 does not.
  const fight={hp:1000,killRate:250,attackers:[{dps:300,hp:5000}]};
  assert.equal(holdCheck(warrior(fight)).recovered,true);
  const edge=holdCheck(warrior({...fight,hp:900}));
  // Between the tests: neither failing nor recovered, so the tank keeps doing what it does.
  assert.equal(edge.fails,false);assert.equal(edge.recovered,false);
  // A fight the heals out-pace counts as recovered at any HP.
  assert.equal(holdCheck(warrior({hp:300,attackers:[{dps:200,hp:5000}]})).recovered,true);
});

// Survival answers the `{hold}` question an add-on asks with this same check over the supply it
// sends: `step` when the hold fails, `hold` otherwise.
const {createRegistry}=require('../../runtime/hooks/registry.ts');
const {installCharacterAnswers}=require('./helpers/survival-answers.cjs');
row('an add-on asking the {hold} verdict gets the hold check answer',()=>{
  const r=installCharacterAnswers(createRegistry());
  const ask=supply=>r.survival.verdict({hold:true,tank:'W',attackers:supply.attackers,supply});
  assert.equal(ask(warrior({hp:560,heal:null,attackers:[0,1,2].map(()=>({dps:100,hp:5000,blow:100}))})),'step');
  assert.equal(ask(warrior({})),'hold');
});

// fightWinnable: a goo deals 100 pure damage a second to the member it targets. The priest
// heals one member a cast at its frequency, and while it heals it does not attack.
const goos={goo:{attack:100,frequency:1,damage_type:'pure'}};
const goo=target=>({mtype:'goo',hp:450,target});
row("two targeted members share the priest's heals, which leave the kill rate",()=>{
  // W and R each take 200/s. Shared, each gets 50/s of heal and loses 150/s: 900 HP lasts 6 s, and
  // W and R kill the 1800 HP of goos at 100/s in 18 s. Counting the whole heal on both and the priest's
  // attack too, each lost 100/s against a 9 s fight and the fight read winnable.
  const party=[{name:'W',hp:900,attack:50,frequency:1},{name:'R',hp:900,attack:50,frequency:1},{name:'P',ctype:'priest',hp:1500,attack:100,frequency:1}];
  assert.equal(fightWinnable(party,[goo('W'),goo('W'),goo('R'),goo('R')],goos),false);
});
row("the priest's attack leaves the kill rate while it heals the one targeted member",()=>{
  // W takes 200/s and gets the priest's whole 100/s heal: 900 HP lasts 9 s. W alone kills 900 HP at
  // 50/s in 18 s; with the priest's 100/s added the fight read 6 s and winnable.
  const party=[{name:'W',hp:900,attack:50,frequency:1},{name:'P',ctype:'priest',hp:1500,attack:100,frequency:1}];
  assert.equal(fightWinnable(party,[goo('W'),goo('W')],goos),false);
  // The heal alone keeps W up: 100/s of loss heals back in full against one goo.
  assert.equal(fightWinnable(party,[goo('W')],goos),true);
});
row('a monster whose self heal outheals the party never dies, so the fight is not winnable',()=>{
  // Live 2026-11-22, level2e: a level 8 pinkgoblin (G.monsters.pinkgoblin: 2400 magical attack at
  // 0.4, self_healing 96000 per 4000 ms) on Sadokunn, with Recharged's heals and Sqweeks' attacks.
  // The priest's 1294/s heal outlasts the goblin's damage, and the party's 1651/s kill rate read a
  // 1144 s fight, but the goblin heals 24000/s and stayed at full HP for two hours.
  const goblins={pinkgoblin:{attack:2400,frequency:0.4,damage_type:'magical',abilities:{self_healing:{heal:96000,cooldown:4000}}}};
  const party=[{name:'Sadokunn',ctype:'warrior',hp:10699,attack:1289,frequency:0.821,armor:531,resistance:313},
    {name:'Recharged',ctype:'priest',hp:7708,attack:1056,frequency:1.225},{name:'Sqweeks',ctype:'rogue',hp:7998,attack:392,frequency:1.513}];
  const goblin={mtype:'pinkgoblin',hp:1890000,target:'Sadokunn'};
  assert.equal(fightWinnable(party,[goblin],goblins),false);
  // The same goblin without its self heal is a long fight the priest's heals win.
  assert.equal(fightWinnable(party,[goblin],{pinkgoblin:{...goblins.pinkgoblin,abilities:{}}}),true);
});

tables.run();
