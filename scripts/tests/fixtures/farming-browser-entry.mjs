import { farmingAreas } from '../../../dashboard/lib/farming-areas.cjs';
globalThis.farmingBrowserResult = farmingAreas([
 {id:'bee',locations:[{map:'main',x:50,y:50,boundary:[0,0,100,100]}]},
 {id:'snake',locations:[{map:'main',x:100,y:50,boundary:[50,0,150,100]}]}
], ['bee','snake']);
