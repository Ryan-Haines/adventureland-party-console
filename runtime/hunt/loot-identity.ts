export function huntLootId(hunt:any):string {
  const mission=hunt.missions?.[hunt.currentIndex];
  return JSON.stringify([hunt.cycleId,hunt.missionRevision||0,hunt.currentIndex,mission?.target,mission?.owners]);
}
