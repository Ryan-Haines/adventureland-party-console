import type { ItemInfo } from 'typed-adventureland';

export type NativeLoadout = 'fragile' | 'god' | 'combat-range';
type Equipment = Pick<ItemInfo, 'name' | 'level'>;
const item = (name: Equipment['name'], level: number): Equipment => ({name, level});

/** Native initial gear only. Neither profile overrides damage, movement, or death. */
export const loadouts = {
  fragile: {
    description: 'Level 80, starter weapon and level-zero helmet/shoes; no defensive armor or jewelry.',
    armor: {helmet:item('helmet',0),shoes:item('shoes',0)},
    weaponLevel: 0,
  },
  god: {
    description: 'Level 80, +100 weapon/heavy armor and vitality rings, +20 class amulet/belt; native damage and survival with bounded movement gear.',
    armor: {helmet:item('hhelmet',100),chest:item('harmor',100),pants:item('hpants',100),
      gloves:item('hgloves',100),shoes:item('wingedboots',12),cape:item('angelwings',20),
      ring1:item('vitring',100),ring2:item('vitring',100)},
    weaponLevel: 100,
  },
  'combat-range': {
    description: 'Level 80, native level-zero class weapon for normal mage range, durable armor for bounded range-recovery observation.',
    armor: {helmet:item('hhelmet',100),chest:item('harmor',100),pants:item('hpants',100),
      gloves:item('hgloves',100),shoes:item('wingedboots',12),cape:item('angelwings',20),
      ring1:item('vitring',100),ring2:item('vitring',100)},
    weaponLevel: 0,
  },
} as const;

/** Runs after reset, before native login: no connected character is modified. */
export async function seedLoadout(admin: (code: string) => Promise<unknown>, profile: NativeLoadout, primaryClass: 'warrior' | 'ranger' | 'mage' = 'warrior') {
  const selected=loadouts[profile];
  if(!selected)throw Error('Unknown native loadout: '+profile);
  const result = await admin(`output=(async()=>{
    if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Loadouts require disconnected native clients');
    const profile=${JSON.stringify(profile)},definition=${JSON.stringify(selected)},result={profile,description:definition.description,characters:[]};
    for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']) {
      const c=await db.collection('character').findOne({name:name.toLowerCase()});
      if(!c)throw Error('Missing loadout character: '+name);
      // Keep the fixture account name stable; native login and account discovery
      // both receive the requested class before equipment is calculated.
      if(name==='E2EWarrior')c.type=${JSON.stringify(primaryClass)};
      const slots=structuredClone(G.classes[c.type].base_slots||{});
      const weaponLevel=definition.weaponLevel;
      for(const value of Object.values(slots))if(value&&value.name)value.level=weaponLevel;
      Object.assign(slots,structuredClone(definition.armor));
      if(profile==='god'||profile==='combat-range') {
        const stat=c.type==='warrior'?'str':c.type==='ranger'?'dex':'int';
        slots.amulet={name:stat+'amulet',level:20};slots.belt={name:stat+'belt',level:20};
      }
      for(const [slot,value] of Object.entries(slots))if(value&&value.name&&!G.items[value.name])throw Error('Unknown native gear '+slot+': '+value.name);
      c.info.slots=slots;
      // Native login computes maximum health/mana and clamps these starting pools.
      c.info.hp=profile==='fragile'?10000:1000000000;c.info.mp=profile==='fragile'?10000:1000000000;
      const update=await db.collection('character').replaceOne({_id:c._id},c);
      if(update.matchedCount!==1)throw Error('Loadout character was not persisted: '+name);
      const saved=await db.collection('character').findOne({_id:c._id});
      if(JSON.stringify(saved.info.slots)!==JSON.stringify(slots))throw Error('Loadout persistence mismatch: '+name);
      result.characters.push({name,storedName:c.name,type:c.type,level:c.level,slots:saved.info.slots});
    }
    return result;
  })()`);
  const seed=result as {profile?:unknown;characters?:{name?:string;slots?:Record<string,Equipment>}[]}|null;
  if(seed?.profile!==profile||!Array.isArray(seed.characters)||seed.characters.length!==3)
    throw Error('Native loadout returned an incomplete seed: '+JSON.stringify(result));
  for(const name of ['E2EWarrior','E2EPriest','E2EMerchant']) {
    const character=seed.characters.find(entry=>entry.name===name);
    const weaponLevel=selected.weaponLevel;
    if(character?.slots?.mainhand?.level!==weaponLevel)
      throw Error('Native loadout weapon mismatch: '+name);
    for(const [slot,expected] of Object.entries(selected.armor)) {
      const actual=character.slots[slot];
      if(actual?.name!==expected.name||actual?.level!==expected.level)
        throw Error('Native loadout armor mismatch: '+name+' '+slot);
    }
  }
  return result;
}
