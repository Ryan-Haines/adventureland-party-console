export interface Marker {role?:string;state?:string}
/** Explicit roles keep scatter targets red and preserve invisible grouped ranks. */
export function markerStyle(marker:Marker,index=0) {
 const role=marker.role || (marker.state==='scatter'?'current':['current','next','third'][index]);
 return {color:role==='current'?0xef4444:0xfacc15,css:role==='current'?'#ef4444':'#facc15',double:role==='third'};
}
