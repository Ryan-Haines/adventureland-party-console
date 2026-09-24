import type { DungeonParty, DungeonState } from "../../dungeons/contracts.ts";

export function createPriestRecovery(party: DungeonParty, persist: () => void) {
  const observation = (name: string) => party.statuses[name]?.dungeon;
  function deaths(d: DungeonState) {
    d.recoveryDeaths ||= {};
    for (const name of d.participants) observeDeath(d, name);
    if (d.manualRecovery && d.participants.every((n) => observation(n)?.alive)) {
      d.manualRecovery = false;
      persist();
    }
  }
  function observeDeath(d: DungeonState, name: string) {
    const dead = observation(name)?.alive === false;
    const old = d.recoveryDeaths![name];
    if (old && old.dead === dead) return;
    d.recoveryDeaths![name] = { dead, generation: (old?.generation || 0) + (dead ? 1 : 0) };
    persist();
  }
  function eligible(d: DungeonState, target: string) {
    return d.participants
      .filter((name) => {
        const o = observation(name),
          status = party.statuses[name];
        return (
          o?.alive &&
          o.recovery?.actor.ctype === "priest" &&
          o.recovery.essence &&
          o.cave?.run === d.run &&
          status?.map === party.statuses[target]?.map
        );
      })
      .sort();
  }
  function choose(d: DungeonState) {
    const targets = d.participants.filter(
      (n) =>
        observation(n)?.cave?.run === d.run &&
        d.recoveryDeaths?.[n].dead &&
        !d.recoveryDeaths[n].attempted,
    );
    targets.sort(
      (a, b) =>
        Number(observation(b)?.recovery?.actor.ctype === "priest") -
          Number(observation(a)?.recovery?.actor.ctype === "priest") ||
        Number(b === d.participants[0]) - Number(a === d.participants[0]) ||
        a.localeCompare(b),
    );
    const target = targets.find((n) => eligible(d, n).length);
    if (!target) return;
    d.priestRecovery = {
      id: d.run + ":revive:" + target + ":" + d.recoveryDeaths![target].generation,
      run: d.run!,
      target,
      priest: eligible(d, target)[0],
      authorized: false,
    };
    persist();
  }
  function reconcile(d: DungeonState) {
    if (d.phase !== "active") return;
    if (d.priestRecovery && d.priestRecovery.run !== d.run) {
      delete d.priestRecovery;
      delete d.recoveryDeaths;
      d.manualRecovery = false;
      persist();
    }
    deaths(d);
    if (d.manualRecovery) return;
    const a = d.priestRecovery;
    if (!a) {
      choose(d);
      return;
    }
    if (observation(a.target)?.alive) {
      delete d.priestRecovery;
      persist();
      choose(d);
      return;
    }
    if (a.authorized) {
      advanceAfterAttempt(d);
      return;
    }
    prepare(d);
  }
  function advanceAfterAttempt(d: DungeonState) {
    const a = d.priestRecovery!;
    const report = observation(a.priest)?.recovery;
    if (report?.id === a.id && ["failed", "complete"].includes(report.phase)) choose(d);
  }
  function prepare(d: DungeonState) {
    const a = d.priestRecovery!;
    const report = observation(a.priest)?.recovery;
    if (!eligible(d, a.target).includes(a.priest)) {
      delete d.priestRecovery;
      persist();
      choose(d);
      return;
    }
    if (report?.id !== a.id || report.phase !== "ready" || observation(a.priest)?.cave?.paused)
      return;
    a.authorized = true;
    d.recoveryDeaths![a.target].attempted = true;
    persist(); // Durable authorization precedes delivery; never grant twice for this death.
  }
  function blocksNera(d: DungeonState) {
    if (d.participants.some((n) => !!observation(n)?.recovery?.actor.c?.revival)) return true;
    const a = d.priestRecovery;
    if (!a?.authorized) return false;
    const report = observation(a.priest)?.recovery;
    return report?.id !== a.id || !["failed", "complete"].includes(report.phase);
  }
  function manual(d: DungeonState) {
    if (blocksNera(d))
      throw Error("Priest revival is unresolved; wait for recovery or exit the dungeon");
    d.manualRecovery = true;
    delete d.priestRecovery;
    persist();
  }
  function control(d: DungeonState, name: string) {
    return d.phase === "active" && !d.manualRecovery && d.priestRecovery?.priest === name
      ? d.priestRecovery
      : undefined;
  }
  return { reconcile, manual, blocksNera, control };
}
