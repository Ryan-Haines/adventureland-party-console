// C3's read answers for one side, from every owner's `READS` rows (rows/NN-*.ts). A row's `door` names
// `<file>#<export>`; the side's install hands the door modules it bundles (character-reads.ts,
// coordinator-reads.ts) and publishes the answers with `publishReads`, as character-doors.ts and the
// coordinator's install publish the action doors. A row whose type is `typeof <export>` answers the
// export itself; any other row calls a function export with the read's args and answers a constant
// as it is.
import { READS, type ReadRow } from './registry.ts';

type Side = 'character' | 'coordinator';
export type DoorModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
type Answer = (...args: readonly unknown[]) => unknown;

// `modules` maps each door file this side bundles to its module; `via` names the file that carries
// a row's export on this side when the row's own file is the other side's door.
export function readAnswers(side: Side, modules: DoorModules, via: Readonly<Record<string, string>> = {}):
  { answers: Record<string, Answer>; missing: string[] } {
  const answers: Record<string, Answer> = {}, missing: string[] = [];
  for (const [name, row] of Object.entries(READS) as [string, ReadRow][]) {
    if (row.side !== 'both' && row.side !== side) continue;
    const [file, exported] = row.door.split('#') as [string, string];
    const module = modules[via[file] ?? file];
    if (!module || !(exported in module)) { missing.push(`${name} (${row.door})`); continue; }
    // Each answer reads the export when asked, so a module's live binding answers its current value.
    answers[name] = (...args) => {
      const value = module[exported];
      return typeof value === 'function' && !row.type.startsWith('typeof ') ? (value as Answer)(...args) : value;
    };
  }
  return { answers, missing };
}
