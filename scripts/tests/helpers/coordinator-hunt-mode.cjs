// The hunting owner's Hunt routes (runtime/hunting/coordinator/routes.ts `createHuntRoutes`) over a fixture's
// party. `ports` plants createHuntRoutes's own ports by name; the rest hold nothing. `huntMode` answers the
// farming-mode route.
const {createHuntRoutes}=require('../../../runtime/hunting/coordinator/routes.ts');
const {settingsWriter}=require('./settings-writer.cjs');
function huntRoutes(party,ports){
 return createHuntRoutes(party,{
  participants:()=>[],release(){},authorize(){},monsterDestination:()=>undefined,clear(){},selectedDestination:()=>null,convoy(){},
  begin(){},now:()=>Date.now(),fighting:()=>false,intent:()=>null,waypoint:()=>null,write:settingsWriter(party).write,owned:()=>null,
  ownsTravel:()=>false,fresh:()=>true,cancelConvoy(){},start:()=>false,persist(){},group:()=>null,
  ...ports,
 });
}
const huntMode=(party,ports)=>huntRoutes(party,ports).mode;
module.exports={huntMode,huntRoutes};
