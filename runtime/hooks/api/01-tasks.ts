// Owner 01's published functions and types for add-ons: one re-export line each with its comment.
// Only 01's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// What a `task.request` answer asks for.
export type { AddonTaskAsk } from '../registry.ts';
// The groups and tasks owner's published types, from runtime/tasks/api.ts. The view a `target.mode`
// or `target.settings` call gets for one farming scope.
export type { TargetModeView } from '../../tasks/api.ts';
// The ports that view carries: the scope's members, `busy`, a destination, the select and the write.
export type { TargetModePorts } from '../../tasks/api.ts';
// A member's assignment, as `task.request` and the heartbeat carry it.
export type { Assignment } from '../../tasks/api.ts';
// A group's status line, as `status.changed` carries it.
export type { GroupStatus } from '../../tasks/api.ts';
// A task's kind and the code it ends with, as the task notices carry them.
export type { TaskKind, EndCode } from '../../tasks/api.ts';
