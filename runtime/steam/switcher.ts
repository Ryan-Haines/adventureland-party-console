import type { BridgeReply } from "./bridge.ts";
import type { SteamAction } from "../roster/steam-group.ts";
import { orderCharacters } from "../roster/character-order.ts";
/** Native js/functions.js audio flags and preference-saving controls. */
export interface NativeAudioHost {
  sound_sfx?: string | boolean;
  sound_music?: string | boolean;
  sfx_on?(): void;
  sfx_off?(): void;
  sound_on?(): void;
  sound_off?(): void;
}
interface ViewHost extends NativeAudioHost {
  call_code_function?: (name: string, ...args: unknown[]) => unknown;
  document: Document; localStorage?: Storage; character?: { name: string }; socket?: { connected: boolean }; }
const movementKey = "party-steam-ignore-movement-v1";
const minimizedKey = "party-steam-minimized-v1";
const buttonStyle = "font:inherit;background:#242424;color:#fff;border:2px solid #888;border-radius:0;padding:3px 6px;cursor:pointer;box-shadow:inset -2px -2px #080808;line-height:20px";
export function createSwitcher(host: ViewHost, action: (name: string, action?: SteamAction | "headless-all") => Promise<unknown>) {
  const panel = host.document.createElement("section");
  panel.id = "party-console-switcher"; panel.setAttribute("aria-label", "Party Console Steam view"); host.document.body.append(panel);
  let ignoreMovement = host.localStorage?.getItem(movementKey) === "1";
  // Native map_click asks CODE before emitting a move. Gate that exact hook,
  // preserving PIXI NPC/monster/chest selection and ordinary keyboard/CODE moves.
  const nativeCodeFunction = host.call_code_function;
  const gatedCodeFunction = function (this: unknown, name: string, ...args: unknown[]) {
    if (name === "on_map_click" && ignoreMovement) return true;
    return nativeCodeFunction?.apply(this, [name, ...args]);
  };
  if (nativeCodeFunction) host.call_code_function = gatedCodeFunction;
  function movementButton() {
    const control = button("", "Ignore movement clicks", () => {
      ignoreMovement = !ignoreMovement;
      host.localStorage?.setItem(movementKey, ignoreMovement ? "1" : "0");
      render();
    });
    control.disabled = !nativeCodeFunction;
    control.setAttribute("aria-pressed", String(ignoreMovement));
    control.title = ignoreMovement
      ? "Movement clicks ignored · click to allow"
      : "Movement clicks allowed · click to ignore";
    control.style.color = ignoreMovement ? "#ffaaaa" : "#70ee70";
    const svg = host.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("aria-hidden", "true");
    const path = host.document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", "M4 3 20 12 12 14 9 21Z" + (ignoreMovement ? " M2 2 22 22" : ""));
    svg.append(path);
    control.append(svg);
    return control;
  }
  let minimized = host.localStorage?.getItem(minimizedKey) === "1";
  let toggleControl:HTMLButtonElement|null=null;
  const observed=new Set<Element>();
  function layout(){
    const view=host.document.defaultView;if(!view || !toggleControl)return;
    const score=host.document.querySelector('#topmid'),native=host.document.querySelector('#toprightcorner .game-controls') || host.document.querySelector('#toprightcorner');
    for(const element of observed)if(element!==score&&element!==native){resize?.unobserve(element);observed.delete(element);}
    for(const element of [score,native])if(element&&!observed.has(element)){observed.add(element);resize?.observe(element);}
    const scoreBox=score?.getBoundingClientRect(),nativeBox=native?.getBoundingClientRect();
    const nativeVisible=nativeBox && nativeBox.width>0 && nativeBox.height>0;
    let right=nativeVisible?nativeBox.left-8:view.innerWidth-8,left=scoreBox&&scoreBox.width>0&&scoreBox.height>0?scoreBox.right+8:8,top=8;
    const toggleWidth=toggleControl.offsetWidth, toggleHeight=toggleControl.offsetHeight;
    // A narrow window cannot physically fit controls between the two native
    // surfaces. Use the next row while retaining the same right-hand anchor.
    if(right-left<toggleWidth+16){left=8;right=view.innerWidth-8;top=Math.max(nativeBox?.bottom || 0,scoreBox?.bottom || 0)+8;}
    panel.style.top=top+'px';panel.style.right=Math.max(8,view.innerWidth-right)+'px';panel.style.maxWidth=Math.max(toggleWidth+16,right-left)+'px';
    panel.style.width=minimized?toggleWidth+16+'px':'';panel.style.minHeight=toggleHeight+16+'px';panel.style.maxHeight=Math.max(60,view.innerHeight-top-8)+'px';
  }
  const resize=typeof ResizeObserver==='undefined'?null:new ResizeObserver(layout);
  const nativeMount=typeof MutationObserver==='undefined'?null:new MutationObserver(layout);
  nativeMount?.observe(host.document.body,{childList:true});
  host.document.defaultView?.addEventListener('resize',layout);
  let dialog: HTMLDialogElement | null = null, latest: BridgeReply | null = null, busy = false;
  let audioControls: (() => void)[] = [];
  // Native settings and CODE can change flags between roster replies. Refresh
  // only the buttons, preserving keyboard focus and character dialogs.
  const audioTimer = host.document.defaultView?.setInterval(() => audioControls.forEach((update) => update()), 250);
  function audioButton(music: boolean) {
    const label = music ? "mute game music" : "mute game sounds";
    const control = button("", label, () => {
      const enabled = music ? !!host.sound_music : !!host.sound_sfx;
      try {
        if (music) { if (enabled) host.sound_off?.(); else host.sound_on?.(); }
        else { if (enabled) host.sfx_off?.(); else host.sfx_on?.(); }
      }
      catch (error) { popup("Audio setting failed", String(error)); }
      audioControls.forEach((update) => update());
    });
    const svg = host.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("width", "22"); svg.setAttribute("height", "22");
    // The outer speaker wave extends past the viewport; keep its stroke inside
    // the button padding without clipping it at the SVG's right edge.
    if (!music) svg.style.cssText = "overflow:visible;transform:translateX(-3px)";
    svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round"); svg.setAttribute("stroke-linejoin", "round"); svg.setAttribute("aria-hidden", "true");
    const icon = host.document.createElementNS(svg.namespaceURI, "path");
    icon.setAttribute("d", music ? "M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3 M21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3" : "M11 5 6 9H2v6h4l5 4Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14 M21 2a14 14 0 0 1 0 20");
    const slash = host.document.createElementNS(svg.namespaceURI, "path"); slash.setAttribute("d", "M2 2 22 22");
    svg.append(icon, slash); control.append(svg);
    const update = () => {
      const muted = music ? !host.sound_music : !host.sound_sfx;
      control.setAttribute("aria-pressed", String(muted));
      control.title = `${music ? "Game music" : "Game sounds"}: ${muted ? "muted · click to unmute" : "on · click to mute"}`;
      control.style.color = muted ? "#ffaaaa" : "#70ee70";
      slash.setAttribute("visibility", muted ? "visible" : "hidden");
      control.disabled = music
        ? !(host.sound_on && host.sound_off)
        : !(host.sfx_on && host.sfx_off);
    };
    audioControls.push(update);
    update();
    return control;
  }
  function button(text: string, title: string, click: () => void) {
    const b = host.document.createElement("button");
    b.textContent = text;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.style.cssText = buttonStyle;
    b.onclick = click;
    b.onmouseenter = () => {
      b.style.backgroundColor = "#484848";
    };
    b.onmouseleave = () => {
      b.style.backgroundColor = "#242424";
    };
    return b;
  }
  function close() {
    dialog?.remove();
    dialog = null;
  }
  function popup(title: string, description: string, confirm?: () => void) {
    if (dialog) return;
    dialog = host.document.createElement("dialog");
    dialog.style.cssText =
      "background:#151515;color:#fff;border:4px solid #aaa;padding:16px;font:24px Pixel,monospace;max-width:440px";
    dialog.setAttribute("aria-label", title);
    const h = host.document.createElement("div");
    h.textContent = title;
    const p = host.document.createElement("p");
    p.textContent = description;
    const cancel = button(confirm ? "Cancel" : "OK", confirm ? "Cancel" : "OK", close);
    dialog.append(h, p, cancel);
    if (confirm)
      dialog.append(
        button("Confirm", "Confirm", () => {
          close();
          confirm();
        }),
      );
    dialog.oncancel = close;
    host.document.body.append(dialog);
    dialog.showModal();
    cancel.focus();
  }
  function request(name: string, kind: SteamAction) {
    if (busy || (latest?.operation && latest.operation.phase !== "complete")) return;
    const member = latest?.members.find((m) => m.name === name);
    if (!member) return;
    if (
      kind === "login" &&
      latest!.members.filter((m) => m.hosting && m.hosting !== "offline").length >= 4
    ) {
      popup("maximum characters logged in", "");
      return;
    }
    const execute = () => {
      if (latest?.operation && latest.operation.phase !== "complete") return;
      if (latest?.members.find((m) => m.name === name)?.hosting !== member.hosting) {
        popup("Character session changed", "Choose the action again.");
        return;
      }
      busy = true;
      render();
      void action(name, kind)
        .catch((error) => popup("Character operation failed", String(error)))
        .finally(() => {
          busy = false;
          render();
        });
    };
    if (kind === "login") {
      execute();
      return;
    }
    popup(
      kind === "primary"
        ? `Make ${name} Steam Primary?`
        : kind === "headless"
          ? `Run ${name} headless?`
          : `Log out ${name}?`,
      kind === "primary"
        ? "Other Steam characters briefly reconnect, then continue in Steam. Other headless characters stay headless."
        : kind === "headless"
          ? "This character moves to caracAL. If primary, another Steam character becomes primary and the Steam group briefly reconnects."
          : "Stop this character and its routine. Removing the primary briefly reconnects the remaining Steam characters.",
      execute,
    );
  }
  function render() {
    audioControls = [];
    panel.replaceChildren();
    panel.style.cssText = `position:fixed;top:8px;right:8px;max-width:calc(100vw - 16px);z-index:999999;background:#111;color:#fff;border:3px solid #888;padding:5px;box-sizing:border-box;font:24px Pixel,monospace;line-height:24px;overflow:auto`;
    const toggle = button(
      "_",
      minimized ? "Restore Steam character controls" : "Minimize Steam character controls",
      () => {
        minimized = !minimized;
        host.localStorage?.setItem(minimizedKey, minimized ? "1" : "0");
        render();
      },
    );
    toggleControl=toggle;toggle.style.position='absolute';toggle.style.top='5px';toggle.style.right='5px';
    panel.append(toggle);
    if (minimized) { layout(); return; }
    const header = host.document.createElement("div");
    header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-right:40px";
    const title = host.document.createElement("span");
    title.textContent = "Characters";
    const controls = host.document.createElement("div");
    controls.style.cssText = "display:flex;gap:4px";
    const all = button("X", "Run all Steam characters headless", () =>
      popup(
        "Log out all characters from Steam and run on the headless device?",
        "Characters move one at a time, with Steam primary last. Wait for completion before closing Steam.",
        () => {
          busy = true;
          render();
          void action("", "headless-all")
            .catch((error) => popup("Headless handoff failed", String(error)))
            .finally(() => {
              busy = false;
              render();
            });
        },
      ),
    );
    all.disabled =
      busy ||
      !latest?.members.some((member) => member.hosting === "steam") ||
      (!!latest?.operation && latest.operation.phase !== "complete");
    controls.append(movementButton(), audioButton(false), audioButton(true), all);
    header.append(title, controls);
    panel.append(header);
    const list = host.document.createElement("div");
    list.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;max-height:160px;overflow:auto";
    const pending = busy || (!!latest?.operation && latest.operation.phase !== "complete");
    const members = latest?.members || [];
    const steam = members
      .filter((member) => member.hosting === "steam")
      .map((member) => member.name);
    for (const member of orderCharacters(members, members, latest?.primary, null, steam)) {
      const hosting = member.hosting || (member.online ? "headless" : "offline");
      const primary = member.name === latest?.primary && hosting === "steam" && member.online;
      const row = host.document.createElement("div");
      row.style.cssText =
        "display:flex;align-items:center;gap:4px;border:2px solid #555;padding:3px;background:#171717";
      const name = button(
        member.name,
        primary
          ? "This character has primary Steam control"
          : "Give this character primary Steam control",
        () => request(member.name, "primary"),
      );
      name.style.color = !member.online ? "#888" : primary ? "#50ee50" : "#fff";
      name.disabled = pending || primary || !member.online;
      const hostButton = button(
        hosting === "steam" ? "✓" : hosting === "headless" ? "H" : "□",
        hosting === "steam"
          ? `Run ${member.name} headless`
          : hosting === "headless"
            ? `Make ${member.name} Steam Primary`
            : "Offline",
        () => request(member.name, hosting === "steam" ? "headless" : "primary"),
      );
      hostButton.style.color = hosting === "steam" ? "#50ee50" : "#fff";
      hostButton.disabled = pending || hosting === "offline";
      const session = button(
        hosting === "offline" ? "↪" : "⏻",
        `${hosting === "offline" ? "Log in" : "Log out"} ${member.name}`,
        () => request(member.name, hosting === "offline" ? "login" : "logout"),
      );
      session.disabled = pending;
      row.append(name, hostButton, session);
      list.append(row);
    }
    panel.append(list);
    layout();
  }
  return {
    dispose() {
      resize?.disconnect();nativeMount?.disconnect();observed.clear();host.document.defaultView?.removeEventListener('resize',layout);
      if (host.call_code_function === gatedCodeFunction)
        host.call_code_function = nativeCodeFunction;
      host.document.defaultView?.clearInterval(audioTimer);
      audioControls = [];
      close();
      panel.remove();
    },
    render(reply: BridgeReply) {
      latest = reply;
      render();
    },
  };
}
