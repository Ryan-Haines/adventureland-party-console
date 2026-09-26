import type {Group} from './grouped.ts';
type Selection = Pick<Group, 'selection' | 'committed' | 'target' | 'handoffTiming'>;
/** Bounded local-clock evidence. Coordinator timestamps are correlation only. */
export function createHandoffTiming(entries: Record<string, unknown>[], now = Date.now) {
  let selection: string | null = null, target: string | null = null, accepted = false;
  let lastBlock = '', attempted = false, committed = false;
  const deaths = new Set<string>();
  let reportAt=-Infinity,responseAt=-Infinity;
  function record(stage: string, details: Record<string, unknown>) {
    entries.push({at: now(), stage, ...details});
    if (entries.length > 256) entries.splice(0, entries.length - 256);
  }
  function select(group: Selection | null) {
    selection = group?.selection ?? null; target = group?.target?.id ?? null;
    accepted = false; attempted = false; committed = false; lastBlock = '';
    record('selection', {target, selection, committed: !!group?.committed, coordinator: group?.handoffTiming});
  }
  return {
    event: record,
    death(id: string) {
      if (deaths.has(id)) return;
      deaths.add(id);
      if (deaths.size > 128) deaths.delete(deaths.values().next().value!);
      record('death', {target: id});
    },
    report(details: Record<string, unknown>) { if(now()-reportAt>=1000){reportAt=now();record('report', details);} },
    response(details: Record<string, unknown>) { if(now()-responseAt>=1000){responseAt=now();record('response', details);} },
    selection(group: Selection | null) {
      const next = group?.selection ?? null;
      if (next !== selection) {
        select(group);
      }
      if (!accepted && group?.committed && !committed) {
        committed = true;
        record('committed', {target, selection, coordinator: group.handoffTiming});
      }
    },
    attack(stage: string, id: string, details: Record<string, unknown>) {
      if (accepted || id !== target) return;
      if (stage === 'attempt' && attempted) return;
      if (stage === 'attempt') attempted = true;
      if (stage === 'blocked') {
        const reason = String(details.reason);
        if (reason === lastBlock) return;
        lastBlock = reason;
      }
      record(stage, {target, selection, ...details});
      if (stage === 'accepted') accepted = true;
    },
  };
}
