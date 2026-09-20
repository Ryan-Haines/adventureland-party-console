const zones = require('../characters/farming-zones.cjs');
// Durable return ownership for temporary rare encounters. No coordinator globals.
module.exports = function createRareReturn(party, hooks) {
  const now = hooks.now || Date.now;
  function pending() { return party.rareHuntReturn; }
  function names(saved) {
    return Object.keys(saved.revisions || {}).filter(name =>
      !hooks.intent(name).cancelled && hooks.intent(name).revision === saved.revisions[name] &&
      (name === party.leader || party.followers?.[name]));
  }
  function cancelOwned(saved) {
    if (saved?.convoyId && party.activeConvoy?.id === saved.convoyId) hooks.cancelConvoy();
  }
  function clear() {
    cancelOwned(pending()); party.rareHuntReturn = null; hooks.persist();
  }
  function at(name, saved) {
    const s = party.statuses[name], d = saved.returnLocation;
    return !!(s && d && s.seenAt >= now() - 10000 && !s.rip && s.hp !== 0 &&
      hooks.realm(s) === saved.realm && s.map === d.map &&
      (d.in == null || String(s.in ?? s.map) === String(d.in)) &&
      ((d.boundary || d.shapes) ? zones.contains(d,s,0,180) : Math.hypot(s.x-d.x,s.y-d.y) <= 180));
  }
  function tick(paused) {
    const saved = pending();
    if (!saved) return false;
    const lead = party.statuses[party.leader];
    if (saved.leader !== party.leader || saved.focus !== JSON.stringify(party.monsterFocus) ||
        saved.policy !== party.farmingPolicy || !names(saved).includes(party.leader) ||
        lead?.seenAt >= now()-3000 && hooks.realm(lead) !== saved.realm) {
      clear(); return false;
    }
    if (paused || !lead || lead.seenAt < now()-3000) {
      cancelOwned(saved); return true;
    }
    if (saved.hunt && party.monsterHunt) {
      // The interrupted mission is still authoritative. Its convoy was cancelled,
      // not completed; let normal Hunt travel restart the same destination.
      const hunt = party.monsterHunt;
      if (saved.cycleId && hunt.cycleId !== saved.cycleId) { clear(); return false; }
      hunt.convoyId = null;
      if (['farming','mission-travel'].includes(hunt.stage)) hunt.stage = 'mission-travel';
      clear(); return false; // The normal Hunt controller now owns travel.
    }
    const participants = names(saved);
    if (!saved.returnLocation || participants.every(name => at(name,saved))) {
      clear(); return false;
    }
    const convoy = party.activeConvoy;
    if (convoy && convoy.id === saved.convoyId) {
      if (convoy.phase !== 'failed') return true;
      cancelOwned(saved);
    } else if (convoy) return true; // Never preempt another activity's travel.
    if (saved.retryAt > now()) return true;
    saved.retryAt = now()+5000;
    const online = participants.filter(name => {
      const s=party.statuses[name];
      return s && s.seenAt >= now()-3000 && !s.rip && s.hp !== 0 && hooks.realm(s)===saved.realm;
    });
    // Keep offline members in the durable obligation; include the leader even
    // if already home so remaining members have a valid convoy anchor.
    if (online.includes(party.leader) && online.some(name => !at(name,saved)) &&
        hooks.convoy(saved.returnLocation,'Resuming farming',online,'rare-hunt'))
      saved.convoyId = party.activeConvoy?.id;
    hooks.persist();
    return true;
  }
  function moving() {
    const saved=pending();
    return !!saved && names(saved).some(name => {
      const status=party.statuses[name];
      return status && status.seenAt >= now()-3000 && !at(name,saved);
    });
  }
  return { pending, tick, clear, moving };
};
