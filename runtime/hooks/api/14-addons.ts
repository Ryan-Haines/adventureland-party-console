// Owner 14's published functions and types for add-ons: one re-export line each with its comment.
// Only 14's build writes this file, and runtime/hooks/addon-api.ts re-exports it.

// The registration and the slot entry it declares.
export type { Registration, SlotMode } from '../registry.ts';
// The handle of the add-on's own store on the coordinator.
export type { AddonStoreHandle } from '../store.ts';
// The context every add-on answer receives, and a hook row's side.
export type { AddonContext, HookSide } from '../registry.ts';
// The view of the add-on's own tick, and the `addon.command` answer that hands the body to the
// character's own answer.
export type { AddonForward, AddonTickView } from '../registry.ts';
// An action an add-on asks, its ticket and outcome, and an owner's ACTIONS row.
export type { Act, ActionAsk, ActionName, ActionOutcome, ActionRow, ActionTicket, CloseCode } from '../registry.ts';
// The one read call's type, its names and shapes, and an owner's READS row.
export type { Read, ReadAnswer, ReadArgs, ReadName, ReadRow } from '../registry.ts';
// The character, scope and party stores an add-on sees.
export type { AddonStores } from '../registry.ts';
// An add-on merchant job's steps and the `merchant.step` view and answer.
export type { MerchantStep, MerchantStepAnswer, MerchantStepView } from '../registry.ts';
