const zones = require('../characters/farming-zones.cjs');
const COOLDOWN = 120000;
function fighting(status, now) {
  if (!status || status.rip || now - status.seenAt > 10000) return false;
  return (status.threats || []).some(t => t.hp > 0) || !!(status.target && status.target.hp > 0 &&
    (status.combat?.canAttack || status.combat?.inRange || now - Number(status.combat?.lastAttackAt || 0) < 3000));
}
function record(state, reports, owned, areas, now) {
  state.activity ||= {}; state.seen ||= {}; state.quiet ||= {};
  for (const report of reports) {
    for (const hit of (report.farmAreaEvidence || []).slice(-20)) {
      if (!hit.key || owned.includes(hit.actor) || !hit.actor || now - hit.at > 10000 || hit.at > now + 1000) continue;
      if (state.seen[hit.key]) continue;
      state.seen[hit.key] = now;
      for (const area of areas) {
        if (!area.monsterIds.includes(hit.mtype) || !zones.contains(area,hit)) continue;
        const value = state.activity[area.id] ||= { hits: [] };
        value.hits = value.hits.filter(at => now - at < 10000); value.hits.push(hit.at);
        if (hit.kill || value.hits.length >= 2) {
          value.until = now + COOLDOWN; value.actor = hit.actor;
        }
      }
    }
    const observed = report.farmAreaObservation;
    if (observed && now-observed.at<10000 && areas.some(a=>a.id===observed.id)) state.quiet[observed.id]=observed.at;
  }
  for (const [key,at] of Object.entries(state.seen)) if(now-at>15000) delete state.seen[key];
  for (const [key,value] of Object.entries(state.activity)) if ((value.until||0)<now && !value.hits.some(at=>now-at<10000)) delete state.activity[key];
  for (const [key,at] of Object.entries(state.quiet)) if(now-at>COOLDOWN)delete state.quiet[key];
}
function alternatives(state, areas, active, now, excluded = []) {
  return areas.filter(a => a.id !== active.id && !excluded.includes(a.id) &&
    !(state.activity?.[a.id]?.until > now)).sort((a,b) =>
      Number(b.map===active.map)-Number(a.map===active.map) || b.monsterIds.length-a.monsterIds.length ||
      Number(!!state.quiet?.[b.id])-Number(!!state.quiet?.[a.id]) ||
      Math.hypot(a.x-active.x,a.y-active.y)-Math.hypot(b.x-active.x,b.y-active.y) || a.id.localeCompare(b.id));
}
module.exports = { fighting, record, alternatives, COOLDOWN };
