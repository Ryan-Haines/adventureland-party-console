// The survival owner's records and their rules, the leaf file both halves import (CF-S7): the
// character's survival ring, the party death recovery's record with its phase rule and views, the
// escape's reset and hold rules, the two heartbeat reply sections, and the card words for the survival owner's
// states. It imports no install, so the coordinator reads a phase or a label without loading the
// character half.
import { createMovementRing } from '../../protocol/records.ts';
import type { RecoveryFightRule, RecoveryView } from '../../hooks/registry.ts';
import { ESCAPE_SETTLED } from './lines.ts';

// The survival ring on the character (3.10): 64 entries in the shared ring shape (`part:
// 'survival'`, runtime/protocol/records.ts). It keeps what survival decided against or could not
// do: a spend the executor refused, a change of the character's verdict, a respawn `not-now` or
// refusal, and an escape stage change. A need that goes at once writes none. The ring lives in
// memory and is read on demand; the status owner's diagnostics table G (runtime/status/rules.ts) lists no survival
// ring yet.
export const SURVIVAL_RING_SIZE = 64;
export interface SurvivalRecord {
  part: 'survival'; decision: 'refused' | 'verdict' | 'respawn' | 'escape';
  skill?: string; reason?: string; verdict?: string; phase?: string | null; answer?: string; stage?: string | null;
}
export type SurvivalEntry = Omit<SurvivalRecord, 'part'>;
export function createSurvivalRing(now: () => number = () => Date.now()) {
  const ring = createMovementRing<SurvivalRecord>(now, SURVIVAL_RING_SIZE);
  return {
    record(entry: SurvivalEntry): void { ring.push({ part: 'survival', ...entry }); },
    entries: () => ring.entries(),
  };
}

// The party death recovery's record as the coordinator saves it and the report reply delivers it to
// each member (`combatRecovery`).
export interface RecoveryRecord { id: string; phase: string; reason: string; names: readonly string[]; targets?: readonly unknown[] }
// The phases in which the party death recovery still runs: every one but complete and cancelled.
export const recoveryRuns = (phase: string | undefined): boolean => !!phase && !['complete', 'cancelled'].includes(phase);
export function recoveryRunning<R extends RecoveryRecord>(r: R | null | undefined): r is R { return !!r && recoveryRuns(r.phase); }
// What the grouped fight keeps while the recovery runs (W2.2 `fightRule`, E04-s5): the candidates
// empty and retention paused; the evidence, threats and state only in `finishing` and
// `returning-to-farm`, and the queue, fights, target and selection with them; the fight's committed
// target in `finishing`.
export function fightRule(r: RecoveryRecord | null | undefined): RecoveryFightRule {
  const running = recoveryRunning(r);
  return { running, keepsObservations: !running || ['finishing', 'returning-to-farm'].includes(r.phase), keepsCommitted: running && r.phase === 'finishing' };
}
// `survival.recovery`'s answer (CF-S7) from one record: its phase, names, fight rule and the finishing
// list the targeting owner's A11 reads. The coordinator answers from the saved record, a member's realm from
// the record its report reply delivered. It runs nothing.
export function recoveryView(r: RecoveryRecord | null | undefined): RecoveryView | undefined {
  if (!r) return undefined;
  return { id: r.id, phase: r.phase, reason: r.reason, names: [...r.names], targets: [...(r.targets || [])], fight: fightRule(r), record: r };
}
// The Hunt's entry and restart end the party death recovery (the hunting owner's reset, b9b5c91e
// hunt/mode.ts:42 cleared the record there). 05 is the record's one writer.
export function endRecovery(state: { combatRecovery?: unknown }): void { state.combatRecovery = null; }
// The status owner's table R `combat-recovery` section: the party's recovery record and the member's last fight
// reset (`combatResetByCharacter`, the survival owner's delivered record), moved from status/coordinator/reply.ts.
export function recoveryReply(state: { combatRecovery?: unknown; combatResetByCharacter?: Record<string, number | undefined> | null }, name: string) {
  return { combatRecovery: state.combatRecovery, combatResetAt: state.combatResetByCharacter?.[name] || 0 };
}

// The stages in which a member's own respawn recovery still runs.
export const respawnRuns = (stage: string | undefined): boolean => !!stage && !['recovery-complete', 'recovery-cancelled'].includes(stage);

// The stages in which the escaping character walks or holds alone: b9b5c91e shared.js `applyEscape`
// lists recovering, complete and failed-hold, and `home` is A39's stage. A change into one ends the
// character's other travel, as a new escape does.
const ALONE = ['recovering', 'complete', 'failed-hold', 'home'];
// Whether the reply's escape ends the character's other travel and target now: a new escape, or a
// stage change into one where the character walks or holds alone.
export function escapeResets(old: { id: string; stage: string } | null, next: { id: string; stage: string }): boolean {
  return !old || old.id !== next.id || old.stage !== next.stage && ALONE.includes(next.stage);
}
// The same moment as `survival.escapeMember` names it: the character joined an escape, or its stage
// changed into one where it walks or holds alone.
export function escapeMemberResets(notice: Record<string, unknown>): boolean {
  return notice.change === 'joined' || notice.change === 'stage' && ALONE.includes(String(notice.stage));
}
// Whether the escape holds the party until the player's Resume: it stands in a settled stage.
export const escapeHolds = (stage: string | null | undefined): boolean => (ESCAPE_SETTLED as readonly string[]).includes(String(stage));
// The status owner's table R `escape` section: the party's escape record for a character the escape owns (the survival owner's
// `survival.escaping`), else null, moved from status/coordinator/reply.ts.
export function escapeReply(state: { escape?: unknown }, owns: boolean) { return { escape: owns ? state.escape : null }; }

// The card line's words for the survival owner's states. They are the build's words: b9b5c91e's card named no escape
// or death state. `climbs` marks a line that the movement owner's climber replaces while it serves the walk.
export function escapeLabel(stage: string, trying?: string | null): { label: string; climbs: boolean } {
  switch (stage) {
    case 'warrior': return { label: 'Escaping - warrior holding the attackers', climbs: false };
    case 'priest': return { label: 'Escaping - priest healing the party out', climbs: false };
    case 'blink': return { label: 'Escaping - mage blinking the party out', climbs: false };
    case 'complete': return { label: 'Escape - landed', climbs: false };
    case 'recovery-convoy': return { label: 'Regrouping after escape - walking the party home', climbs: false };
    case 'home': return { label: 'Home after escape', climbs: false };
    case 'failed-hold': return { label: 'Escape held - waiting for you', climbs: false };
    default: return { label: trying ? `Regrouping after escape - ${trying}` : 'Regrouping after escape', climbs: true };
  }
}
// The escape task's line while the survival owner's `survival.escaping` answers nothing for the character.
export const ESCAPE_TASK_LABEL = 'Escaping';
export const DEAD_LABEL = 'Dead - waiting to respawn';
// A party death recovery's phase, with the farm it returns to; null for a phase the card does not name.
export function partyDeathLabel(phase: string, farm: string | undefined): string | null {
  switch (phase) {
    case 'escaping': return 'Party death - escaping';
    case 'finishing': return 'Party death - finishing the fight';
    case 'recovering': return 'Party death - regrouping at Main';
    case 'returning-to-farm': return farm ? `Party death - Travelling to farm - ${farm}` : 'Party death - Travelling to farm';
    default: return null;
  }
}
export function respawnLabel(phase: string, trying?: string | null): string {
  if (phase === 'respawn') return 'Respawning';
  return trying ? `Back after death - ${trying}` : 'Back after death - asking the group what to do';
}
