import type { ItemInfo } from 'typed-adventureland';

export type NativeLoadout = 'fragile' | 'god' | 'combat-range' | 'combat-follow-range' | 'god-mage-range';
type Equipment = Pick<ItemInfo, 'name' | 'level'>;
const item = (name: Equipment['name'], level: number): Equipment => ({name, level});

/** Native initial gear only. Neither profile overrides damage, movement, or death. */
const baseLoadouts = {
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
export const loadouts={...baseLoadouts,'combat-follow-range':{...baseLoadouts['combat-range'],description:'Durable native armor with upgraded staff weapons for caster follow-clearance recovery.'},
  // The god party with the mage on its level-zero class weapon: a +100 staff gives a mage an attack
  // range of 483, past energize's 320, so a row that needs the mage beside the tank uses this one.
  'god-mage-range':{...baseLoadouts.god,description:'The god loadout with the mage on its level-zero class weapon, for a normal mage range.',mageWeaponLevel:0}} as const;
const mageWeaponLevel=(profile:NativeLoadout)=>(loadouts[profile] as {mageWeaponLevel?:number}).mageWeaponLevel;

/** Runs after reset, before native login: no connected character is modified. */
export async function seedLoadout(admin: (code: string) => Promise<unknown>, profile: NativeLoadout, primaryClass: 'warrior' | 'ranger' | 'mage' = 'warrior', extraFighter: 'mage' | null = null) {
  const names=['E2EWarrior','E2EPriest','E2EMerchant',...(extraFighter?['E2EBankBoi']:[])];
  const selected=loadouts[profile];
  if(!selected)throw Error('Unknown native loadout: '+profile);
  const result = await admin(`output=(async()=>{
    if(Object.keys(players).length||Object.keys(dc_players).length)throw Error('Loadouts require disconnected native clients');
    const profile=${JSON.stringify(profile)},definition=${JSON.stringify(selected)},result={profile,description:definition.description,characters:[]};
    for(const name of ${JSON.stringify(names)}) {
      const c=await db.collection('character').findOne({name:name.toLowerCase()});
      if(!c)throw Error('Missing loadout character: '+name);
      // Keep the fixture account name stable; native login and account discovery
      // both receive the requested class before equipment is calculated.
      if(name==='E2EWarrior')c.type=${JSON.stringify(primaryClass)};
      if(name==='E2EBankBoi'){c.type=${JSON.stringify(extraFighter)};c.level=80;}
      const slots=structuredClone(G.classes[c.type].base_slots||{});
      const weaponLevel=c.type==='mage'&&definition.mageWeaponLevel!==undefined?definition.mageWeaponLevel:definition.weaponLevel;
      for(const value of Object.values(slots))if(value&&value.name)value.level=weaponLevel;
      Object.assign(slots,structuredClone(definition.armor));
      if(profile==='god'||profile==='god-mage-range'||profile==='combat-range'||profile==='combat-follow-range') {
        const stat=c.type==='warrior'?'str':c.type==='ranger'?'dex':'int';
        slots.amulet={name:stat+'amulet',level:20};slots.belt={name:stat+'belt',level:20};
      }
      if(profile==='combat-follow-range'&&(c.type==='priest'||c.type==='mage'))slots.mainhand={name:'staff',level:c.type==='priest'?12:15};
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
  const seed=result as {profile?:unknown;characters?:{name?:string;type?:string;slots?:Record<string,Equipment>}[]}|null;
  if(seed?.profile!==profile||!Array.isArray(seed.characters)||seed.characters.length!==names.length)
    throw Error('Native loadout returned an incomplete seed: '+JSON.stringify(result));
  for(const name of names) {
    const character=seed.characters.find(entry=>entry.name===name);
    const followStaff=profile==='combat-follow-range'&&(character?.type==='priest'||character?.type==='mage');
    const weaponLevel=followStaff?(character.type==='priest'?12:15):character?.type==='mage'&&mageWeaponLevel(profile)!==undefined?mageWeaponLevel(profile)!:selected.weaponLevel;
    if(character?.slots?.mainhand?.level!==weaponLevel||followStaff&&character.slots.mainhand.name!=='staff')
      throw Error('Native loadout weapon mismatch: '+name);
    for(const [slot,expected] of Object.entries(selected.armor)) {
      const actual=character.slots[slot];
      if(actual?.name!==expected.name||actual?.level!==expected.level)
        throw Error('Native loadout armor mismatch: '+name+' '+slot);
    }
  }
  return result;
}
