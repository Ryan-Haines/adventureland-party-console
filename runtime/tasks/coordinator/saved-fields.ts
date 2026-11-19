// The saved fields of groups and tasks, its declarations for the settings owner, which
// builds its table from them at load (`settings.declare`).
// The registration's name is the tasks owner's core
// registration's (runtime/tasks/coordinator/install.ts `tasksRegistration`, `core:tasks`), as the settings owner's
// own fields sit beside its hooks.
import { object, mapOf, wholeFrom, type Declarations } from '../../settings/api.ts';
import { validHandControl, type HandControl } from '../rules.ts';

// The saved shape of the party's leader, followers and hand control, which the settings owner's start reads (initial.ts).
export interface SavedTaskSelections {
  leader?: string | null;
  followers?: Record<string, boolean> | null;
  handControlByCharacter?: Record<string, HandControl> | null;
}

export const tasksSavedFields = {
  name: 'core:tasks',
  settings: {
    // A change of either moves the members between groups (groups.ts, on `settings.changed`).
    leader: { label: 'Party leader', kind: 'character', default: null satisfies SavedTaskSelections['leader'], deliver: ['characters', 'dashboard'] },
    followers: { label: 'Follows the leader', kind: 'value', default: {} satisfies SavedTaskSelections['followers'], scope: 'character',
      check: value => object(value) && Object.values(value).every(v => typeof v === 'boolean'), refusal: 'invalid follower', deliver: ['dashboard'] },
    handControlByCharacter: { label: 'Hand control', kind: 'value', noOverlay: true, default: {} satisfies SavedTaskSelections['handControlByCharacter'],
      scope: 'character', importable: true, check: mapOf(validHandControl),
      refusal: 'handControl takes on, usePotions and combat as booleans and party as follows-me or carries-on', deliver: ['dashboard'] },
    // How long Resume stays locked after an escape, 5 s by the user's decision
    // (2026-10-28). holds.ts reads it at each Resume through its `lockoutMs` port.
    escapeResumeLockoutMs: { label: 'Resume lockout after an escape (ms)', kind: 'number', min: 0, default: 5_000, check: wholeFrom(0, Infinity) },
  },
  records: {
    // The saved manual task.
    manualTasks: { default: [] },
  },
} satisfies Declarations;
