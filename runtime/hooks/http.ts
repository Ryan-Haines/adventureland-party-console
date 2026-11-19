// The add-on switches and settings. The route sends each posted key, and the switch, as one
// addressed change to the settings writer, which checks it by the setting's declared kind and saves
// it. The add-on system hears the switch's change and sends `addon.off`; the coordinator sends the
// switches to every character with its status reply (runtime/status/coordinator/reply.ts `addons`),
// so turning one off takes effect on the next reply, with no restart or deploy.
import { requestObject, type HttpHandler, type HttpRequest, type HttpResponse } from "../lifecycle/api.ts";
import { partyHooks } from "./index.ts";
import type { SettingsChange, SettingsWrite, SettingsWriteResult } from "../settings/api.ts";
import { HOOKS, READS, type ReadName } from "./registry.ts";

interface AddonRoutePorts {
  write(batch: SettingsWrite): SettingsWriteResult;
  // The party's fighters, which a character setting lists (the settings install's port).
  fighters(): readonly string[];
  // Saves the settings document after an add-on command changed its scope store.
  persist(): void;
  now(): number;
}

export function createAddonRoutes(ports: AddonRoutePorts) {
  const hooks = partyHooks();
  hooks.attach({ side: "coordinator" });
  function list(_req: HttpRequest, res: HttpResponse): unknown {
    const map = hooks.map();
    return res.json({
      addons: map.registrations.filter(r => r.folder === "addons").map(r => ({ ...r, settings: Object.fromEntries(
        Object.entries(r.settings).map(([key, setting]) => [key, { ...setting, value: hooks.settings(r.name)[key],
          ...(setting.kind === "character" ? { choices: ports.fighters() } : {}),
          ...(setting.kind === "per-character" || (setting.kind as string) === "records" ? { characters: ports.fighters() } : {}) }])) })),
      // The target mode entries enabled add-ons add, for the PWA and the APK.
      targetModes: hooks.targetModes(),
      // Each slot's enabled entries in load order, each with its declared button and status, which
      // the dashboard, the PWA and the APK draw.
      slots: { 'combat-mode': hooks.entries('combat-mode'), 'target-mode': hooks.entries('target-mode'), 'combat-routine': hooks.entries('combat-routine'), formation: hooks.entries('formation'),
        'merchant-routine': hooks.entries('merchant-routine') },
      // The enabled add-ons' own rings, each a tab of the diagnostics view (12 D4's `diagnostics-ring`).
      rings: hooks.rings().map(({ ring, addon, label }) => ({ ring, addon, label })),
      // Each overlaid setting and the enabled add-on that answers it (settings.overlay), for the
      // dashboard's "Overlaid by" line beside the setting.
      overlays: hooks.overlays(),
      // Refused registrations and why, in plain words, for the dashboard notice.
      refusals: hooks.refusals(),
      // The published reads an add-on's dashboard asks (AddonSectionProps `read`), answered
      // by this registry: `passive.rule` for each monster of the game data. Only an enabled add-on's
      // section reads them, so with none enabled the reply asks nothing.
      reads: { 'passive.rule': map.registrations.some(r => r.folder === "addons" && r.enabled)
        ? Object.fromEntries(Object.keys(hooks.movement.gameMonsters() ?? {}).map(id => [id, hooks.ask('passive.rule', id)])) : {} },
      // The add-on character and party stores' values by store key and add-on. A scope store
      // is the scope's `addonFarming`, which the farming profile carries.
      stores: hooks.stores.book.values(),
    });
  }
  // GET /party-api/addon-read?name=&args=: one coordinator read an add-on may ask, with its
  // arguments as a JSON array. A row that is not `addonMayAsk` or not a READS row is refused.
  function read(req: HttpRequest, res: HttpResponse): unknown {
    const query = (req as { query?: Record<string, unknown> }).query ?? {}, name = String(query.name ?? "");
    const row = (HOOKS as Record<string, { addonMayAsk?: boolean }>)[name];
    if (!(row?.addonMayAsk === true || name in READS)) return res.status(404).json({ error: JSON.stringify(name) + " is not a read an add-on may ask" });
    let args: unknown;
    try { args = JSON.parse(String(query.args ?? "[]")); } catch { return res.status(400).json({ error: "args is not a JSON array" }); }
    if (!Array.isArray(args)) return res.status(400).json({ error: "args is not a JSON array" });
    try { return res.json({ value: hooks.askRow(name as ReadName, args) ?? null }); }
    catch (error) { return res.status(409).json({ error: String((error as Error)?.message ?? error) }); }
  }
  function save(req: HttpRequest, res: HttpResponse): unknown {
    const body = requestObject(req.body), name = String(body.name ?? "");
    const registration = hooks.registrations().find(r => r.name === name && r.folder === "addons");
    if (!registration) return res.status(404).json({ error: "No installed add-on named " + JSON.stringify(name) });
    // A per-character setting posts a map, one entry per fighter; each entry is its own change.
    const changes: SettingsChange[] = Object.entries(requestObject(body.settings)).flatMap(([key, value]) =>
      registration.settings?.[key]?.kind === "per-character"
        ? Object.entries(requestObject(value)).map(([character, choice]) => ({ field: "addons", addon: name, key, character, value: choice }))
        : [{ field: "addons", addon: name, key, value }]);
    if (typeof body.enabled === "boolean") changes.push({ field: "addons", addon: name, key: "enabled", value: body.enabled });
    // A switch turned on beside an add-on that is on and holds one of its one-answer hooks is refused
    // with the registry's load conflict words, and nothing is written.
    if (body.enabled === true && !hooks.enabled(name)) {
      const on = new Set(hooks.registrations().filter(r => r.folder === "addons" && hooks.enabled(r.name)).map(r => r.name));
      const held = hooks.switchProblem(name, on);
      if (held) return res.status(409).json({ error: held });
    }
    const written = ports.write({ changes, by: "dashboard:addons" });
    if (!written.ok) return res.status(400).json({ error: written.error });
    return res.json({ ok: true, name, enabled: hooks.enabled(name), settings: hooks.settings(name) });
  }
  // POST /party-api/addon-command {name, character?, body}: one enabled add-on's own command, which
  // its `addon.command` answers with its store for the character's farming scope. A card piece's
  // `send` and a section's `save` reach it, so an add-on with no target mode writes too.
  function command(scope: { addonFarming?: Record<string, Record<string, unknown>> }, owner: () => string): HttpHandler {
    return (req, res) => {
      const posted = requestObject(req.body), name = String(posted.name ?? "");
      // The `store` verb: a piece's `save(storeKey, patch)` writes one of the add-on's character
      // or party stores; it needs no command answer.
      if (posted.verb === "store") {
        if (!hooks.registrations().some(r => r.name === name && r.folder === "addons" && hooks.enabled(name)))
          return res.status(404).json({ error: "No enabled add-on named " + JSON.stringify(name) });
        const refused = hooks.stores.book.patch(name, String(posted.key ?? ""), requestObject(posted.patch));
        return refused ? res.status(400).json({ error: refused }) : res.json({ ok: true });
      }
      const handler = hooks.addonCommand(name);
      if (!handler) return res.status(404).json({ error: "No enabled add-on named " + JSON.stringify(name) + " takes commands" });
      const store = (scope.addonFarming ||= {})[name] ||= {};
      const result = handler({ owner: owner(), ...(typeof posted.character === "string" ? { character: posted.character } : {}),
        store, now: ports.now(), body: posted.body ?? null }, scope);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      ports.persist();
      return res.json({ ok: true, ...result.reply });
    };
  }
  return { list, save, command, read };
}
