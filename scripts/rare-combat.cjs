// Bridge rare navigation/support to the shared combat authority.
function createRareCombat(party, members, realm) {
  const combatRealm = server => {
    const status = Object.values(party.statuses).find(s => s.server === server);
    return status ? realm(status) : null;
  };
  const same = (fight, target) => !!fight && fight.id === target.id && fight.map === target.map &&
    String(fight.in ?? fight.map) === String(target.in) && combatRealm(fight.server) === target.realm;
  const grouped = () => party.partyFarmingMode !== 'scatter' && members().length > 1 &&
    members().some(name => party.statuses[name]?.groupedCombat?.protocol === 4);
  const target = () => party.groupedCombat?.target;
  return {
    grouped,
    selected: sight => same(target(), sight),
    locked: sight => !!party.groupedCombat?.fights?.some(f => same(f, sight)),
    engaged: sight => !!party.groupedCombat?.fights?.some(f => same(f, sight) && f.state === 'engaged'),
    busy: () => !!party.groupedCombat?.fights?.length,
    killed: sight => !!party.groupedCombat?.deaths?.some(d => same(d, sight)),
    claimed: sight => !!party.groupedCombat?.claims?.some(c => same(c,sight) && c.external),
    release(sight, until, rejectedAt = Date.now()) {
      const g=party.groupedCombat;
      if (!g) return;
      const target={...sight,server:Object.values(party.statuses).find(s=>realm(s)===sight.realm)?.server,until,rejectedAt,expiresAt:rejectedAt+120000};
      g.rareRejections=[...(g.rareRejections||[]).filter(t=>!same(t,sight)),target];
      g.evidence=(g.evidence||[]).filter(t=>!same(t,sight)||t.state==='engaged');
      g.fights=(g.fights||[]).filter(t=>!same(t,sight)||t.state==='engaged');
      g.queue=(g.queue||[]).filter(t=>!same(t,sight)||t.state==='engaged');
      g.target=g.queue[0]||null;
      g.committed=false;g.selection=null;
    },
    current() {
      const t = target();
      if (!t) return null;
      return {...t, realm:combatRealm(t.server), in:String(t.in ?? t.map), hp:1,
        reporter:party.leader, seenAt:party.groupedCombat.seenAt};
    },
  };
}
module.exports = createRareCombat;
