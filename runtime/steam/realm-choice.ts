import type { Handoff } from "../roster/handoff.ts";

export function realmLabel(realm: string | null): string {
  return realm
    ? realm.replace(/^SR_/, "").replace(/^(US|EU|ASIA)/, "$1 ")
    : "unknown";
}

function realmMessage(context: { current: string | null; home: string | null }): string {
  if (!context.current) return "Detecting which realm your Adventure Land client is connected to. Login will continue once the realm is confirmed.";
  if (!context.home) return `You're currently on ${realmLabel(context.current)}. Detecting your home realm before continuing login.`;
  if (context.current === context.home) return `You're on your home realm, ${realmLabel(context.current)}. Continuing login…`;
  return `You're currently on ${realmLabel(context.current)}. Your home realm is ${realmLabel(context.home)}. Choose which realm to use before logging in the next character.`;
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
    const known = !!context.current && !!context.home;
    text.textContent = realmMessage(context);
    const error = document.createElement("p");
    error.style.color = "#ffcc77";
    const controls = document.createElement("div");
    controls.style.cssText = "display:flex;gap:12px;flex-wrap:wrap";
    let busy = false;
    const submittedDialog = dialog;
    async function submit(choice: string) {
      if (busy) return;
      busy = true;
      for (const button of controls.querySelectorAll("button")) button.disabled = true;
      try {
        await choose(operation!.id, choice);
        if (dialog === submittedDialog) close();
      } catch (failure) {
        error.textContent = String(failure);
      } finally {
        busy = false;
        for (const button of controls.querySelectorAll("button")) button.disabled = false;
      }
    }
    const actions = known && context.current !== context.home ? [
      [`Switch to ${realmLabel(context.home)} realm`, "switch"],
      [`Stay on ${realmLabel(context.current)} realm`, "stay"],
    ] : [];
    actions.push(["Cancel login", "cancel"]);
    for (const [label, choice] of actions) {
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
