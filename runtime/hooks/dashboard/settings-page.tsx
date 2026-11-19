/** @jsxImportSource ../../../dashboard/features/party/addon-jsx */
"use client";
// The add-on manager: the installed add-ons, each with its title, its author, what it changes in
// player terms, its switch and its settings, read from the coordinator's registry
// (runtime/hooks/http.ts). A change takes effect on each character's next status reply, with no
// restart. It reaches React and the dashboard only through the kit, as an add-on section does, and
// reads the page's one add-on list (slots.tsx), which a save reloads for every reader.
import { performAction, useQueryClient, useState } from "../../../dashboard/features/party/addon-kit";
import { reloadAddons, useAddonSlots, type AddonListing, type AddonSettingListing } from "./slots";
import { addonTitle } from "./title";
import type { RecordField } from "../../settings/api";

const SELECT = "rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100", INPUT = "w-20 " + SELECT;

export function AddonSettings() {
  const list = useAddonSlots(), client = useQueryClient(), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  async function save(name: string, body: { enabled?: boolean; settings?: Record<string, unknown> }) {
    setBusy(true); setError("");
    try {
      await performAction(client, "/addons", { name, ...body });
      // The cards, the farming mode list and this page read the same list.
      reloadAddons(client);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  // One setting's control, by the settings owner's add-on kinds (runtime/settings/api.ts ADDON_KINDS).
  // A list of ids (`monsters`, `items`) is typed comma-separated; the writer checks each id.
  function control(addon: AddonListing, key: string, setting: AddonSettingListing) {
    const label = `${addon.name} ${setting.label}`, put = (value: unknown) => void save(addon.name, { settings: { [key]: value } });
    switch (setting.kind) {
      case "boolean":
        return <input type="checkbox" className="size-4 accent-violet-500" checked={setting.value === true} disabled={busy} aria-label={label}
          onChange={event => put(event.target.checked)} />;
      case "number":
        return <input type="number" className={INPUT} disabled={busy} min={setting.min} max={setting.max} aria-label={label} defaultValue={Number(setting.value)}
          onBlur={event => { const value = Number(event.target.value); if (Number.isFinite(value) && value !== setting.value) put(value); }} />;
      case "text":
        return <input type="text" className={SELECT} disabled={busy} aria-label={label} defaultValue={String(setting.value ?? "")}
          onBlur={event => { if (event.target.value !== setting.value) put(event.target.value); }} />;
      case "monsters": case "items":
        return <input type="text" className={SELECT} disabled={busy} aria-label={label} defaultValue={(setting.value as string[]).join(", ")}
          onBlur={event => put(event.target.value.split(",").map(id => id.trim()).filter(Boolean))} />;
      case "choice":
        return <select className={SELECT} value={String(setting.value ?? "")} disabled={busy} aria-label={label} onChange={event => put(event.target.value)}>
          {(setting.choices ?? []).map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>;
      case "character":
        return <select className={SELECT} value={String(setting.value ?? "")} disabled={busy} aria-label={label} onChange={event => put(event.target.value || null)}>
          <option value="">None</option>
          {(setting.choices ?? []).map(name => <option key={name} value={name}>{name}</option>)}
        </select>;
      case "per-character":
        // A character with no saved choice shows None, so the page shows only what the console holds.
        return <fieldset className="space-y-1"><legend className="text-slate-300">{setting.label}</legend>
          {(setting.characters ?? []).map(name => <label key={name} className="flex items-center gap-3">
            <span className="w-28 text-slate-400">{name}</span>
            <select className={SELECT} disabled={busy} aria-label={`${label} ${name}`} value={String((setting.value as Record<string, string> | null)?.[name] ?? "")}
              onChange={event => { if (event.target.value) put({ [name]: event.target.value }); }}>
              <option value="">None</option>
              {(setting.choices ?? []).map(choice => <option key={choice} value={choice}>{choice}</option>)}
            </select>
          </label>)}
        </fieldset>;
      case "records":
        return <RecordsTable label={label} setting={setting} busy={busy} put={put} />;
      default: {
        const kind: never = setting.kind;
        throw new Error(`The add-on manager draws no ${String(kind)} setting`);
      }
    }
  }
  const shown = error || list.error;
  return <section data-area="addon-manager" className="space-y-3 rounded border border-slate-600 bg-slate-950 p-4 text-sm text-slate-100" aria-label="Add-ons">
    <h3 className="font-semibold">Add-ons</h3>
    {list.refusals.map(refusal => <p key={refusal.name} role="alert" className="text-amber-200">Not loaded, {refusal.name}: {refusal.message}.</p>)}
    {list.loaded && !list.error && !list.addons.length ? <p className="text-slate-300">No add-ons are installed.</p> : null}
    {list.addons.map(addon => <div key={addon.name} className="space-y-2 rounded border border-slate-700 bg-slate-900 p-3" data-addon={addon.name}>
      <label className="flex items-center gap-3 font-semibold">
        <input type="checkbox" className="size-4 accent-violet-500" checked={addon.enabled} disabled={busy} aria-label={`${addon.name} on`}
          onChange={event => void save(addon.name, { enabled: event.target.checked })} />
        {addonTitle(addon.name)}<span className="font-normal text-slate-400">by {addon.author}</span>
      </label>
      <p className="text-slate-300">{addon.summary}</p>
      {Object.entries(addon.settings).map(([key, setting]) => setting.kind === "per-character" || setting.kind === "records"
        ? <div key={key}>{control(addon, key, setting)}</div>
        : <label key={key} className="flex items-center gap-3"><span className="w-28 text-slate-300">{setting.label}</span>{control(addon, key, setting)}</label>)}
    </div>)}
    {shown && <p role="alert" className="text-rose-300">{shown}</p>}
  </section>;
}

type Row = Record<string, unknown>;
// A new record's value for each field: the field's first choice, its least number, or empty.
function blank(field: RecordField): unknown {
  switch (field.kind) {
    case "boolean": return false;
    case "number": return field.min ?? 0;
    case "choice": return field.choices?.[0] ?? "";
    case "character": return null;
    case "monsters": case "items": return [];
    default: return "";
  }
}
// A `records` setting as a table: one row per record and one column per field, with add, remove
// and an edit of each cell. Every change saves the whole list, which the settings writer checks
// record by record (runtime/settings/rules.ts `accepts`). A `character` field picks from the
// listing's `characters` and takes a typed name when the listing sends none.
function RecordsTable({ label, setting, busy, put }: { label: string; setting: AddonSettingListing; busy: boolean; put(value: unknown): void }) {
  const fields = Object.entries(setting.fields ?? {}), rows = Array.isArray(setting.value) ? setting.value as Row[] : [];
  const edit = (index: number, key: string, value: unknown) => put(rows.map((row, at) => at === index ? { ...row, [key]: value } : row));
  function cell(row: Row, index: number, key: string, field: RecordField) {
    const name = `${label} ${index + 1} ${field.label}`, value = row[key];
    switch (field.kind) {
      case "boolean":
        return <input type="checkbox" className="size-4 accent-violet-500" checked={value === true} disabled={busy} aria-label={name} onChange={event => edit(index, key, event.target.checked)} />;
      case "number":
        return <input type="number" className={INPUT} disabled={busy} min={field.min} max={field.max} aria-label={name} defaultValue={Number(value ?? blank(field))}
          onBlur={event => { const next = Number(event.target.value); if (Number.isFinite(next) && next !== value) edit(index, key, next); }} />;
      case "choice": case "character": {
        const choices = field.kind === "choice" ? field.choices ?? [] : setting.characters;
        if (!choices) return <input type="text" className={SELECT} disabled={busy} aria-label={name} defaultValue={String(value ?? "")}
          onBlur={event => { if (event.target.value !== (value ?? "")) edit(index, key, event.target.value || null); }} />;
        return <select className={SELECT} value={String(value ?? "")} disabled={busy} aria-label={name} onChange={event => edit(index, key, event.target.value || null)}>
          {field.kind === "character" ? <option value="">None</option> : null}
          {choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}
        </select>;
      }
      case "monsters": case "items":
        return <input type="text" className={SELECT} disabled={busy} aria-label={name} defaultValue={((value ?? []) as string[]).join(", ")}
          onBlur={event => edit(index, key, event.target.value.split(",").map(id => id.trim()).filter(Boolean))} />;
      default:
        return <input type="text" className={SELECT} disabled={busy} aria-label={name} defaultValue={String(value ?? "")}
          onBlur={event => { if (event.target.value !== value) edit(index, key, event.target.value); }} />;
    }
  }
  // A row's key carries its values, so an uncontrolled cell redraws with the saved value after a remove.
  return <fieldset className="space-y-1"><legend className="text-slate-300">{setting.label}</legend>
    <table className="text-left"><thead><tr>{fields.map(([key, field]) => <th key={key} className="pr-3 font-normal text-slate-400">{field.label}</th>)}<th /></tr></thead>
      <tbody>{rows.map((row, index) => <tr key={index + " " + JSON.stringify(row)}>
        {fields.map(([key, field]) => <td key={key} className="pr-3 py-0.5">{cell(row, index, key, field)}</td>)}
        <td><button type="button" className={SELECT} disabled={busy} aria-label={`${label} ${index + 1} remove`} onClick={() => put(rows.filter((_, at) => at !== index))}>Remove</button></td>
      </tr>)}</tbody>
    </table>
    <button type="button" className={SELECT} disabled={busy} aria-label={`${label} add`}
      onClick={() => put([...rows, Object.fromEntries(fields.map(([key, field]) => [key, blank(field)]))])}>Add</button>
  </fieldset>;
}
