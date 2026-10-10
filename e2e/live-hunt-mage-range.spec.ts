import {test,expect} from './live-fixtures';
import {W,P,evidence} from './hunt-interruption-helpers';

test.use({primaryClass:'mage',loadout:'combat-range'});

test('native mage closes from outside range and damages a fast Phoenix',async({live},info)=>{
  test.setTimeout(180000);
  expect(await live.clients[W].run('character.ctype')).toBe('mage');
  await live.post('/merchant/force-stand',{enabled:true});
  await live.post('/formation',{leader:P});
  await live.post('/formation',{character:W,follow:true});
  const seed=await live.admin(`output=(()=>{
    const p=get_player(${JSON.stringify(W)}),priest=get_player(${JSON.stringify(P)});
    const distance=p.range+55;
    for(let i=0;i<32;i++){
      const a=i*Math.PI/16,x=p.x+distance*Math.cos(a),y=p.y+distance*Math.sin(a);
      if(!can_move({map:p.map,x:p.x,y:p.y,going_x:x,going_y:y,base:p.base}))continue;
      const m=new_monster(p.in,{type:'phoenix',position:[x,y],radius:0,count:1},{temp:1});
      m.hp=m.max_hp=Math.ceil((p.attack*p.frequency+priest.attack*priest.frequency)*60);
      m.e2eHunt=true;
      return {id:String(m.id),map:m.map,x:m.x,y:m.y,hp:m.hp,speed:m.speed,range:m.range,
        mage:{name:p.name,type:p.type,x:p.x,y:p.y,range:p.range},initialDistance:Math.hypot(m.x-p.x,m.y-p.y)};
    }
    throw Error('No collision-safe Phoenix outside mage range');
  })()`);
  expect(seed.initialDistance).toBeGreaterThan(seed.mage.range);
  expect(seed.mage.range,'Use normal native mage range, not a +100 weapon range bonus').toBeLessThan(220);
  await info.attach('native-mage-phoenix-initial-seed',{body:JSON.stringify(seed),contentType:'application/json'});
  const timeline:unknown[]=[];
  try{
    await live.post('/focus',{monsterFocus:['phoenix'],monsterPriorities:{phoenix:999},monsterSearchRadius:500});
    await live.post('/rare-hunting',{rules:{phoenix:{enabled:true,keepMoving:false,priority:999}},useFieldGenerators:false});
    await expect.poll(async()=>{
      timeline.push(await live.clients[W].run(`(()=>{const t=parent.entities[${JSON.stringify(seed.id)}];return {at:Date.now(),target:character.target,x:character.real_x,y:character.real_y,range:character.range,distance:t?distance(character,t):null,position:globalThis.partyCombatPosition||null}})()`));
      return (await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W&&event.data?.damage>0).length;
    },{timeout:60000,intervals:[250,500],message:'The real mage must reengage and produce native Phoenix damage'}).toBeGreaterThan(0);
    await evidence(live,info,'native-mage-phoenix-range-recovered',{seed,timeline,hits:(await live.clients[W].events()).filter((event:any)=>event.event==='hit'&&String(event.data?.id)===seed.id&&event.data?.hid===W)});
    await info.attach('native-mage-phoenix-range-client',{body:await live.clients[W].page.screenshot(),contentType:'image/png'});
  }finally{
    await info.attach('native-mage-phoenix-position-timeline',{body:JSON.stringify(timeline),contentType:'application/json'});
  }
});
