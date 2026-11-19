import { eventKey, eventKinds, validEventLimits, type EventLimits } from "../../../events/api.ts";
import { requestObject, requestText, type HttpRequest, type HttpResponse } from "../../../lifecycle/api.ts";
import type { SettingsWrite, SettingsWriteResult, SettingsChange } from "../../api.ts";
import { HAND_CONTROL_DEFAULT, type HandControl } from "../../../tasks/api.ts";

interface FormationState {
  leader: string | null;
  merchantCharacter: string | null;
  followers: Record<string, boolean>;
  eventsByCharacter: Record<string, boolean>;
  eventLimitsByCharacter: Record<string, Record<string, EventLimits>>;
  eventPrioritiesByCharacter: Record<string, string[]>;
  eventSelectionsByCharacter: Record<string, string[]>;
  handControlByCharacter: Record<string, HandControl>;
}
// `inherited` and `selected` read the request's own view, so a request that turns Follow off and
// sets the character's events in one batch reads its new Follow.
interface FormationPorts {
  managed(name: string): boolean;
  owned(name: string): unknown;
  inherited(name: string, formation: FormationState): boolean;
  selected(name: string, formation: FormationState): string[];
  write(batch: SettingsWrite): SettingsWriteResult;
}
// The fields one formation request may change, in the order its batch names them.
const characterFields = ["followers", "eventsByCharacter", "eventSelectionsByCharacter", "eventPrioritiesByCharacter",
  "eventLimitsByCharacter", "handControlByCharacter"] as const;
interface FormationError {
  code: number;
  error: string;
}

// The route builds the request's changes on a copy of the formation (`draft`), then writes them as
// one batch through the settings writer, so a request
// with one bad field changes nothing. The writer checks each value by its declaration and
// answers the declaration's own words, so the route checks only what the request
// says: the character, the events' ids and the leader-events rule.
export function createFormationRoute(state: FormationState, ports: FormationPorts) {
  // The events' ids, the order and the October rows are the events owner's (`events.kinds()`, `events.key()`).
  const known = (id: unknown): boolean => eventKey(id) !== null;
  function selections(draft: FormationState, name: string, value: unknown): FormationError | null {
    if (!Array.isArray(value) || value.some((id) => !known(id)))
      return { code: 400, error: "invalid event selections" };
    if (ports.inherited(name, draft)) return { code: 409, error: "using leader events" };
    draft.eventSelectionsByCharacter[name] = [...new Set(value as string[])];
    return null;
  }
  function legacyEvents(draft: FormationState, name: string, value: unknown): FormationError | null {
    draft.eventsByCharacter[name] = value as boolean;
    draft.eventSelectionsByCharacter[name] = [
      ...(ports.selected(name, draft).includes("anniversary") ? ["anniversary"] : []),
      ...(value ? eventKinds().filter((kind) => kind.name !== "anniversary").map((kind) => kind.name) : []),
    ];
    return null;
  }
  /** A complete order, or the order of a client built before the October rows with them appended. */
  function completeOrder(value: unknown): string[] | null {
    if (!Array.isArray(value) || new Set(value).size !== value.length) return null;
    const ids = value.filter((id): id is string => known(id));
    const required = eventKinds().filter(kind => kind.added !== "october").map(kind => kind.name);
    if (ids.length !== value.length || required.some(id => !ids.includes(id))) return null;
    return [...ids, ...eventKinds().map(kind => kind.name).filter(id => !ids.includes(id))];
  }
  function priorities(draft: FormationState, name: string, value: unknown): FormationError | null {
    const order = completeOrder(value);
    if (!order) return { code: 400, error: "invalid event priorities" };
    if (ports.inherited(name, draft)) return { code: 409, error: "using leader events" };
    draft.eventPrioritiesByCharacter[name] = order;
    return null;
  }
  function limits(draft: FormationState, name: string, value: unknown): FormationError | null {
    const patch = requestObject(value);
    if (!known(requestText(patch.event)) || !validEventLimits(patch.limits))
      return { code: 400, error: "invalid event limits" };
    if (ports.inherited(name, draft)) return { code: 409, error: "using leader events" };
    draft.eventLimitsByCharacter[name] = { ...draft.eventLimitsByCharacter[name], [requestText(patch.event)]: structuredClone(patch.limits) };
    return null;
  }
  function settings(draft: FormationState, name: string, body: Record<string, unknown>): FormationError | null {
    if (body.eventLimits !== undefined) {
      const error = limits(draft, name, body.eventLimits);
      if (error) return error;
    }
    if (body.eventPriorities !== undefined) {
      const error = priorities(draft, name, body.eventPriorities);
      if (error) return error;
    }
    if (body.handControl !== undefined) {
      const next = { ...HAND_CONTROL_DEFAULT, ...draft.handControlByCharacter[name], ...requestObject(body.handControl) } as HandControl;
      draft.handControlByCharacter[name] = { on: next.on, usePotions: next.usePotions, combat: next.combat, party: next.party };
    }
    return body.eventSelections !== undefined ? selections(draft, name, body.eventSelections) : null;
  }
  function character(draft: FormationState, body: Record<string, unknown>): FormationError | null {
    const name = requestText(body.character);
    if (!ports.owned(name)) return { code: 400, error: "invalid character" };
    if (body.follow !== undefined) {
      draft.followers[name] = body.follow as boolean;
    }
    const error = settings(draft, name, body);
    if (error) return error;
    return body.events !== undefined ? legacyEvents(draft, name, body.events) : null;
  }
  // The changes the draft holds: the leader, then the request's character's entries.
  function changes(draft: FormationState, name: string): SettingsChange[] {
    const out: SettingsChange[] = draft.leader !== state.leader ? [{ field: "leader", value: draft.leader }] : [];
    for (const field of characterFields)
      if (draft[field][name] !== state[field][name]) out.push({ field, character: name, value: draft[field][name] });
    return out;
  }
  return function formation(req: HttpRequest, res: HttpResponse): unknown {
    const draft = { leader: state.leader, merchantCharacter: state.merchantCharacter,
      ...Object.fromEntries(characterFields.map(field => [field, { ...state[field] }])) } as FormationState;
    const body = requestObject(req.body);
    if (body.leader !== undefined) {
      if (body.leader !== null && !ports.managed(requestText(body.leader)))
        return res.status(400).json({ error: "unknown leader" });
      draft.leader = body.leader === null ? null : requestText(body.leader);
    }
    const error = body.character !== undefined ? character(draft, body) : null;
    if (error) return res.status(error.code).json({ error: error.error });
    const written = ports.write({ changes: changes(draft, requestText(body.character)), by: "dashboard:formation" });
    // 01 moves the members on the writer's `settings.changed` for `leader` and `followers`
    // (runtime/tasks/coordinator/install.ts tasksRegistration, `core:tasks`), so a refused request moves nobody.
    if (!written.ok) return res.status(400).json({ error: written.error });
    return res.json({
      ok: true,
      leader: state.leader,
      followers: state.followers,
      eventsByCharacter: state.eventsByCharacter,
      eventLimitsByCharacter: state.eventLimitsByCharacter,
      eventPrioritiesByCharacter: state.eventPrioritiesByCharacter,
      eventSelectionsByCharacter: state.eventSelectionsByCharacter,
      handControlByCharacter: state.handControlByCharacter,
    });
  };
}
