import type { Handoff } from "../roster/handoff.ts";

export function realmLabel(realm: string | null): string {
  return realm
    ? realm.replace(/^SR_/, "").replace(/^(US|EU|ASIA)/, "$1 ")
    : "waiting for observation";
}

/** One modal per pending operation; polling must never replace a user's focused button. */
export function createRealmChoice(
  document: Document,
  choose: (id: string, choice: string) => Promise<unknown>,
) {
  let dialog: HTMLDialogElement | null = null;
  let signature = "";
  function close() {
    dialog?.remove();
    dialog = null;
    signature = "";
  }
  function show(operation: Handoff | null) {
    if (operation?.phase !== "awaiting-realm-choice") {
      close();
      return;
    }
    const next = JSON.stringify([operation.id, operation.realmChoice]);
    if (next === signature) return;
    close();
    signature = next;
    const context = operation.realmChoice || { current: null, home: null };
    dialog = document.createElement("dialog");
    dialog.setAttribute("aria-label", "Choose Steam realm");
    dialog.style.cssText =
      "background:#151515;color:#fff;border:3px solid #aaa;padding:20px;max-width:480px;font:24px Pixel,monospace";
    const text = document.createElement("p");
    text.textContent = `You are currently on ${realmLabel(context.current)}, but your home realm is ${realmLabel(context.home)}. Switch now before logging in the next character?`;
    const error = document.createElement("p");
    error.style.color = "#ffcc77";
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:12px";
    let busy = false;
    async function submit(choice: string) {
      if (busy) return;
      busy = true;
      for (const button of controls.querySelectorAll("button")) button.disabled = true;
      try {
        await choose(operation!.id, choice);
        close();
      } catch (failure) {
        error.textContent = String(failure);
      } finally {
        busy = false;
        for (const button of controls.querySelectorAll("button")) button.disabled = false;
      }
    }
    for (const [label, choice] of [
      ["Switch", "switch"],
      ["Stay on this realm", "stay"],
    ]) {
      const button = document.createElement("button");
      button.textContent = label;
      button.style.cssText =
        "background:#242424;color:#fff;border:2px solid #aaa;padding:8px;font:inherit;cursor:pointer";
      button.onmouseenter = () => {
        button.style.backgroundColor = "#484848";
      };
      button.onmouseleave = () => {
        button.style.backgroundColor = "#242424";
      };
      button.disabled = !context.current || !context.home;
      button.onclick = () => {
        void submit(choice);
      };
      controls.append(button);
    }
    dialog.oncancel = (event) => {
      event.preventDefault();
      void submit("cancel");
    };
    dialog.append(text, controls, error);
    document.body.append(dialog);
    dialog.showModal();
  }
  return { show, dispose: close };
}
