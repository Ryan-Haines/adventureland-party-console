interface Marker {role?:string;state?:string}
/** The grouped queue's rings in order: the fight now, the next and the third. */
export const MARKER_ROLES=['current','next','third'] as const;
/** A ring sits just outside the monster's own width (the game's `awidth`). */
export const markerRadius=(entity:{awidth?:unknown}|null|undefined)=>Math.max(18,(Number(entity&&entity.awidth)||24)/2+4);
/** Explicit roles keep scatter targets red and preserve invisible grouped ranks. */
export function markerStyle(marker:Marker,index=0) {
 const role=marker.role || (marker.state==='scatter'?'current':MARKER_ROLES[index]);
 return {color:role==='current'?0xef4444:0xfacc15,css:role==='current'?'#ef4444':'#facc15',double:role==='third'};
}
