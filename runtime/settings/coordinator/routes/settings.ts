// The settings route: the write path
// for every setting with no route of its own, and the list of every declared setting. A write
// answers as `settings.write` does, from the source `dashboard:settings`; a refused write changes
// nothing, a value a check refuses answers 400, and a value changed since the page's read answers
// 409 with the reason `out of date` and the field's current value.
import { requestObject, type HttpRequest, type HttpResponse } from "../../../lifecycle/api.ts";
import type { SlotName } from "../../../hooks/registry.ts";
import type { SettingsChange, SettingsRead, SettingsWrite, SettingsWriteResult } from "../../api.ts";
import { coordinatorSettings } from "../table.ts";
import { rangeOf } from "../../rules.ts";

interface SettingsRoutePorts {
  write(batch: SettingsWrite): SettingsWriteResult;
  read(query: SettingsRead): unknown;
  // A slot field's choices: the slot's entries that are registered and switched on now.
  entries(slot: SlotName): readonly string[];
  now(): number;
}

export function createSettingsRoutes(ports: SettingsRoutePorts) {
  // Each declared setting with its label, kind, choices, range (rules.ts `rangeOf`), declared
  // refusal, scope and value, and `settingsAt`, the time of this read, which a page sends back as
  // its `basis`. A secret setting's value stays on the coordinator. A hidden setting is not listed
  //.
  function list(_req: HttpRequest, res: HttpResponse): unknown {
    const settingsAt = ports.now();
    const settings = [...coordinatorSettings().table.fields.values()].flatMap(d => d.record || d.setting.hidden ? [] : [{
      field: d.field, label: d.setting.label, kind: d.setting.kind, scope: d.setting.scope ?? "account",
      ...(d.setting.slot ? { choices: ports.entries(d.setting.slot) } : d.setting.choices ? { choices: d.setting.choices } : {}), ...rangeOf(d.setting),
      ...(d.setting.refusal ? { refusal: d.setting.refusal } : {}),
      ...(d.setting.secret ? { secret: true } : { value: ports.read({ field: d.field }) }) }]);
    return res.json({ settingsAt, settings });
  }
  function save(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body);
    if (!Array.isArray(body.changes) || !body.changes.length) return res.status(400).json({ ok: false, error: "changes takes a list of {field, value, character?}" });
    if (body.basis !== undefined && !Number.isFinite(body.basis)) return res.status(400).json({ ok: false, error: "basis takes the settingsAt of the page's read" });
    const changes: SettingsChange[] = body.changes.map(entry => {
      const change = requestObject(entry);
      return { field: String(change.field ?? ""), value: change.value, ...(change.character !== undefined ? { character: String(change.character) } : {}) };
    });
    const written = ports.write({ changes, by: "dashboard:settings", ...(body.basis !== undefined ? { basis: Number(body.basis) } : {}) });
    return written.ok ? res.json(written) : res.status(written.reason === 'out of date' ? 409 : 400).json(written);
  }
  return { list, save };
}
