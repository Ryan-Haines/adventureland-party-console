// Convoy travel samples (a shared setup lives in the harness).
function sample(name,sequence,at,offset=0){return {name,map:'main',in:'main',server:'USII',x:900,y:0,
 hp:100,max_hp:100,rip:false,moving:false,speed:60,convoyProtocol:4,combatSelection:{runtimeId:name},
 travelSample:{runtimeId:name,sequence,connected:true},
 groupedCombat:{reportedAt:at+offset,currentAttackersAt:at+offset,currentAttackers:[],sightings:[],evidence:[],deaths:[],travelCandidates:[]}};}
module.exports = { sample };
