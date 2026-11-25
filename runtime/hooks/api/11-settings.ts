// Owner 11's published functions and types for add-ons: one re-export line each with its comment.
// Only 11's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// The settings write an add-on's ports make, its result, a read and a declared setting.
export type { SettingsChange, SettingsWrite, SettingsWriteResult, SettingsRead, Setting } from '../../settings/api.ts';
// The building blocks of a declared setting's `check`.
export { object, list, text, number, boolean, mapOf, listOf, item, mark, positive, wholeFrom, type ObjectValue } from '../../settings/api.ts';
