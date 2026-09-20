import { requestObject, type HttpRequest, type HttpResponse } from "./contracts.ts";
import { createCharacterCreation, type CharacterCreationPorts } from "../characters/creation.ts";

interface CreationState {
  bankboiPrefix?: string;
  appearanceChoices?: Record<string, unknown> | null;
  headlessSlots: (string | null)[];
  bankbois: Record<string, unknown>;
}
interface CreationRoutePorts extends CharacterCreationPorts {
  now(): number;
  classes: readonly string[];
  includedSlots: number;
  characterCount(): number;
  assign(slot: number, name: string): void;
  persistBank(): void;
  serviceBank(): void;
  log(message: string, level: string, details?: unknown): void;
}

function appearance(body: Record<string, unknown>, available: unknown): number {
  return typeof body.look === "number" &&
    Number.isInteger(body.look) &&
    body.look >= 0 &&
    (!Array.isArray(available) || body.look < available.length)
    ? body.look
    : 0;
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createCharacterCreationRoutes(state: CreationState, ports: CreationRoutePorts) {
  const creation = createCharacterCreation(ports);
  let bankboiBusy = false;

  async function createOwned(
    name: string,
    characterClass: string,
    body: Record<string, unknown>,
    res: HttpResponse,
  ): Promise<unknown> {
    try {
      const result = await creation.create(
        name,
        characterClass,
        appearance(body, state.appearanceChoices?.[characterClass]),
      );
      if (!result.accepted) return res.status(502).json({ error: result.error });
      if (!result.confirmed)
        return res
          .status(502)
          .json({ error: "character was not returned by the account after creation" });
      const empty = state.headlessSlots.findIndex((entry) => !entry);
      if (empty >= 0) ports.assign(empty + 1, name);
      return res.json({ ok: true, character: name, slot: empty >= 0 ? empty + 1 : null });
    } catch (error) {
      return res.status(502).json({ error: errorMessage(error) });
    }
  }

  async function roster(req: HttpRequest, res: HttpResponse): Promise<unknown> {
    const body = requestObject(req.body),
      name = typeof body.name === "string" ? body.name.trim() : "";
    const characterClass = typeof body.class === "string" ? body.class : "";
    if (!/^[A-Za-z0-9_]{4,12}$/.test(name))
      return res.status(400).json({ error: "name must be 4-12 letters, numbers, or underscores" });
    if (!ports.classes.includes(characterClass))
      return res.status(400).json({ error: "invalid class" });
    if (ports.owned(name)) return res.status(409).json({ error: "character already exists" });
    // Never let this endpoint cross into paid character slots.
    if (ports.characterCount() >= ports.includedSlots)
      return res
        .status(409)
        .json({ error: "included character slots are full; no Shells were spent" });
    return createOwned(name, characterClass, body, res);
  }

  async function bankboi(_req: HttpRequest, res: HttpResponse): Promise<unknown> {
    if (!state.bankboiPrefix || !/^[A-Za-z0-9_]{3,11}$/.test(state.bankboiPrefix))
      return res.status(400).json({ error: "Set bankboi name in settings first" });
    if (bankboiBusy)
      return res.status(409).json({ error: "bankboi creation is already in progress" });
    if (ports.characterCount() >= ports.includedSlots)
      return res
        .status(409)
        .json({ error: "all eight free character slots are occupied; no Shells were spent" });
    bankboiBusy = true;
    ports.log("Creating the next available bankboi", "info");
    try {
      const name = await creation.bankboi(state.bankboiPrefix);
      state.bankbois[name] = {
        name,
        state: "provisioning",
        items: [],
        slots: {},
        gold: 0,
        createdAt: ports.now(),
      };
      ports.persistBank();
      ports.log("Created " + name + "; waiting to provision overflow storage", "success");
      ports.serviceBank();
      return res.json({ ok: true, bankboi: state.bankbois[name] });
    } catch (error) {
      ports.log("Bankboi creation failed", "error", errorMessage(error));
      return res.status(502).json({ error: errorMessage(error) });
    } finally {
      bankboiBusy = false;
    }
  }
  return { roster, bankboi };
}
