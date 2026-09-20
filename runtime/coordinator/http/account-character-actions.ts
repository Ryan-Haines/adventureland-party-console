import { createCharacterCreationRoutes } from "./character-creation.ts";
import { createBankboiDeleteRoute } from "./bankboi-delete.ts";

type AccountState = Parameters<typeof createCharacterCreationRoutes>[0] &
  Parameters<typeof createBankboiDeleteRoute>[0];
type CreationPorts = Parameters<typeof createCharacterCreationRoutes>[1];
interface AccountResponse {
  ok: boolean;
  statusText: string;
  json: () => Promise<unknown>;
}
type AccountFetch = (
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
) => Promise<AccountResponse>;
type AccountPorts = Omit<CreationPorts, "request" | "delay" | "includedSlots"> & {
  session: string | undefined;
  loadFetch: () => Promise<AccountFetch>;
  later: (callback: () => void, milliseconds: number) => unknown;
};

/** Account mutations use the same authenticated transport; route policies retain slot and storage guards. */
export function createCoordinatorAccountCharacterActions(state: AccountState, ports: AccountPorts) {
  async function request(method: string, body: Record<string, unknown>) {
    const fetch = await ports.loadFetch();
    const response = await fetch("https://adventure.land/api/" + method, {
      method: "POST",
      headers: {
        Cookie: "auth=" + ports.session,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, statusText: response.statusText, payload: await response.json() };
  }
  const creation = createCharacterCreationRoutes(state, {
    ...ports,
    includedSlots: 8,
    request: (name, characterClass, look) =>
      request("create_character", { name, char: characterClass, look }),
    delay: (milliseconds) => new Promise<void>((resolve) => ports.later(resolve, milliseconds)),
  });
  const deletion = createBankboiDeleteRoute(state, {
    now: () => ports.now(),
    owned: (name) => ports.owned(name),
    persist: () => ports.persistBank(),
    refresh: () => ports.refresh(),
    request: (name) => request("delete_character", { name }),
  });
  return { creation, deletion };
}
