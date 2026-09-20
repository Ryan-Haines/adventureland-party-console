import type { BridgeReply } from "./bridge.ts";
import type { SteamAction } from "../roster/steam-group.ts";
import { orderCharacters } from "../roster/character-order.ts";
interface ViewHost { document: Document; localStorage?: Storage; character?: { name: string }; socket?: { connected: boolean }; }
const minimizedKey = "party-steam-minimized-v1";
const buttonStyle = "font:inherit;background:#242424;color:#fff;border:2px solid #888;border-radius:0;padding:3px 6px;cursor:pointer;box-shadow:inset -2px -2px #080808;line-height:20px";
export function createSwitcher(host: ViewHost, action: (name: string, action?: SteamAction | "headless-all") => Promise<unknown>) {
  const panel = host.document.createElement("section");
  panel.id = "party-console-switcher"; panel.setAttribute("aria-label", "Party Console Steam view"); host.document.body.append(panel);
  let minimized = host.localStorage?.getItem(minimizedKey) === "1";
  let minimizedPosition: { left: number; top: number } | null = null;
  let dialog: HTMLDialogElement | null = null, latest: BridgeReply | null = null, busy = false;
  function button(text: string, title: string, click: () => void) {
    const b = host.document.createElement("button"); b.textContent = text; b.title = title;
    b.setAttribute("aria-label", title); b.style.cssText = buttonStyle; b.onclick = click;
    b.onmouseenter = () => { b.style.backgroundColor = "#484848"; };
    b.onmouseleave = () => { b.style.backgroundColor = "#242424"; }; return b;
  }
  function close() { dialog?.remove(); dialog = null; }
  function popup(title: string, description: string, confirm?: () => void) {
    if (dialog) return;
    dialog = host.document.createElement("dialog");
    dialog.style.cssText = "background:#151515;color:#fff;border:4px solid #aaa;padding:16px;font:24px Pixel,monospace;max-width:440px";
    dialog.setAttribute("aria-label", title);
    const h = host.document.createElement("div"); h.textContent = title;
    const p = host.document.createElement("p"); p.textContent = description;
    const cancel = button(confirm ? "Cancel" : "OK", confirm ? "Cancel" : "OK", close);
    dialog.append(h, p, cancel);
    if (confirm) dialog.append(button("Confirm", "Confirm", () => { close(); confirm(); }));
    dialog.oncancel = close; host.document.body.append(dialog); dialog.showModal(); cancel.focus();
  }
  function request(name: string, kind: SteamAction) {
    if (busy || latest?.operation && latest.operation.phase !== "complete") return;
    const member = latest?.members.find(m => m.name === name); if (!member) return;
    if (kind === "login" && latest!.members.filter(m => m.hosting && m.hosting !== "offline").length >= 4) {
      popup("maximum characters logged in", ""); return;
    }
    const execute = () => {
      if (latest?.operation && latest.operation.phase !== "complete") return;
      if (latest?.members.find(m => m.name === name)?.hosting !== member.hosting) { popup("Character session changed", "Choose the action again."); return; }
      busy = true; render();
      void action(name, kind).catch(error => popup("Character operation failed", String(error))).finally(() => { busy = false; render(); });
    };
    if (kind === "login") { execute(); return; }
    popup(kind === "primary" ? `Make ${name} Steam Primary?` : kind === "headless" ? `Run ${name} headless?` : `Log out ${name}?`,
      kind === "primary" ? "Other Steam characters briefly reconnect, then continue in Steam. Other headless characters stay headless." :
      kind === "headless" ? "This character moves to caracAL. If primary, another Steam character becomes primary and the Steam group briefly reconnects." :
      "Stop this character and its routine. Removing the primary briefly reconnects the remaining Steam characters.", execute);
  }
  function render() {
    panel.replaceChildren();
    panel.style.cssText = `position:fixed;top:${minimized && minimizedPosition ? minimizedPosition.top - 3 : 8}px;left:${minimized && minimizedPosition ? minimizedPosition.left - 3 + "px" : "50%"};transform:${minimized && minimizedPosition ? "none" : "translateX(-50%)"};max-width:calc(100vw - 16px);z-index:999999;background:#111;color:#fff;border:3px solid #888;padding:${minimized ? "0" : "5px"};box-sizing:border-box;font:24px Pixel,monospace;line-height:24px`;
    const toggle = button("_", minimized ? "Restore Steam character controls" : "Minimize Steam character controls", () => {
      if (!minimized) { const bounds = toggle.getBoundingClientRect(); minimizedPosition = { left: bounds.left, top: bounds.top }; }
      minimized = !minimized; host.localStorage?.setItem(minimizedKey, minimized ? "1" : "0"); render();
    });
    if (minimized) { panel.append(toggle); return; }
    const header = host.document.createElement("div"); header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:20px";
    const title = host.document.createElement("span"); title.textContent = "Characters";
    const controls = host.document.createElement("div"); controls.style.cssText = "display:flex;gap:4px";
    const all = button("X", "Run all Steam characters headless", () => popup("Log out all characters from Steam and run on the headless device?",
      "Characters move one at a time, with Steam primary last. Wait for completion before closing Steam.", () => {
        busy = true; render();
        void action("", "headless-all").catch(error => popup("Headless handoff failed", String(error))).finally(() => { busy = false; render(); });
      }));
    all.disabled = busy || !latest?.members.some(member => member.hosting === "steam") || !!latest?.operation && latest.operation.phase !== "complete";
    controls.append(toggle, all); header.append(title, controls); panel.append(header);
    const list = host.document.createElement("div"); list.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;max-height:160px;overflow:auto";
    const pending = busy || !!latest?.operation && latest.operation.phase !== "complete";
    const members = latest?.members || [];
    const steam = members.filter(member => member.hosting === "steam").map(member => member.name);
    for (const member of orderCharacters(members, members, latest?.primary, null, steam)) {
      const hosting = member.hosting || (member.online ? "headless" : "offline");
      const primary = member.name === latest?.primary && hosting === "steam" && member.online;
      const row = host.document.createElement("div"); row.style.cssText = "display:flex;align-items:center;gap:4px;border:2px solid #555;padding:3px;background:#171717";
      const name = button(member.name, primary ? "This character has primary Steam control" : "Give this character primary Steam control", () => request(member.name, "primary"));
      name.style.color = !member.online ? "#888" : primary ? "#50ee50" : "#fff"; name.disabled = pending || primary || !member.online;
      const hostButton = button(hosting === "steam" ? "✓" : hosting === "headless" ? "H" : "□",
        hosting === "steam" ? `Run ${member.name} headless` : hosting === "headless" ? `Make ${member.name} Steam Primary` : "Offline",
        () => request(member.name, hosting === "steam" ? "headless" : "primary"));
      hostButton.style.color = hosting === "steam" ? "#50ee50" : "#fff"; hostButton.disabled = pending || hosting === "offline";
      const session = button(hosting === "offline" ? "↪" : "⏻", `${hosting === "offline" ? "Log in" : "Log out"} ${member.name}`,
        () => request(member.name, hosting === "offline" ? "login" : "logout"));
      session.disabled = pending; row.append(name, hostButton, session); list.append(row);
    }
    panel.append(list);
  }
  return { dispose() { close(); panel.remove(); }, render(reply: BridgeReply) { latest = reply; render(); } };
}
