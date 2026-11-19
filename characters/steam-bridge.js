// Generated from TypeScript; run npm run build:runtime -- --publish. Do not edit.
"use strict";
(() => {
  // runtime/settings/rules.ts
  var ADDON_KINDS = ["character", "boolean", "choice", "number", "per-character", "text", "monsters", "items", "records"];
  var SETTING_KINDS = [...ADDON_KINDS, "value"];
  var object = (value) => !!value && typeof value === "object" && !Array.isArray(value);

  // runtime/settings/api.ts
  var list = (value) => Array.isArray(value);
  var text = (value) => typeof value === "string";
  var number = (value) => typeof value === "number" && Number.isFinite(value);
  var boolean = (value) => typeof value === "boolean";
  var mapOf = (check) => (value) => object(value) && Object.values(value).every(check);
  var listOf = (check) => (value) => list(value) && value.every(check);
  var item = (value) => object(value) && text(value.name);
  var mark = (value) => object(value) && (item(value.item) || item(value));
  var positive = (value) => number(value) && Number(value) > 0;
  var wholeFrom = (min, max) => Object.assign(
    (value) => Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max,
    { range: { min, max } }
  );

  // runtime/protocol/reports.ts
  var MERCHANT_HOME_REPORT_MS = 15e3;
  var REALM_VIEW_REPORT_MS = 15e3;
  var REPORT_AGE_DEFAULTS = { reportFreshMs: 3e3, reportPresenceMs: 1e4, reportRecentMs: 5e3, errandTargetReportMs: 15e3 };
  var ageCheck = wholeFrom(1, Infinity);
  var ages = {
    ...REPORT_AGE_DEFAULTS,
    merchantHomeReportMs: MERCHANT_HOME_REPORT_MS,
    realmViewReportMs: REALM_VIEW_REPORT_MS
  };
  var GAME_POSITION_STEP = 70;
  var SEND_REACH = 400 - GAME_POSITION_STEP;

  // runtime/lifecycle/rules.ts
  var job = (label, combat = label) => ({ owner: "08", merchant: true, job: label, combat });
  var TABLE_I = {
    "party-monster-travel:event-walk-release": { owner: "02", walk: "farm", own: true },
    "party-monster-travel:defending": { owner: "02", walk: "farm", own: true },
    "merchant-production-recover": { owner: "10", own: true },
    "merchant-mluck": job("refreshing Merchant's Luck"),
    "merchant-service": job("merchant service"),
    "merchant-self-improve": job("merchant upgrades and compounds"),
    "merchant-self-bank": job("merchant bank exchange"),
    "merchant-bank-unlock": job("bank unlock", "unlocking bank storage"),
    "merchant-deconstruct": job("merchant deconstruction"),
    "merchant-npc-sale": job("merchant NPC sale"),
    "merchant-donate": job("merchant donation"),
    "merchant-self-restock": job("merchant potion restock"),
    "merchant-upgrade-preview": { owner: "10", merchant: true, job: "upgrade preview" },
    "merchant-commerce": job("merchant shopping and crafting"),
    "merchant-exchange": job("merchant exchange"),
    "merchant-stand-search": job("stand search"),
    "merchant-join-giveaway": job("joining giveaway"),
    // C2: an add-on merchant job, held like the core kinds.
    "addon-steps": job("add-on merchant job"),
    "merchant-stand-buy": job("stand purchase"),
    "merchant-ponty-buy": job("Ponty purchase"),
    "merchant-aldata-auth": job("ALData authentication"),
    "merchant-aldata-buy": job("ALData marketplace purchase"),
    "merchant-aldata-sell": job("ALData marketplace sale"),
    "merchant-collect-mail": job("collecting mail attachment"),
    "merchant-send-mail": job((command) => "sending mail to " + (command.mail?.recipient || "recipient"), "sending mail"),
    "merchant-stand-sync": { owner: "08", merchant: true, job: "stand inventory sync" },
    "merchant-idle": { owner: "08", merchant: true },
    "bankboi-service": { owner: "10", merchant: true },
    "merchant-gather": { owner: "08", merchant: true },
    "merchant-handoff": { owner: "08" },
    "merchant-order-handoff": { owner: "08", combat: "merchant material handoff" },
    "restore-equipment": { owner: "10" },
    "apply-stat-scrolls": { owner: "10", combat: "applying stat scrolls" },
    "monster-hunt-interact": {
      owner: "07",
      retry: true,
      combat: (command) => command.action === "claim" ? "claiming Monster Hunt" : "accepting Monster Hunt"
    },
    bank: { owner: "10", combat: "banking" },
    upgrade: { owner: "10", combat: "upgrading" },
    travel: { owner: "02", location: true, walk: "defensive" },
    "force-travel": { owner: "02", location: true, walk: "farm" },
    "town-party": { owner: "02", retry: true },
    "event-return-town": { owner: "06", retry: true },
    "character-travel": { owner: "02", location: true, walk: "defensive", combat: "travel" },
    "party-monster-travel": { owner: "02", location: true, walk: "farm" },
    "event-resume-travel": { owner: "06", location: true, walk: "farm", retry: true },
    "return-leader": { owner: "02", walk: "defensive", combat: "returning to leader" },
    "use-item": { owner: "10" },
    equip: { owner: "10" },
    "equip-deliveries": { owner: "08" },
    unequip: { owner: "10" },
    give: { owner: "10" },
    "native-switch": { owner: "13" },
    "native-realm-switch": { owner: "08" },
    "realm-set-home": { owner: "08" }
  };
  var CHARACTER_NAME_MIN = 4;
  var CHARACTER_NAME_MAX = 12;
  var CHARACTER_NAME_REFUSAL = `name must be ${CHARACTER_NAME_MIN}-${CHARACTER_NAME_MAX} letters, numbers, or underscores, not only numbers`;
  var NAME_PATTERN = new RegExp(`^[A-Za-z0-9_]{${CHARACTER_NAME_MIN},${CHARACTER_NAME_MAX}}$`);
  var MAX_LOGGED_IN = 4;
  var BRIDGE_MULTI_VERSION = 2;
  var codeStoppedKey = (name) => "party-code-stopped:" + name;
  function codeStopped(storage, name) {
    return storage.getItem(codeStoppedKey(String(name))) === "1";
  }

  // runtime/lifecycle/fields.ts
  var lifecycleSavedFields = {
    name: "core:lifecycle",
    settings: {
      // How long the automatic resume after a clean shutdown waits for the characters running at
      // the Pause to connect (coordinator/control.ts). 180 s is the fork's wait (default,
      // unconfirmed).
      consoleResumeWaitMs: { label: "Resume wait after a clean shutdown (ms)", kind: "number", min: 0, default: 18e4, check: wholeFrom(0, Infinity) },
      // The host's forced exit after SIGTERM (tools/hosting/start.mts): nothing in the game or the run
      // ends a stop that hangs. The supervisor's own deadline, compose's `stop_grace_period: 30s`, stays
      // in compose.yaml and reaches no process in the container, so the host has no setting to read. The
      // prepared shutdown's worker wait ends this long after the stop, less the measured storage close.
      hostExitGraceMs: { label: "Host forced exit after a stop (ms)", kind: "number", min: 1, default: 15e3, hidden: true, check: wholeFrom(1, Infinity) },
      // A connected worker told to close (coordinator/workers.ts, table W's stop row) is killed this long
      // after, unless its last acknowledgement shows an open boundary. The worker disposes its runner and
      // exits (patches/caracal-current-api.patch `closing_client`) and sends nothing in between, so no
      // progress fact ends a hung close.
      workerCloseGraceMs: { label: "Worker close grace (ms)", kind: "number", min: 1, default: 500, hidden: true, check: wholeFrom(1, Infinity) },
      // An enabled worker that exited restarts once its game cache repair answers, and then this long
      // after. A failed start gives no cause the restart could wait on, so the pause bounds a crash
      // loop.
      workerRestartMs: { label: "Worker restart after an exit (ms)", kind: "number", min: 0, default: 1500, hidden: true, check: wholeFrom(0, Infinity) },
      // A client update's restarted worker fails when it exits (caracAL redeploys a game that has not
      // loaded in the add-on owner s, CharacterThread.js:249, and a CODE start that fails) or reports the old version.
      // A worker whose CODE runs and never reports sends no fact, so this bounds it.
      clientUpdateWaitMs: { label: "Client update report wait (ms)", kind: "number", min: 1, default: 6e4, hidden: true, check: wholeFrom(1, Infinity) },
      // The saved headless slots restore this long after start, so a Steam window's reservation can
      // arrive first. With Steam members configured and the Steam client closed no post ever arrives,
      // so no fact ends the wait.
      slotRestoreDelayMs: { label: "Headless slot restore after start (ms)", kind: "number", min: 0, default: 4e3, hidden: true, check: wholeFrom(0, Infinity) },
      // A standalone script's reload waits this long after its last change event (coordinator/code.ts):
      // an editor's save is not atomic, and fs.watch reports writes, not a finished save.
      codeSaveSettleMs: { label: "CODE save settle (ms)", kind: "number", min: 0, default: 300, hidden: true, check: wholeFrom(0, Infinity) },
      // A Steam handoff phase that has not moved this long fails, its ownership kept reserved until
      // recovery (roster/handoff.ts `expire`). A phase waits on the Steam client's navigation and the
      // player, and no fact marks a phase that will not move.
      steamHandoffExpiryMs: { label: "Steam handoff phase expiry (ms)", kind: "number", min: 1, default: 9e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A CODE reload with no reply fails and restarts its worker after this long; a worker exit ends the
      // wait at once. The worker sends nothing between `reload_code` and its result.
      reloadReplyMs: { label: "CODE reload reply wait (ms)", kind: "number", min: 1, default: 15e3, hidden: true, check: wholeFrom(1, Infinity) },
      // The host programs' waits (tools/console-build/safe-reload.ts, hosting.ts, controller.ts,
      // tools/update/transaction.ts), which import this file as data. The deploy lease lives this
      // long unless its writer renews it, at a third of its life, so a host that dies leaves no lease; only
      // time marks a writer gone.
      leaseLifeMs: { label: "Deploy lease life (ms)", kind: "number", min: 1, default: 1e4, hidden: true, check: wholeFrom(1, Infinity) },
      // How long the drain must read ready before the host loads: the coordinator's answer carries no
      // stamp of when each participant last acknowledged, so the window is time.
      leaseClearMs: { label: "Deploy safe window (ms)", kind: "number", min: 0, default: 3e3, hidden: true, check: wholeFrom(0, Infinity) },
      // How often the host asks the coordinator's drain answer, and each other host loop its answer: the
      // coordinator answers on request and sends nothing on its own.
      leasePollMs: { label: "Deploy drain poll (ms)", kind: "number", min: 1, default: 500, hidden: true, check: wholeFrom(1, Infinity) },
      hostPollMs: { label: "Host poll of the coordinator (ms)", kind: "number", min: 1, default: 200, hidden: true, check: wholeFrom(1, Infinity) },
      // A started coordinator that has not reported the candidate this long fails its activation, and
      // released characters that have not reported after the release this long fail the release wait:
      // each waits on a start that sends no progress.
      activationMs: { label: "Coordinator activation wait (ms)", kind: "number", min: 1, default: 12e4, hidden: true, check: wholeFrom(1, Infinity) },
      releaseWaitMs: { label: "Release wait after a deploy (ms)", kind: "number", min: 1, default: 3e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A saved character's inspection reuses the game's profile answer this long, so repeated opens of
      // one card ask the game's character API once; the profile changes only when the game saves it,
      // and no fact says when.
      inspectionReuseMs: { label: "Saved character inspection reuse (ms)", kind: "number", min: 0, default: 3e4, hidden: true, check: wholeFrom(0, Infinity) },
      // A safety bound on the game's own cached client files (data.js, old_common_functions.js, stats.js),
      // which the inspection evaluates once per game version: a script of the game's that does not end
      // stops at this bound and tells the status owner's bound record (bigcheck/bounds.md).
      gameScriptEvalMs: { label: "Game file evaluation bound (ms)", kind: "number", min: 1, default: 1e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A safety bound on the game's account API, which the inspection asks for a saved profile: a game
      // server that never answers ends the read here, the card shows the read failed, and the status owner's bound
      // record hears of it (bigcheck/bounds.md).
      inspectionFetchBoundMs: { label: "Saved character fetch bound (ms)", kind: "number", min: 1, default: 1e4, hidden: true, check: wholeFrom(1, Infinity) },
      // The update's health check rolls back after `updateHealthMs` without a healthy answer ("hidden
      // picks").
      updateHealthMs: { label: "Update health wait (ms)", kind: "number", min: 1, default: 12e4, hidden: true, check: wholeFrom(1, Infinity) },
      // The host programs' own picks. Each waits on nothing the game or the run reports: a crashed
      // dashboard respawns after `dashboardRespawnMs`, doubling to `dashboardRespawnMaxMs`; the store
      // keeps `retainedCandidates` builds besides the referenced ones (tools/build-store.ts
      // `RETAIN_BUILDS`, which the game and dashboard histories share); the updater asks GitHub each
      // `updateCheckMs`; an access code lives `accessCodeMs` and takes `accessCodeAttempts` wrong
      // guesses (a security bound, not a retry); the builder polls the source each `builderPollMs` and
      // builds once it has been quiet as long (polling works on network-mounted checkouts, where change
      // events do not); the game build waits `gameWatchMs` after a change event for the writes of one
      // save.
      dashboardRespawnMs: { label: "Dashboard respawn after a crash (ms)", kind: "number", min: 1, default: 3e3, hidden: true, check: wholeFrom(1, Infinity) },
      dashboardRespawnMaxMs: { label: "Dashboard respawn limit (ms)", kind: "number", min: 1, default: 6e4, hidden: true, check: wholeFrom(1, Infinity) },
      retainedCandidates: { label: "Builds kept", kind: "number", min: 1, default: 20, hidden: true, check: wholeFrom(1, Infinity) },
      updateCheckMs: { label: "Update check period (ms)", kind: "number", min: 1, default: 216e5, hidden: true, check: wholeFrom(1, Infinity) },
      accessCodeMs: { label: "Access code life (ms)", kind: "number", min: 1, default: 6e5, hidden: true, check: wholeFrom(1, Infinity) },
      accessCodeAttempts: { label: "Access code guesses", kind: "number", min: 1, default: 5, hidden: true, check: wholeFrom(1, Infinity) },
      builderPollMs: { label: "Builder source poll (ms)", kind: "number", min: 1, default: 1e3, hidden: true, check: wholeFrom(1, Infinity) },
      gameWatchMs: { label: "Game build change settle (ms)", kind: "number", min: 0, default: 250, hidden: true, check: wholeFrom(0, Infinity) },
      // The Steam bridge's picks (roster/bridge.ts, L3.3). The bridge polls the coordinator each
      // `steamBridgePollMs`; a bridge request and the managed slot's code check end after their bounds,
      // since a request no one answers sends no fact. An `already_running` refusal refreshes the roster
      // at most once each `steamRosterRefreshMs`: game 15555's functions.js refreshes the list itself
      // through handle_information, so the bridge's refresh only bounds the lag. A configured Steam
      // member absent from the game's active list for `steamRestoreMs` is restored: the game sends no
      // fact when a window that should open never does.
      steamBridgePollMs: { label: "Steam bridge poll (ms)", kind: "number", min: 1, default: 1e3, hidden: true, check: wholeFrom(1, Infinity) },
      // The Steam connection list marks a window delayed once it has stayed short of connected this long,
      // a display length with no fact behind it.
      steamConnectionDelayedMs: { label: "Steam connection delayed after (ms)", kind: "number", min: 1, default: 3e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A safety bound on a multi-character Steam handoff. Each step waits on the Steam client or the game
      // (a window that never navigates, a release the game never confirms), and a client that hangs sends
      // no answer, so the handoff fails here and keeps its reservations until recovery. It tells the status
      // owner's bound record when it trips (bigcheck/bounds.md).
      steamHandoffBoundMs: { label: "Steam handoff bound (ms)", kind: "number", min: 1, default: 18e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A safety bound on the Steam window's CODE recovery (roster/recovery.ts): the game window is there
      // but its CODE never reports healthy (the Steam client or the game does not start or load it). This
      // many restarts with no healthy report log a prolonged failure and tell the status owner's bound
      // record, through the bridge's `boundsFired` report field (bigcheck/bounds.md). The restarts wait
      // `steamRecoveryFirstMs`, doubling up to `steamRecoveryMaxMs`, so a slow CODE load finishes before
      // the next restart.
      // The Steam window restarts a running CODE whose last successful report is this old (roster/recovery.ts).
      // While reports fail, the coordinator holds the member's travel and the CODE keeps its route cache to
      // resume from. This wait outlasts the 10 s presence window, so a short outage ends in that resume and
      // only a CODE that stays silent restarts.
      steamRunnerStaleMs: { label: "Steam CODE stale after (ms)", kind: "number", min: 1, default: 2e4, hidden: true, check: wholeFrom(1, Infinity) },
      steamRecoveryAttemptsBound: { label: "Steam CODE recovery attempts bound", kind: "number", min: 1, default: 3, hidden: true, check: wholeFrom(1, Infinity) },
      steamRecoveryFirstMs: { label: "Steam CODE recovery first wait (ms)", kind: "number", min: 1, default: 5e3, hidden: true, check: wholeFrom(1, Infinity) },
      steamRecoveryMaxMs: { label: "Steam CODE recovery longest wait (ms)", kind: "number", min: 1, default: 3e4, hidden: true, check: wholeFrom(1, Infinity) },
      steamBridgeRequestMs: { label: "Steam bridge request bound (ms)", kind: "number", min: 1, default: 1e4, hidden: true, check: wholeFrom(1, Infinity) },
      steamSlotCheckMs: { label: "Steam bootstrap slot check bound (ms)", kind: "number", min: 1, default: 6e3, hidden: true, check: wholeFrom(1, Infinity) },
      steamRosterRefreshMs: { label: "Steam roster refresh gap (ms)", kind: "number", min: 1, default: 3e3, hidden: true, check: wholeFrom(1, Infinity) },
      steamRestoreMs: { label: "Steam member restore after missing (ms)", kind: "number", min: 1, default: 8e3, hidden: true, check: wholeFrom(1, Infinity) },
      // The handoff routes check each phase's expiry (`steamHandoffExpiryMs`) this often
      // (roster/routes.ts); the switcher's sound buttons follow the game's flags, which game settings and
      // CODE change with no event, this often (roster/switcher.ts).
      steamHandoffCheckMs: { label: "Steam handoff expiry check (ms)", kind: "number", min: 1, default: 1e3, hidden: true, check: wholeFrom(1, Infinity) },
      steamAudioRefreshMs: { label: "Switcher sound buttons refresh (ms)", kind: "number", min: 1, default: 250, hidden: true, check: wholeFrom(1, Infinity) },
      // The game client download's picks (coordinator/client-files.cjs): a file download and the
      // candidate data.js's check run end after their bounds, since a server or a script that never
      // answers sends no fact.
      clientDownloadMs: { label: "Game client file download bound (ms)", kind: "number", min: 1, default: 3e4, hidden: true, check: wholeFrom(1, Infinity) },
      clientDataCheckMs: { label: "Game data check run bound (ms)", kind: "number", min: 1, default: 5e3, hidden: true, check: wholeFrom(1, Infinity) }
    }
  };

  // runtime/lifecycle/character/run.ts
  function anySignal(signals) {
    const host2 = AbortSignal;
    if (typeof host2.any === "function" && signals.every((signal) => signal instanceof AbortSignal))
      return host2.any(signals);
    if (signals.length === 1) return signals[0];
    const controller = new AbortController();
    const listeners = [];
    const settle = (source) => {
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
      listeners.length = 0;
      controller.abort(source.reason);
    };
    for (const signal of signals) {
      if (signal.aborted) {
        settle(signal);
        break;
      }
      const listener = () => settle(signal);
      listeners.push([signal, listener]);
      signal.addEventListener("abort", listener, { once: true });
    }
    return controller.signal;
  }
  function requestBound(owner, ms, fired) {
    const bound = AbortSignal.timeout(ms);
    return { signal: anySignal([owner, bound]), ended: () => {
      if (bound.aborted && !owner.aborted) fired();
    } };
  }

  // runtime/lifecycle/roster/character-order.ts
  function orderCharacters(characters, roster, primary, merchant, steam = []) {
    const order = new Map(roster.map((member, index) => [member.name, index]));
    const steamNames = new Set(steam);
    const rank = (member) => {
      if (member.name === primary) return 0;
      if (member.name === merchant || member.ctype === "merchant") return 3;
      return steamNames.has(member.name) ? 1 : 2;
    };
    return characters.slice().sort(
      (a, b) => rank(a) - rank(b) || (order.get(a.name) ?? Infinity) - (order.get(b.name) ?? Infinity) || a.name.localeCompare(b.name)
    );
  }

  // runtime/lifecycle/roster/switcher.ts
  var PAD = 8;
  var movementKey = "party-steam-ignore-movement-v1";
  var minimizedKey = "party-steam-minimized-v1";
  var buttonStyle = "font:inherit;background:#242424;color:#fff;border:2px solid #888;border-radius:0;padding:3px 6px;cursor:pointer;box-shadow:inset -2px -2px #080808;line-height:20px";
  function createSwitcher(host2, action) {
    const panel = host2.document.createElement("section");
    panel.id = "party-console-switcher";
    panel.setAttribute("aria-label", "Party Console Steam view");
    host2.document.body.append(panel);
    let ignoreMovement = host2.localStorage?.getItem(movementKey) === "1";
    const nativeCodeFunction = host2.call_code_function;
    const gatedCodeFunction = function(name, ...args) {
      if (name === "on_map_click" && ignoreMovement) return true;
      return nativeCodeFunction?.apply(this, [name, ...args]);
    };
    if (nativeCodeFunction) host2.call_code_function = gatedCodeFunction;
    function movementButton() {
      const control = button("", "Ignore movement clicks", () => {
        ignoreMovement = !ignoreMovement;
        host2.localStorage?.setItem(movementKey, ignoreMovement ? "1" : "0");
        render();
      });
      control.disabled = !nativeCodeFunction;
      control.setAttribute("aria-pressed", String(ignoreMovement));
      control.title = ignoreMovement ? "Movement clicks ignored \xB7 click to allow" : "Movement clicks allowed \xB7 click to ignore";
      control.style.color = ignoreMovement ? "#ffaaaa" : "#70ee70";
      const svg = host2.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("aria-hidden", "true");
      const path = host2.document.createElementNS(svg.namespaceURI, "path");
      path.setAttribute("d", "M4 3 20 12 12 14 9 21Z" + (ignoreMovement ? " M2 2 22 22" : ""));
      svg.append(path);
      control.append(svg);
      return control;
    }
    let minimized = host2.localStorage?.getItem(minimizedKey) === "1";
    let toggleControl = null;
    const observed = /* @__PURE__ */ new Set();
    function layout() {
      const view = host2.document.defaultView;
      if (!view || !toggleControl) return;
      const score = host2.document.querySelector("#topmid"), native = host2.document.querySelector("#toprightcorner .game-controls") || host2.document.querySelector("#toprightcorner");
      for (const element of observed) if (element !== score && element !== native) {
        resize?.unobserve(element);
        observed.delete(element);
      }
      for (const element of [score, native]) if (element && !observed.has(element)) {
        observed.add(element);
        resize?.observe(element);
      }
      const scoreBox = score?.getBoundingClientRect(), nativeBox = native?.getBoundingClientRect();
      const nativeVisible = nativeBox && nativeBox.width > 0 && nativeBox.height > 0;
      let right = nativeVisible ? nativeBox.left - PAD : view.innerWidth - PAD, left = scoreBox && scoreBox.width > 0 && scoreBox.height > 0 ? scoreBox.right + PAD : PAD, top = PAD;
      const toggleWidth = toggleControl.offsetWidth, toggleHeight = toggleControl.offsetHeight;
      if (right - left < toggleWidth + 2 * PAD) {
        left = PAD;
        right = view.innerWidth - PAD;
        top = Math.max(nativeBox?.bottom || 0, scoreBox?.bottom || 0) + PAD;
      }
      panel.style.top = top + "px";
      panel.style.right = Math.max(PAD, view.innerWidth - right) + "px";
      panel.style.maxWidth = Math.max(toggleWidth + 2 * PAD, right - left) + "px";
      panel.style.width = minimized ? toggleWidth + 2 * PAD + "px" : "";
      panel.style.minHeight = toggleHeight + 2 * PAD + "px";
      panel.style.maxHeight = Math.max(60, view.innerHeight - top - PAD) + "px";
    }
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(layout);
    const nativeMount = typeof MutationObserver === "undefined" ? null : new MutationObserver(layout);
    nativeMount?.observe(host2.document.body, { childList: true });
    host2.document.defaultView?.addEventListener("resize", layout);
    let dialog = null, latest = null, busy = false;
    let audioControls = [];
    const audioTimer = host2.document.defaultView?.setInterval(
      () => audioControls.forEach((update) => update()),
      lifecycleSavedFields.settings.steamAudioRefreshMs.default
    );
    function audioButton(music) {
      const label = music ? "mute game music" : "mute game sounds";
      const control = button("", label, () => {
        const enabled = music ? !!host2.sound_music : !!host2.sound_sfx;
        try {
          if (music) {
            if (enabled) host2.sound_off?.();
            else host2.sound_on?.();
          } else {
            if (enabled) host2.sfx_off?.();
            else host2.sfx_on?.();
          }
        } catch (error) {
          popup("Audio setting failed", String(error));
        }
        audioControls.forEach((update2) => update2());
      });
      const svg = host2.document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("width", "22");
      svg.setAttribute("height", "22");
      if (!music) svg.style.cssText = "overflow:visible;transform:translateX(-3px)";
      svg.setAttribute("fill", "none");
      svg.setAttribute("stroke", "currentColor");
      svg.setAttribute("stroke-width", "2");
      svg.setAttribute("stroke-linecap", "round");
      svg.setAttribute("stroke-linejoin", "round");
      svg.setAttribute("aria-hidden", "true");
      const icon = host2.document.createElementNS(svg.namespaceURI, "path");
      icon.setAttribute("d", music ? "M9 18V5l12-2v13 M9 8l12-2 M9 18a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3 M21 16a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3" : "M11 5 6 9H2v6h4l5 4Z M15 8a6 6 0 0 1 0 8 M18 5a10 10 0 0 1 0 14 M21 2a14 14 0 0 1 0 20");
      const slash = host2.document.createElementNS(svg.namespaceURI, "path");
      slash.setAttribute("d", "M2 2 22 22");
      svg.append(icon, slash);
      control.append(svg);
      const update = () => {
        const muted = music ? !host2.sound_music : !host2.sound_sfx;
        control.setAttribute("aria-pressed", String(muted));
        control.title = `${music ? "Game music" : "Game sounds"}: ${muted ? "muted \xB7 click to unmute" : "on \xB7 click to mute"}`;
        control.style.color = muted ? "#ffaaaa" : "#70ee70";
        slash.setAttribute("visibility", muted ? "visible" : "hidden");
        control.disabled = music ? !(host2.sound_on && host2.sound_off) : !(host2.sfx_on && host2.sfx_off);
      };
      audioControls.push(update);
      update();
      return control;
    }
    function button(text2, title, click) {
      const b = host2.document.createElement("button");
      b.textContent = text2;
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
    function popup(title, description, confirm) {
      if (dialog) return;
      dialog = host2.document.createElement("dialog");
      dialog.style.cssText = "background:#151515;color:#fff;border:4px solid #aaa;padding:16px;font:24px Pixel,monospace;max-width:440px";
      dialog.setAttribute("aria-label", title);
      const h = host2.document.createElement("div");
      h.textContent = title;
      const p = host2.document.createElement("p");
      p.textContent = description;
      const cancel = button(confirm ? "Cancel" : "OK", confirm ? "Cancel" : "OK", close);
      dialog.append(h, p, cancel);
      if (confirm)
        dialog.append(
          button("Confirm", "Confirm", () => {
            close();
            confirm();
          })
        );
      dialog.oncancel = close;
      host2.document.body.append(dialog);
      dialog.showModal();
      cancel.focus();
    }
    function request(name, kind) {
      if (busy || latest?.operation && latest.operation.phase !== "complete") return;
      const member = latest?.members.find((m) => m.name === name);
      if (!member) return;
      if (kind === "login" && latest.members.filter((m) => m.hosting && m.hosting !== "offline").length >= MAX_LOGGED_IN) {
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
        void action(name, kind).catch((error) => popup("Character operation failed", String(error))).finally(() => {
          busy = false;
          render();
        });
      };
      if (kind === "login") {
        execute();
        return;
      }
      popup(
        kind === "primary" ? `Make ${name} Steam Primary?` : kind === "headless" ? `Run ${name} headless?` : `Log out ${name}?`,
        kind === "primary" ? "Other Steam characters briefly reconnect, then continue in Steam. Other headless characters stay headless." : kind === "headless" ? "This character moves to caracAL. If primary, another Steam character becomes primary and the Steam group briefly reconnects." : "Stop this character and its routine. Removing the primary briefly reconnects the remaining Steam characters.",
        execute
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
          host2.localStorage?.setItem(minimizedKey, minimized ? "1" : "0");
          render();
        }
      );
      toggleControl = toggle;
      toggle.style.position = "absolute";
      toggle.style.top = "5px";
      toggle.style.right = "5px";
      panel.append(toggle);
      if (minimized) {
        layout();
        return;
      }
      const header = host2.document.createElement("div");
      header.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;padding-right:40px";
      const title = host2.document.createElement("span");
      title.textContent = "Characters";
      const controls = host2.document.createElement("div");
      controls.style.cssText = "display:flex;gap:4px";
      const all2 = button(
        "X",
        "Run all Steam characters headless",
        () => popup(
          "Log out all characters from Steam and run on the headless device?",
          "Characters move one at a time, with Steam primary last. Wait for completion before closing Steam.",
          () => {
            busy = true;
            render();
            void action("", "headless-all").catch((error) => popup("Headless handoff failed", String(error))).finally(() => {
              busy = false;
              render();
            });
          }
        )
      );
      all2.disabled = busy || !latest?.members.some((member) => member.hosting === "steam") || !!latest?.operation && latest.operation.phase !== "complete";
      controls.append(movementButton(), audioButton(false), audioButton(true), all2);
      header.append(title, controls);
      panel.append(header);
      const list3 = host2.document.createElement("div");
      list3.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;max-height:160px;overflow:auto";
      const pending = busy || !!latest?.operation && latest.operation.phase !== "complete";
      const members = latest?.members || [];
      const steam = members.filter((member) => member.hosting === "steam").map((member) => member.name);
      for (const member of orderCharacters(members, members, latest?.primary, null, steam)) {
        const hosting = member.hosting || (member.online ? "headless" : "offline");
        const primary = member.name === latest?.primary && hosting === "steam" && member.online;
        const row = host2.document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:4px;border:2px solid #555;padding:3px;background:#171717";
        const name = button(
          member.name,
          primary ? "This character has primary Steam control" : "Give this character primary Steam control",
          () => request(member.name, "primary")
        );
        name.style.color = !member.online ? "#888" : primary ? "#50ee50" : "#fff";
        name.disabled = pending || primary || !member.online;
        const hostButton = button(
          hosting === "steam" ? "\u2713" : hosting === "headless" ? "H" : "\u25A1",
          hosting === "steam" ? `Run ${member.name} headless` : hosting === "headless" ? `Make ${member.name} Steam Primary` : "Offline",
          () => request(member.name, hosting === "steam" ? "headless" : "primary")
        );
        hostButton.style.color = hosting === "steam" ? "#50ee50" : "#fff";
        hostButton.disabled = pending || hosting === "offline";
        const session = button(
          hosting === "offline" ? "\u21AA" : "\u23FB",
          `${hosting === "offline" ? "Log in" : "Log out"} ${member.name}`,
          () => request(member.name, hosting === "offline" ? "login" : "logout")
        );
        session.disabled = pending;
        row.append(name, hostButton, session);
        list3.append(row);
      }
      panel.append(list3);
      layout();
    }
    return {
      dispose() {
        resize?.disconnect();
        nativeMount?.disconnect();
        observed.clear();
        host2.document.defaultView?.removeEventListener("resize", layout);
        if (host2.call_code_function === gatedCodeFunction)
          host2.call_code_function = nativeCodeFunction;
        host2.document.defaultView?.clearInterval(audioTimer);
        audioControls = [];
        close();
        panel.remove();
      },
      render(reply) {
        latest = reply;
        render();
      }
    };
  }

  // runtime/lifecycle/roster/connection.ts
  var steamBridgeVersion = 15;
  function hostsSteamBridge(host2) {
    return !host2.caracAL && !host2.no_html && !host2.is_bot;
  }
  function serverAddress(host2 = globalThis) {
    return (host2.__partyServer || host2.parent?.__partyServer || "http://127.0.0.1:924").replace(
      /\/$/,
      ""
    );
  }
  function steamBootstrap(base) {
    return `$.getScript(${JSON.stringify(base.replace(/\/$/, "") + "/CODE/adventure_land/universal-loader.js")});`;
  }
  function previousSteamBootstrap(base) {
    return `/* party-managed-bootstrap-v2 */
globalThis.__partyServer=${JSON.stringify(base)};parent.__partyServer=globalThis.__partyServer;
(function(){
 if(globalThis.__partyBootstrapPending||globalThis.__partyCodeLoader)return;
 globalThis.__partyBootstrapPending=true;
 var delay=1000,base=globalThis.__partyServer+"/CODE/adventure_land/";
 async function download(file){var r=await fetch(base+file+"?t="+Date.now(),{cache:"no-store",signal:AbortSignal.timeout(6000)});if(!r.ok)throw Error("HTTP "+r.status);return r.text();}
 async function run(){try{
  if(!parent.no_html&&!parent.is_bot&&!parent.__partySteamBridge)parent.eval(await download("steam-bridge.js"));
  if(parent.localStorage.getItem("party-code-stopped:"+parent.character.name)==="1"){globalThis.__partyBootstrapPending=false;return;}
  (0,eval)(await download("universal-loader.js"));globalThis.__partyBootstrapPending=false;
 }catch(e){console.warn("Party bootstrap retry",String(e));setTimeout(run,delay);delay=Math.min(delay*2,30000);}}
 void run();
})();`;
  }

  // runtime/protocol/realm.ts
  var gameRealm = (region, identifier) => "SR_" + String(region) + String(identifier);
  var bareRealm = (realm) => String(realm ?? "").replace(/^SR_/, "");
  function realmLabel(realm, missing = "") {
    if (!realm) return missing;
    const parts = realmParts(realm);
    return parts ? parts.region + " " + parts.identifier : bareRealm(realm);
  }
  function realmParts(realm) {
    const match = /^(US|EU|ASIA)(I|II|III|IV|V|PVP)$/.exec(bareRealm(realm));
    return match ? { region: match[1], identifier: match[2] } : null;
  }

  // runtime/lifecycle/roster/realm-choice.ts
  function realmMessage(context) {
    if (!context.current) return "Detecting which realm your Adventure Land client is connected to. Login will continue once the realm is confirmed.";
    if (!context.home) return `You're currently on ${realmLabel(context.current, "unknown")}. Detecting your home realm before continuing login.`;
    if (context.current === context.home) return `You're on your home realm, ${realmLabel(context.current, "unknown")}. Continuing login\u2026`;
    return `You're currently on ${realmLabel(context.current, "unknown")}. Your home realm is ${realmLabel(context.home, "unknown")}. Choose which realm to use before logging in the next character.`;
  }
  function createRealmChoice(document, choose) {
    let dialog = null;
    let signature = "";
    function close() {
      dialog?.remove();
      dialog = null;
      signature = "";
    }
    function show(operation) {
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
      dialog.style.cssText = "background:#151515;color:#fff;border:3px solid #aaa;padding:20px;max-width:480px;font:24px Pixel,monospace";
      const text2 = document.createElement("p");
      const known = !!context.current && !!context.home;
      text2.textContent = realmMessage(context);
      const error = document.createElement("p");
      error.style.color = "#ffcc77";
      const controls = document.createElement("div");
      controls.style.cssText = "display:flex;gap:12px;flex-wrap:wrap";
      let busy = false;
      const submittedDialog = dialog;
      async function submit(choice) {
        if (busy) return;
        busy = true;
        for (const button of controls.querySelectorAll("button")) button.disabled = true;
        try {
          await choose(operation.id, choice);
          if (dialog === submittedDialog) close();
        } catch (failure) {
          error.textContent = String(failure);
        } finally {
          busy = false;
          for (const button of controls.querySelectorAll("button")) button.disabled = false;
        }
      }
      const actions = known && context.current !== context.home ? [
        [`Switch to ${realmLabel(context.home, "unknown")} realm`, "switch"],
        [`Stay on ${realmLabel(context.current, "unknown")} realm`, "stay"]
      ] : [];
      actions.push(["Cancel login", "cancel"]);
      for (const [label, choice] of actions) {
        const button = document.createElement("button");
        button.textContent = label;
        button.style.cssText = "background:#242424;color:#fff;border:2px solid #aaa;padding:8px;font:inherit;cursor:pointer";
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
      dialog.append(text2, controls, error);
      document.body.append(dialog);
      dialog.showModal();
    }
    return { show, dispose: close };
  }

  // runtime/status/fields.ts
  var statusSavedFields = {
    name: "core:status",
    settings: {
      // Each refusal is b9b5c91e's preferences route wording (http/dashboard-import.ts:90, :92).
      bankboiPrefix: {
        label: "BankBoi name prefix",
        kind: "text",
        default: "",
        importable: true,
        check: (v) => text(v) && (v === "" || /^[A-Za-z0-9_]{3,11}$/.test(v)),
        refusal: "Use 3\u201311 letters, numbers, or underscores",
        deliver: ["dashboard"]
      },
      anniversaryAutoChat: { label: "Anniversary auto chat", kind: "boolean", default: false, importable: true, check: boolean, refusal: "Invalid chat setting", deliver: ["dashboard"] },
      // The settings the player locked against apps. The settings owner's writer refuses an app key's write to a
      // listed field, and to this list itself, so only the player changes who may change what.
      appLocks: { label: "Settings locked against apps", kind: "value", default: [], check: listOf(text), deliver: ["dashboard"] }
    },
    records: {
      // Table K's app keys (coordinator/apps.ts): each key's name, scopes, switch, last use and
      // revoke, and its SHA-256, never the key. Nothing delivers it; the key screen reads its route.
      appKeys: { default: [] },
      characterSnapshots: { default: {}, document: "roster", deliver: ["dashboard"] },
      characterAppearances: { default: {}, document: "roster", deliver: ["dashboard"] },
      steamSwitch: { default: null, document: "roster" },
      // The history document (persistence/snapshots.ts `historySnapshot`), newest 500 each.
      merchantActivity: { default: [], document: "history", deliver: ["dashboard-core"] },
      combatLogs: { default: {}, document: "history", deliver: ["dashboard-core"] }
    }
  };

  // runtime/status/rules.ts
  var STATUS_PICKS = {
    // The dashboard and map streams' heartbeat (coordinator/streams.ts). A stream sends a change with
    // each report, so the heartbeat speaks only while nothing changes, to keep proxies from closing an
    // idle stream and to tell the client the stream lives; nothing the game or the run reports stands
    // for that silence. The client fails a stream after three heartbeats it did not hear, the period
    // the stream names in each message. One pick serves both streams, where the map stream kept its
    // own 15 s.
    streamHeartbeatMs: 5e3,
    // The logs' text bounds (coordinator/logs.ts): the dashboard shows each entry as one row, and
    // neither the game nor the character bounds a line's length, so these bound a stored entry. The
    // game log lines stay in memory, newest `gameLogLines` per character; the saved logs keep
    // the settings owner's `historyKept`.
    combatLineChars: 240,
    navigationLineChars: 1200,
    gameLineChars: 4e3,
    gameLogLines: 1e3,
    // The dashboard's polls of GET /party-api/state's sections (table S), of the mail inbox and of the
    // update service, the build and debug services, the ALData check and the live metrics graphs, each
    // { interval, stale, gc } in ms (dashboard/features/party/query-cache.tsx, mail-query.ts,
    // console-updates.tsx, console-build-control.tsx, debug-instance.tsx, use-party-console.tsx,
    // metrics-*.tsx). The core and logs sections
    // change only when a character reports, so they poll at the party's measured report period and
    // their rows hold only the cache life; the catalog follows its reference revision. The other rows
    // are how fresh a view the player gets of a section that has no signal the browser hears.
    dashboardPolls: {
      core: { gc: 3e5 },
      logs: { gc: 6e4 },
      config: { interval: 15e3, stale: 15e3, gc: 3e5 },
      fast: { interval: 250, gc: 6e4 },
      inventory: { interval: 2e3, gc: 6e4 },
      bank: { interval: 2e3, stale: 2e3, gc: 3e5 },
      market: { interval: 1e4, stale: 1e4, gc: 12e4 },
      catalog: { gc: 18e5 },
      mail: { interval: 2e3, stale: 2e3, gc: 3e5 },
      mailCount: { interval: 1e4 },
      updates: { interval: 3e3 },
      build: { interval: 1e3 },
      debug: { interval: 1500 },
      aldataAuth: { interval: 15e3, gc: 6e4 },
      metrics: { stale: 500, gc: 1e4 }
    },
    // The character's fast telemetry and map frames (character/telemetry.ts), while the dashboard
    // watches: the game moves a character between its packets on the client and sends nothing for
    // that step, so the frames sample at the rate the dashboard draws.
    telemetryMs: 100,
    // How long a headless map shows a ray: the game's ray animation, whose action carries no eta.
    mapRayMs: 664,
    // How long a kill credit waits for its XP (character/telemetry.ts): the game sends the XP apart
    // from the credit, as a text or in the next character update, and nothing marks a kill that gave
    // none.
    killXpWindowMs: 700,
    // The status owner's combat ring on the character (character/rings.ts), recorded only while a
    // diagnostics view leases it: the trace samples the combat state the role loop acts on, and each
    // ring keeps the history a view reads when it opens.
    combatTraceMs: 250,
    combatTraceEntries: 160,
    handoffEntries: 256,
    // The combat lines a character holds while the coordinator does not answer; the character cannot
    // read the coordinator's `historyKept`, and an outage has no end it reports.
    combatLinesQueued: 50,
    // The metrics' finest bucket (the frame rules below, coordinator/metrics/service.ts): one character
    // frame spans one bucket, and the dashboard's graphs draw at that width.
    metricBucketMs: 1e4,
    // The metrics history (coordinator/metrics/history.ts): a bucket older than a row's `after` merges
    // into that row's `width`, and history older than `keptMs` expires. The table bounds the journal's
    // size and the graphs' detail over time. The account gold points follow the same table.
    metricHistory: { keptMs: 180 * 864e5, merges: [{ after: 864e5, width: 6e4 }, { after: 30 * 864e5, width: 9e5 }] }
  };
  var all = ["dashboard", "pwa", "android"];
  var apps = ["pwa", "android"];
  var lean = (description, readers, size = { size: "small" }) => ({ description, tier: "lean", stored: true, readers, ...size });
  var debug = (description, size = { size: "small" }) => ({ description, tier: "debug", stored: true, readers: [], ...size });
  var consumed = (description, size = { size: "large", bytes: "estimated: one whole game catalog" }) => ({ description, tier: "debug", stored: false, readers: [], ...size });
  var large = (bytes) => ({ size: "large", bytes });
  var catalog = (description, size) => ({ ...consumed(description, size), catalog: true });
  var characterFields = {
    // Identity and runtime
    name: lean("Character name; the status key.", ["dashboard", "android"]),
    actualParty: debug("The game party's leader the character is in (`character.party`), which 13's roster ownership groups by (lifecycle/roster/ownership.ts)."),
    boundsFired: consumed("The kept bounds' firings the character queued since its last taken report; 12's intake row hands them to the bound record (coordinator/intake.ts `bounds`).", { size: "small" }),
    busy: debug("True while an inventory operation holds the character, so 13's reload waits (lifecycle/character/drain.ts `canReload`)."),
    busyReason: debug("The operation behind `busy` and who holds it, for the reload wait's debug view (lifecycle/character/drain.ts `busyReason`)."),
    owner: lean("Game account id; core derives accountId from it.", all),
    ctype: lean("Class id, such as merchant or priest.", [...all, "metrics"]),
    level: lean("Character level.", [...all, "metrics"]),
    server: lean("Realm as region plus identifier, such as USII.", all),
    ping: lean("Latest game ping in ms, or null.", all),
    home: debug("The character's home server from the game, or null."),
    runtime: debug("native (Steam or browser client) or headless (caracAL)."),
    platform: debug("caracal, the game platform name, or browser."),
    clientVersion: debug("Game client version the script runs under."),
    clientInstance: debug("Client instance id from the loader, or null."),
    steamPrimary: debug("True for the Steam window that owns native input."),
    steamRealmProtocol: debug("Steam bridge realm protocol version, 0 when absent."),
    codeGeneration: debug("Runtime generation counter of the loaded character code."),
    dashboardRuntime: debug("Runtime id the dashboard stream uses to fence stale sessions."),
    loaderGeneration: debug("Loader generation number."),
    codeHash: debug("Hash of the loaded character code, or null."),
    codeLoad: debug("The game window's CODE install count and the age of this install, which 13's native reload notice reads."),
    codeRevision: debug("Fixed protocol label of the report, such as realm-logistics-v3."),
    consoleMaintenance: debug("The character's view of the console maintenance lease."),
    bankSortProtocol: debug("Bank sort protocol version."),
    convoyProtocol: debug("Convoy protocol version."),
    commandHold: debug("What holds a member that has the group walk's command and does not run it, or null (walk-client.ts commandHold)."),
    lastCommandId: debug("Id of the last coordinator command the character applied."),
    seenAt: lean("Coordinator receive time of the last status (coordinator/intake.ts, table I's store row).", [...all, "metrics"]),
    inventorySeenAt: debug("Coordinator receive time of the last report that carried items (coordinator/intake.ts, table I's store row)."),
    // Appearance
    skin: lean("Skin id for the portrait.", all),
    characterSprite: lean("Sprite sheet definition for the portrait.", all),
    characterDollHtml: lean("Rendered character doll markup for the portrait.", all, large("1.6 KB")),
    // Vitals and position
    hp: lean("Current HP.", all),
    max_hp: lean("Maximum HP.", all),
    mp: lean("Current MP.", all),
    max_mp: lean("Maximum MP.", all),
    cc: lean("Code call cost, rounded up, for the CC meter (connected-character-card.tsx).", ["dashboard"]),
    calls: debug("The call budget's largest used since the last report, when it held, the interval and its margin, for the call budget's checks."),
    xp: lean("Current XP into the level.", [...all, "metrics"]),
    max_xp: lean("XP needed for the next level.", [...all, "metrics"]),
    gold: lean("Carried gold.", [...all, "metrics"]),
    map: lean("Current map id.", [...all, "metrics"]),
    in: lean("Instance id of the current map; the live stream sends it and fast is the stream fallback.", []),
    x: lean("Rounded x position.", all),
    y: lean("Rounded y position.", all),
    moving: debug("True while the character is moving."),
    transporting: debug("True during a map transport (sampleTravelReport)."),
    rip: lean("True while dead.", [...apps, "metrics"]),
    lastDeath: lean("Last death record: time, killer and details.", ["metrics"]),
    conditions: lean("Active conditions with remaining time.", all, large("2.8 KB")),
    inventorySize: lean("Bag capacity.", all),
    standSlots: debug("Stand trade slots by the game's get_trade_slots (owner 10, I5 N1); only the coordinator reads it (items/rules.ts `merchantStandSlots`)."),
    upgradeInventoryBusy: lean("True while upgrade or tidy work holds the inventory; the live stream sends it and fast is the stream fallback.", []),
    standOpen: lean("True while the merchant stand is open.", all),
    standItem: debug("The stand the merchant has open, else the bag's stand the game opens, else null (items/character/bag.ts `standItem`); 08's stand return goes only with one."),
    target: lean("Current combat target summary, or null.", apps),
    mainTownSpawn: debug("Main town spawn point from game data."),
    realmPlayers: debug("Player names seen on the realm, for giveaways (coordinator/state.ts `giveawayDirectory`)."),
    gameParty: debug("The game's party member list."),
    // Stats
    primaryStat: lean("Class main stat: str, int or dex.", all),
    attack: lean("Attack.", all),
    frequency: lean("Attack frequency.", all),
    range: lean("Attack range.", all),
    speed: lean("Run speed.", all),
    unrestrictedSpeed: lean("Merchant run speed without stand and cart limits, else null.", all),
    baseSpeed: debug("Run speed from class, gear and stats without conditions, stand or cruise, which a walk's pace reads (sampleTravelReport)."),
    armor: lean("Armor.", all),
    resistance: lean("Resistance.", all),
    str: lean("Strength.", all),
    int: lean("Intelligence.", all),
    dex: lean("Dexterity.", all),
    vit: lean("Vitality.", all),
    fortitude: lean("Fortitude.", all),
    luck: lean("Luck as a percentage.", all),
    goldBonus: lean("Gold find bonus in percent.", all),
    xpBonus: lean("XP bonus in percent.", all),
    combatStats: lean("Secondary combat stats: crit, evasion, piercing, resistances.", all),
    // Activity flags
    banking: lean("True while a bank trip runs.", all),
    bankQueued: lean("True while a bank trip is queued.", all),
    stocking: lean("True while the merchant restocks.", all),
    upgrading: lean("True while the merchant upgrades.", apps),
    farmingMode: lean("Active farming mode.", all),
    farmingMonsterType: debug("Monster type the farming mode targets."),
    monsterHunt: lean("Monster hunt quest status.", all),
    huntEventPending: debug("True while a hunt waits on an event."),
    donationXpPerGold: lean("Donation XP per gold the merchant receives.", all),
    donationLevelXp: lean("XP per level from G.levels, indexed by level, for the donation preview (donation-preview.tsx).", ["dashboard"], large("about 1.5 KB")),
    merchantCommand: debug("Report on the merchant command in progress."),
    merchantEventReserved: debug("True while event work reserves the merchant."),
    upgradePreviewSession: debug("Upgrade preview session id."),
    upgradePreviewRevision: debug("Upgrade preview revision counter."),
    luckySlotTracking: lean("Lucky-slot roll evidence for the slot tracker.", all),
    luckySlotCharacterId: debug("Character id that owns the lucky-slot evidence."),
    // The items owner's bank merge failure text (items/character/bank.ts `stackError`).
    inventoryStackError: debug("Last stacking error, or null."),
    // Gathering
    gatheringActive: debug("Active gathering mode, if any."),
    gatheringBlockedReason: debug("Why gathering cannot run, or null."),
    gatheringPhase: debug("Gathering attempt phase, idle when none."),
    gatheringAttemptId: debug("Gathering attempt id, or null."),
    gatheringCooldowns: lean("Fishing and mining cooldowns.", all),
    gatheringAccess: debug("Whether the character can fish and mine."),
    // Achievements and items
    monsterAchievementKills: lean("Kill counts per monster toward achievements.", ["android", "metrics"], large("1.7 KB")),
    monsterAchievements: lean("Achievement progress per monster.", all, large("4.3 KB")),
    tracktrix: lean("Tracktrix status and bonuses.", all),
    items: lean("Bag entries with item fingerprints and metadata.", [...all, "metrics"], large("117 to 273 KB")),
    slots: lean("Equipped entries with item fingerprints and metadata.", [...all, "metrics"], large("457 to 484 KB")),
    nearbyStandListings: debug("Player stand listings near the character.", large("up to 1.9 MB")),
    nearbyGiveaways: debug("Giveaways near the character."),
    bank: consumed("Bank snapshot; 10's items row moves it to bankSnapshot (items/coordinator/storage.ts writeBankSnapshot; a null report stays on the status).", large("all bank packs with item metadata")),
    bankVaults: consumed("Bank vault catalog; 10's owner.ts moves it to state.bankVaults.", { size: "small" }),
    ponty: consumed("Merchant's Ponty listings; 10's items row moves them to state.ponty (items/coordinator/owner.ts observe).", large("grows with the listing count")),
    inventoryRevision: consumed("Revision of the items, slots and bank the report names; 10's inventory carry removes it (items/coordinator/storage.ts createInventoryCarry).", { size: "small" }),
    // Events
    activeEvent: debug("Selected live combat event name, or null."),
    activeEventId: debug("Id of the selected live event, or null."),
    eventRefusal: debug("Occurrence whose join the game refused for good (cant_join, join_too_late), or null; attendance-limits.ts marks it event-over."),
    joinedEvent: debug("Event the character joined; set on normal maps too."),
    mapEvent: debug("Event bound to the current map, or null."),
    serverLiveEvents: debug("Live events the server reports."),
    serverStagingEvents: debug("Staging events the server reports."),
    eventFeedConnected: debug("True while the game socket is connected."),
    eventFeedAt: debug("Time of the last event feed update."),
    eventWalks: debug("The staged events the character walks to before their spawn, with spawn time and destination (events/character/clock.ts `walks`); 06's occurrences.ts opens and misses occurrences from it."),
    eventAdmission: debug("06's admission answer for the member's live event (event and allowed), stamped by events/coordinator/attendance.ts `admit`; the reply carries it to the character."),
    eventRejoin: debug("The occurrence the member died in and has not reached again, or null; 06's attendance.ts stamps it and the reply carries it for the rejoin (1.5 row 6 (3))."),
    presence: debug("06's event presence answer for the member, or null (events/coordinator/source.ts `observe`)."),
    addonReports: lean("Each enabled add-on's own report, by add-on name (runtime/hooks/registry.ts status.report).", ["dashboard"]),
    addonStores: debug("The add-on stores the character holds, as revisions by store key, add-on and key, and its own writes; the coordinator keeps the newest per key (runtime/hooks/store.ts)."),
    addonActionResults: consumed("The outcomes of the add-on actions the coordinator asked; 14's intake row settles each ask and sends addon.acted (runtime/hooks/registry.ts `reported`).", { size: "small" }),
    addonCommandReplies: consumed("The character's replies to the add-on commands the coordinator forwarded; 14's intake row sends addon.commanded (runtime/hooks/registry.ts `reported`).", { size: "small" }),
    reportIntervalMs: debug("The gap between the character's last two reports; a group walk goes on through a late report for two of them (queue A20)."),
    eventClockStale: debug("True when the event clock has not synced for six minutes."),
    eventSchedules: debug("Event schedule snapshot; projectEventSchedules reads it."),
    eventTeam: debug("Event team of the character."),
    eventRecovery: debug("Event recovery state machine."),
    eventCombatSighting: debug("Event combat sighting of the current target."),
    slendermanSighting: debug("Local Slenderman sighting, or null."),
    slendermanSearchExhausted: debug("True when the Slenderman search found nothing."),
    goobrawlCombat: debug("True while Goobrawl combat is available."),
    anniversaryVisit: lean("Anniversary visit timer and round.", all),
    anniversaryServer: debug("Anniversary event status from the server."),
    anniversaryState: lean("Merchant anniversary work: stage, round and retries.", all),
    eventLeads: lean("06's K2 `due` lead per staged event of the member's group (events/coordinator/install.ts), which the anniversary dialog's departure time reads.", ["dashboard"]),
    // Combat
    combat: debug("Combat runner state, positioning and performance; core sends combat.positioning only.", large("0.9 to 1.1 KB")),
    combatSelection: debug("Combat selection id, revision, map and nomination."),
    combatDeviation: debug("The combat deviation while its monster lives in the character's view, or null."),
    groupedCombat: debug("Grouped combat queue protocol: claims, candidates, evidence, handoffs.", large("17 to 19 KB")),
    activeCombatTarget: debug("Combat target the runner owns."),
    engagedCombatTarget: debug("Combat target the character is engaged with."),
    threats: debug("Monsters targeting the character."),
    oneShotMonsterTypes: consumed("One-shot monster types learned; 07's modes.ts merges them.", { size: "small" }),
    oneShotEpoch: consumed("Scatter epoch of oneShotMonsterTypes.", { size: "small" }),
    queueTiming: debug("Queue client timing."),
    recovery: debug("Combat recovery state."),
    lootStatus: debug("Loot client status: pending, eligible and capacity."),
    rareLoot: debug("Rare loot client report."),
    huntLoot: debug("Hunt loot client report."),
    convoyLoot: debug("Convoy loot client report."),
    rareObservation: debug("Latest rare monster observation."),
    rareSightings: debug("Rare monster sightings."),
    rareFields: debug("Rare monster field observations."),
    rareKills: debug("Rare monster kills."),
    rareDeployment: debug("Rare hunt deployment state."),
    escape: debug("Local escape state."),
    turns: debug("03's turns report (skills.report): the ranking's damage per MP and each support cast's ready time, target and MP; the party reply hands it to every member's ranking (TRN-Q-DPS)."),
    activity: lean("The card's activity line: the assigned task and its phase in plain words, and the stuck notice while it lasts; derived state that coordinator/line.ts holds; each section that hands a character out adds it to its own copy, and the stored report never carries it.", ["dashboard"]),
    online: debug("A75's presence answer, true while the last report is younger than the presence age; derived like `activity`, status/coordinator/state.ts adds it to the diagnostics copy and the stored report never carries it."),
    movementLive: debug("The request that holds the character's movement (row, owner identity, tier), or null; the activity line reads it."),
    movementClick: debug("The player's click to walk in the game client (queue C1): walking, or the milliseconds left before the owner takes over again, with 02's card words (label); null without a click. The activity line reads the label."),
    movementClimb: debug("The movement owner's climber: its activity, the rung it tries and, after a rung with no progress, the stuck notice and that record's id; null without a climber."),
    returnTownReady: debug("True when the town skill is ready."),
    // Navigation and movement
    movement: debug("Movement executor report."),
    movementGeometry: debug("Movement geometry identity."),
    convoyNavigation: debug("Convoy navigation report."),
    travelSample: debug("Sequenced travel sample (sampleTravelReport, movement/coordinator/routes.ts)."),
    navigationState: debug("town, convoy, follow, departing or idle."),
    navigationDetail: debug("Navigation detail while traveling."),
    smartNavigation: debug("Game smart-move state."),
    farmReunion: debug("Farm reunion state."),
    farmingNavigationDebug: debug("Farming navigation flags for debugging."),
    eventWalkFailure: debug("Last event walk failure."),
    farmAreaEvidence: debug("Farm area monster evidence.", large("2.7 to 4 KB")),
    farmAreaObservation: debug("Latest farm area observation."),
    farmFocusInView: debug("True while a live focus monster the farm would take is in view."),
    farmCompetition: debug("Other players competing for the farm area."),
    dungeon: debug("Dungeon runtime report, with recovery inside a cave."),
    // Catalogs, reported once when the coordinator has none (coordinator/intake.ts)
    merchantCatalogVersion: catalog("Merchant catalog version.", { size: "small" }),
    travelPlaces: catalog("Travel place catalog."),
    monsterChoices: catalog("Monster choice catalog."),
    monsterLocationsVersion: catalog("Monster locations version.", { size: "small" }),
    monsterHunterLocation: catalog("Monster hunter NPC location.", { size: "small" }),
    bestiaryCatalog: catalog("Bestiary catalog."),
    skillCatalog: catalog("Skill catalog."),
    appearanceChoices: catalog("Class appearance choices."),
    merchantCatalog: catalog("Merchant item catalog.")
  };
  var CATALOG_FIELDS = Object.keys(characterFields).filter((name) => characterFields[name].catalog);
  var shadowFastOmitted = [
    "items",
    "slots",
    "bank",
    "realmPlayers",
    "nearbyStandListings",
    "nearbyGiveaways",
    "characterDollHtml"
  ];
  var shadowOmitted = new Set(shadowFastOmitted);
  var SECRET_NAMES = "api[_ -]?key|key|token|password|authorization|secret|session(?:[_ -]?id)?";
  var SECRET_TEXT = new RegExp(String.raw`["']?\b(${SECRET_NAMES})\b["']?\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)`, "gi");
  var CALENDAR_DAY_MS = 26 * 36e5;
  var METRIC_BUCKET_MS = STATUS_PICKS.metricBucketMs;
  var HISTORY_KEPT_MS = STATUS_PICKS.metricHistory.keptMs;

  // runtime/status/game-log.ts
  var logFilters = [
    { id: "kills", label: "Kills", pattern: /killed|slain/i, enabled: false },
    { id: "gold", label: "Gold", pattern: /\bgold\b/i, enabled: true },
    { id: "party", label: "Party", pattern: /party/i, enabled: true },
    { id: "items", label: "Items", pattern: /found/i, enabled: true },
    { id: "upgrade", label: "Upgr.", pattern: /upgrade|combination|compound/i, enabled: true },
    { id: "errors", label: "Errors", pattern: /\b\w*error\b|\bexception\b|\bfailed\b|route rejected|collisions detected|falling back to native|\b(?:line|column)\s*:?\s*\d+/i, enabled: true },
    { id: "info", label: "Info", pattern: /$^/, enabled: true }
  ];
  var defaultLogFilters = Object.fromEntries(logFilters.map((f) => [f.id, f.enabled]));

  // runtime/status/character/bounds.ts
  var host = globalThis;
  var queue = () => host.__partyBoundQueue ||= { session: Date.now().toString(36) + "-" + Math.random().toString(36).slice(2), seq: 0, firings: [] };
  function boundFired(firing) {
    const q = queue();
    q.firings.push({ ...firing, session: q.session, seq: ++q.seq });
  }
  function boundsPending() {
    const q = queue();
    for (const [cap, { owner, count }] of Object.entries(q.caps || {}))
      q.firings.push({ bound: cap, owner, cap: true, state: { count }, session: q.session, seq: ++q.seq });
    q.caps = {};
    return q.firings.slice();
  }
  function boundsSent(count) {
    queue().firings.splice(0, count);
  }

  // runtime/items/rules.ts
  var UPGRADE_LEVEL_MAX = 12;
  var UPGRADE_TARGET_ACCEPTED = UPGRADE_LEVEL_MAX + 1;
  var BASE_INVENTORY_SIZE = 42;
  var PROTECTED_FREE_SLOTS_DEFAULT = 3;
  var AUTOMATIC_ORDER = ["exchange", "npc", "stand", "upgrade", "compound", "deconstruction"];
  var ACTION_PLACES = [...AUTOMATIC_ORDER, "bank", "merchant"];
  var BANK_PACK_CELLS = 42;
  var BANK_ROW_CELLS = 7;
  var STAGING_FIRST = BANK_PACK_CELLS - BANK_ROW_CELLS;
  var LUCKY_SCALE = 0.975;
  var LUCKY_SHIFT = 0.012;
  var LUCKY_HIGH_ROLL = LUCKY_SCALE - LUCKY_SHIFT;
  var luckyZero = 0.4 * 1e-4 + 0.6 * (0.0121 / 0.975);
  var luckyHigh = 0.4 * 0.0369;
  var lucky = [luckyZero, luckyHigh, 1 - luckyZero - luckyHigh];
  var { max: mathMax, min: mathMin, floor: mathFloor, imul: mathImul, ceil: mathCeil } = Math;
  var scheduler = Promise.resolve();
  var upgradeOfferings = {
    offeringp: "Primling",
    offering: "Primordial Essence",
    offeringx: "Primordial X"
  };
  function isUpgradeOffering(value) {
    return typeof value === "string" && Object.hasOwn(upgradeOfferings, value);
  }
  function offeringOverlap(rules, next) {
    return rules.find((rule) => rule.id !== next.id && rule.name === next.name && rule.floor < next.ceiling && next.floor < rule.ceiling);
  }
  function validOfferingRule(value) {
    if (!value || typeof value !== "object") return false;
    const rule = value;
    return typeof rule.id === "string" && !!rule.id && typeof rule.name === "string" && !!rule.name && isUpgradeOffering(rule.offering) && typeof rule.required === "boolean" && validOfferingRange(rule);
  }
  function validOfferingRange(rule) {
    return Number.isSafeInteger(rule.floor) && Number.isSafeInteger(rule.ceiling) && Number(rule.floor) >= 0 && Number(rule.floor) < Number(rule.ceiling) && Number(rule.ceiling) <= UPGRADE_LEVEL_MAX;
  }
  function fitOfferingRules(value) {
    if (!Array.isArray(value)) return value;
    return value.flatMap((rule) => {
      if (!rule || typeof rule !== "object" || !Number.isSafeInteger(rule.ceiling) || rule.ceiling <= UPGRADE_LEVEL_MAX) return [rule];
      const fitted = { ...rule, ceiling: UPGRADE_LEVEL_MAX };
      return Number(fitted.floor) < UPGRADE_LEVEL_MAX ? [fitted] : [];
    });
  }
  function validOfferingRules(value) {
    if (!Array.isArray(value) || !value.every(validOfferingRule)) return false;
    return new Set(value.map((rule) => rule.id)).size === value.length && !value.some((rule) => offeringOverlap(value, rule));
  }

  // runtime/items/saved-fields.ts
  function validMarketIgnoredItem(value) {
    if (!object(value)) return false;
    return typeof value.name === "string" && /^[a-z0-9_]{1,80}$/i.test(value.name) && typeof value.level === "number" && Number.isSafeInteger(value.level) && value.level >= 0 && value.level <= 100;
  }
  var upgrade = (value) => object(value) && item(value.item) && positive(value.tiers);
  var upgradeRule = (value) => positive(Number(value)) || object(value) && positive(value.tiers);
  var compound = (value) => object(value) && text(value.id) && listOf(mark)(value.items);
  var autoCompound = (value) => item(value) && object(value) && positive(value.targetTier);
  var itemsSavedFields = {
    name: "core:items",
    settings: {
      // How often the inbox is read: the game sends no unread mail count in play, so the player sets
      // the period; 30 s is the previous release's. A send or a collect also reads it when it ends.
      mailCheckSeconds: { label: "Check mail every (seconds)", kind: "number", min: 1, default: 30, importable: true },
      // Kept safety bounds (the numbers rule, 2026-11-13; bigcheck/bounds.md). Each guards against a
      // server outside the console that never answers, ends the wait and tells the status owner's bound
      // record. None has game data or a measurement, so each keeps the previous release's value.
      // An ALData request that never answers.
      aldataRequestBoundMs: { label: "ALData request bound (ms)", kind: "number", min: 1, default: 2e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A game mail API request that never answers.
      mailRequestBoundMs: { label: "Mail request bound (ms)", kind: "number", min: 1, default: 2e4, hidden: true, check: wholeFrom(1, Infinity) },
      // A BankBoi whose worker never reports working: the game never logs it in, or its realm stays
      // unresolved (the transaction's 600 s).
      bankboiStartBoundMs: { label: "BankBoi start bound (ms)", kind: "number", min: 1, default: 6e5, hidden: true, check: wholeFrom(1, Infinity) },
      // The free cells every bag keeps for a visit's logistics (the player asked for a setting
      // for the number of protected free slots; one party-wide value). A whole
      // number from 0; rules.ts `protectedSlotsOf` bounds it by the bag the character's report gives, and each
      // character reads its own count from its reply.
      protectedFreeSlots: {
        label: "Protected free slots",
        kind: "number",
        min: 0,
        default: PROTECTED_FREE_SLOTS_DEFAULT,
        importable: true,
        check: wholeFrom(0, Number.MAX_SAFE_INTEGER),
        refusal: "enter a whole number of free slots from 0 up to the bag size"
      },
      // An automatic purchase spends only the merchant's and the bank's gold above it.
      goldReserve: { label: "Gold reserve", kind: "number", min: 0, default: 0, importable: true },
      threshold: {
        label: "Gold collection threshold",
        kind: "number",
        default: 1e5,
        importable: true,
        check: wholeFrom(0, 1e12),
        refusal: "invalid threshold",
        deliver: ["characters", "dashboard"]
      },
      // A count of bag copies, so the game's base bag bounds it (G node/server.js:1483). An imported
      // count past the bag reads as the bag, as initialCollectionState's load holds a saved one (the
      // earlier console's import took any positive count); the route still refuses it.
      itemCollectionThreshold: {
        label: "Item collection threshold",
        kind: "value",
        default: 1,
        importable: true,
        check: wholeFrom(1, BASE_INVENTORY_SIZE),
        fit: (value) => Number.isSafeInteger(value) && Number(value) > BASE_INVENTORY_SIZE ? BASE_INVENTORY_SIZE : value,
        refusal: "invalid item collection threshold",
        deliver: ["dashboard"]
      },
      buyUpgradeBatchSize: {
        label: "Buy and upgrade batch size",
        kind: "value",
        default: 1,
        importable: true,
        check: wholeFrom(1, BASE_INVENTORY_SIZE),
        refusal: `invalid upgrade batch size (1\u2013${BASE_INVENTORY_SIZE})`,
        deliver: ["dashboard"]
      },
      upgradeOfferingRules: { label: "Upgrade offering rules", kind: "value", default: [], importable: true, check: validOfferingRules, fit: fitOfferingRules },
      // The shared rules before the per-character rules; coordinator/fates.ts migrates them at load.
      merchantRules: {
        label: "Shared item rules (older layout)",
        kind: "value",
        default: null,
        check: (value) => value === null || object(value),
        deliver: ["dashboard"]
      },
      autoDeconstruction: { label: "Automatic deconstruction", kind: "value", default: {}, scope: "character", importable: true, check: mapOf(mapOf((value) => object(value) && item(value.item))), deliver: ["dashboard"] },
      autoNpcSales: { label: "Automatic NPC sales", kind: "value", default: {}, importable: true, check: mapOf((value) => object(value) && item(value.item)), characterKey: "character", deliver: ["dashboard"] },
      autoStandMarks: { label: "Automatic stand listings", kind: "value", default: {}, importable: true, check: mapOf((value) => object(value) && item(value.item) && positive(value.price)), deliver: ["dashboard"] },
      autoExchanges: { label: "Automatic exchanges", kind: "value", default: {}, importable: true, check: mapOf(item), deliver: ["dashboard"] },
      autoItemMarks: {
        label: "Automatic item marks",
        kind: "value",
        default: {},
        scope: "character",
        document: "selections",
        importable: true,
        check: mapOf(mapOf((value) => value === "bank" || value === "merchant")),
        deliver: ["dashboard"]
      },
      autoStandBuys: { label: "Buy from stands automatically", kind: "boolean", default: false, deliver: ["dashboard"] },
      autoBlacklistMerchants: {
        label: "Block failed merchants automatically",
        kind: "boolean",
        default: true,
        deliver: ["dashboard"]
      },
      marketIgnoredItems: {
        label: "Ignored market items",
        kind: "value",
        default: [],
        importable: true,
        check: listOf(validMarketIgnoredItem),
        refusal: "Provide an item name and nonnegative whole item level",
        deliver: ["dashboard"]
      },
      restockPolicies: {
        label: "Restock",
        kind: "value",
        default: {},
        scope: "character",
        importable: true,
        check: mapOf((value) => object(value) && (!value.elixir || object(value.elixir) && text(value.elixir.item) && number(value.elixir.min) && number(value.elixir.max) && boolean(value.elixir.autoConsume) && boolean(value.elixir.autoAcquire)) && [value.hp, value.mp].every((p) => object(p) && number(p.min) && number(p.max) && text(p.item))),
        deliver: ["characters", "dashboard"]
      },
      // The weapon the merchant equips between jobs, saved when the player equips one by hand.
      merchantWeapon: {
        label: "Merchant weapon",
        kind: "value",
        default: null,
        check: (value) => value === null || object(value) && object(value.item),
        deliver: ["characters", "dashboard"]
      },
      // The ALData key, a credential in `party.aldata` that the credentials document saves with its
      // authentication (`secret`). An empty key means none was generated yet.
      aldataKey: { label: "ALData key", kind: "text", default: "", secret: true, document: "aldata", path: ["aldata", "key"] },
      bankSortMode: {
        label: "Bank sorting",
        kind: "choice",
        choices: ["automatic", "request"],
        default: "automatic",
        importable: true,
        check: (value) => value === "automatic" || value === "request",
        deliver: ["dashboard-core"]
      }
    },
    records: {
      // A record: each production receipt consumes a rule's quantity (production.ts
      // `consumeQuotas`), and the player's commands edit it through the items owner's code.
      autoUpgradeMarks: {
        default: {},
        scope: "character",
        document: "selections",
        importable: true,
        check: mapOf(mapOf(upgradeRule)),
        deliver: ["dashboard"]
      },
      production: { default: { attempts: {} } },
      // The stored upgrade previews ride in the dashboard's core read, so an open preview panel reads
      // the preview again when a result lands (upgrade-preview-panel.tsx).
      upgradePreviewResults: { default: {}, deliver: ["dashboard-core"] },
      // The mail inbox and sent list; the items owner holds the inbox (coordinator/mail.ts), so it
      // declares the record. The declaration sat in the status owner's fields.ts, whose import of
      // initialMailbox through items/api.ts closed a bundle cycle that left statusSavedFields
      // undefined.
      mailbox: { default: initialMailbox(void 0) },
      merchantDeliveries: { default: {}, deliver: ["dashboard"] },
      standListings: { default: [], importable: true, check: listOf((value) => object(value) && item(value.item) && positive(value.price)), deliver: ["characters", "dashboard"] },
      npcSaleMarks: { default: [], importable: true, check: listOf((value) => object(value) && item(value.item) && text(value.id)), characterKey: "character", deliver: ["dashboard"] },
      deconstructionMarks: { default: [], importable: true, check: listOf((value) => object(value) && item(value.item) && text(value.id) && text(value.owner) && text(value.origin) && number(value.quantity)), characterKey: "owner", deliver: ["dashboard"] },
      // Part 4: the bag copies an add-on's claim or action holds, by character and slot, which the
      // item-rules slot reads (coordinator/fates.ts `publishAddonFates`).
      addonItemFates: { default: {}, deliver: ["dashboard"] },
      standBids: { default: {}, importable: true, check: mapOf((value) => object(value) && positive(value.price) && positive(value.quantity)), deliver: ["dashboard"] },
      nativeStand: { default: { sequence: 0, offers: {}, problems: {} }, deliver: ["dashboard-core"] },
      standPriceHistory: { default: {}, liveness: true, deliver: ["dashboard-core"] },
      merchantBlacklist: { default: {}, importable: true, check: mapOf(object), deliver: ["dashboard"] },
      upgrades: { default: {}, scope: "character", importable: true, check: mapOf(listOf(upgrade)), deliver: ["dashboard"] },
      compounds: { default: {}, scope: "character", importable: true, check: mapOf(listOf(compound)), deliver: ["dashboard"] },
      autoCompounds: { default: {}, scope: "character", importable: true, check: mapOf(listOf(autoCompound)), deliver: ["dashboard"] },
      luckyUpgradeSlots: { default: {}, deliver: ["characters", "dashboard-core"] },
      luckySlotResume: { default: {}, deliver: ["characters", "dashboard-core"] },
      luckySlotTracking: { default: {}, deliver: ["characters", "dashboard-core"] },
      luckySlotCharacterIds: { default: {}, deliver: ["characters"] },
      bankSortRequest: { default: null, deliver: ["dashboard-core"] },
      marked: { default: {}, scope: "character", document: "selections", importable: true, check: mapOf(listOf(mark)), deliver: ["dashboard"] },
      merchantMarked: { default: {}, scope: "character", document: "selections", importable: true, check: mapOf(listOf(mark)), deliver: ["dashboard"] },
      bankSnapshot: { default: null, document: "bank" },
      withdrawals: { default: {}, document: "bank", deliver: ["dashboard-core"] },
      // The copies the player banked by hand while a merchant claim of their item lived; the claim
      // leaves them in the bank across a restart.
      claimBanked: { default: {}, document: "bank" },
      bankbois: { default: {}, document: "bank" },
      bankboiQueue: { default: [], document: "bank" },
      bankboiTransaction: { default: null, document: "bank" },
      bankboiReservedMigrated: { default: false, document: "bank" }
    }
  };
  function initialMailbox(value) {
    const saved = object(value) ? value : {}, settings = object(saved.settings) ? saved.settings : {};
    return {
      settings: { autoCollect: settings.autoCollect === true, autoDelete: settings.autoDelete === true },
      seenIds: Array.isArray(saved.seenIds) ? saved.seenIds.filter((id) => typeof id === "string") : [],
      outbox: Array.isArray(saved.outbox) ? saved.outbox.flatMap((raw) => {
        const m = object(raw) ? raw : {};
        return typeof m.id === "string" && typeof m.recipient === "string" && typeof m.subject === "string" && typeof m.message === "string" && typeof m.sent === "string" ? [{ id: m.id, recipient: m.recipient, subject: m.subject, message: m.message, sent: m.sent, ...m.item ? { item: m.item } : {}, ...typeof m.quantity === "number" ? { quantity: m.quantity } : {} }] : [];
      }) : []
    };
  }

  // runtime/items/api.ts
  function itemDoors() {
    const doors = globalThis.__partyItemDoors;
    if (!doors) throw Error("The items owner is not installed on this character");
    return doors;
  }
  var finite = (n) => typeof n === "number" && Number.isFinite(n);
  function itemDoorFacts(facts = {}) {
    const { floor, held, ponty } = facts;
    return {
      ...finite(floor) ? { floor } : {},
      ...Array.isArray(held) && held.every(finite) ? { held } : {},
      ...ponty && typeof ponty === "object" ? { ponty: Object.fromEntries(Object.entries(ponty).filter(([, price]) => finite(price))) } : {}
    };
  }
  var door = (name) => (args, ask) => itemDoors().door(name, args, ask.band, itemDoorFacts(ask.facts));
  var wearLook = door("wearLook");
  var donate = door("donate");
  var sendGold = door("sendGold");
  var sendItem = door("sendItem");
  var sendMail = door("sendMail");
  var takeMail = door("takeMail");
  var buy = door("buy");
  var sell = door("sell");
  var exchange = door("exchange");
  var exchangeBuy = door("exchangeBuy");
  var split = door("split");
  var move = door("move");
  var equip = door("equip");
  var unequip = door("unequip");
  var consume = door("consume");
  var dismantle = door("dismantle");
  var destroy = door("destroy");
  var boost = door("boost");
  var upgrade2 = door("upgrade");
  var compound2 = door("compound");
  var craft = door("craft");
  var locksmith = door("locksmith");
  var destat = door("destat");
  var list2 = door("list");
  var wishlist = door("wishlist");
  var tradeBuy = door("tradeBuy");
  var tradeSell = door("tradeSell");
  var tradeSwap = door("tradeSwap");
  var tradeHistory = door("tradeHistory");
  var buySecondhand = door("buySecondhand");
  var lostAndFoundInfo = door("lostAndFoundInfo");
  var lostAndFound = door("lostAndFound");
  var buyLostAndFound = door("buyLostAndFound");
  var openChest = door("openChest");
  var bankRetrieve = door("bankRetrieve");
  var bankStore = door("bankStore");
  var bankSwap = door("bankSwap");
  var bankDeposit = door("bankDeposit");
  var bankWithdraw = door("bankWithdraw");

  // runtime/lifecycle/roster/recovery.ts
  var pick = lifecycleSavedFields.settings;
  var firstWait = () => pick.steamRecoveryFirstMs.default;
  function runner(game) {
    return game.document.getElementById("maincode")?.contentWindow;
  }
  function occupied(code) {
    return !!code?.sharedRoutine && !code.sharedRoutine.canReload();
  }
  function stale(game, state, now) {
    const code = runner(game);
    const last = Math.max(code?.__partyStatusSuccessAt || 0, code?.__partyLoaderRuntimeStartedAt || state.since);
    return now >= state.next && !occupied(code) && (!game.code_active || now - last >= pick.steamRunnerStaleMs.default);
  }
  function createSteamRecovery(host2, bootstrap, persist, log) {
    const states = /* @__PURE__ */ new Map();
    const restores = [];
    const observed = /* @__PURE__ */ new WeakMap();
    let suspended = false, disposed = false, running = false;
    let latest;
    function observe(game) {
      const previous = observed.get(game);
      if (previous && previous.start === game.start_runner && previous.stop === game.stop_runner) return;
      for (const method of ["start_runner", "stop_runner"]) {
        const original = game[method];
        if (!original) continue;
        const wrapped = function(id, code) {
          const name = game.character?.name;
          const event = game.event || host2.event;
          const trusted = name && event?.isTrusted && /^(click|keydown|keyup|keypress)$/.test(event.type);
          if (trusted) {
            const stopped = method === "stop_runner";
            host2.localStorage.setItem(codeStoppedKey(name), stopped ? "1" : "0");
            log(name + (stopped ? ": manual Disengage" : ": manual Engage"));
          }
          const result = original.call(game, id, code);
          if (trusted) void persist(name).catch((error) => log(name + ": autorun persistence failed: " + String(error)));
          return result;
        };
        game[method] = wrapped;
        restores.push(() => {
          if (game[method] === wrapped) game[method] = original;
        });
      }
      observed.set(game, { start: game.start_runner, stop: game.stop_runner });
    }
    const logout = (event) => {
      if (!event.isTrusted) return;
      const target = event.target;
      const action = target?.closest?.("[onclick]")?.getAttribute("onclick") || "";
      if (/socket\.emit\(\s*["']leave["']|\blogout\s*\(/.test(action)) suspended = true;
    };
    host2.document.addEventListener("click", logout, true);
    observe(host2);
    function gameFor(name) {
      if (name === host2.character?.name) return host2;
      const frame = host2.document.getElementById("ichar" + name.toLowerCase());
      return frame?.contentWindow;
    }
    function allowed(name) {
      if (!latest || disposed || suspended || !host2.socket?.connected) return false;
      return owned(name, latest) && !codeStopped(host2.localStorage, name);
    }
    function owned(name, reply) {
      if (!reply.steam?.includes(name)) return false;
      const op = reply.operation;
      if (!op || op.phase === "complete") return reply.primary === host2.character?.name;
      return confirmedArrival(name, reply);
    }
    function confirmedArrival(name, reply) {
      const op = reply.operation;
      if (!op.releasedAt || !op.multi || !["navigate", "failed"].includes(op.phase)) return false;
      if (op.multi.primary !== host2.character?.name || !op.multi.desired.includes(name)) return false;
      if (reply.primary && reply.primary !== op.multi.primary) return false;
      const game = gameFor(name);
      return !!op.destinationRealm && !!game && gameRealm(game.server_region, game.server_identifier) === op.destinationRealm;
    }
    function observeState(name, game, now) {
      let state = states.get(name);
      if (!state) {
        state = { since: now, next: now + firstWait(), attempts: 0, healthy: 0, connected: true };
        states.set(name, state);
      }
      if (!game.socket?.connected) {
        if (state.connected) log(name + ": game connection lost (window present)");
        state.connected = false;
        state.next = now + firstWait();
        return state;
      }
      state.connected = true;
      const code = runner(game);
      const healthy = code?.__partyStatusSuccessAt || 0;
      if (healthy > state.healthy) {
        if (state.attempts) log(name + ": recovery healthy status received");
        state.healthy = healthy;
        state.attempts = 0;
        state.since = now;
      }
      return state;
    }
    async function restart(name, game, state, now) {
      state.attempts++;
      state.next = now + Math.min(pick.steamRecoveryMaxMs.default, firstWait() * 2 ** (state.attempts - 1));
      log(name + ": recovery attempt " + state.attempts + (game.code_active ? " (CODE status stale)" : " (unexpected CODE inactivity)"));
      const bound = pick.steamRecoveryAttemptsBound.default;
      if (state.attempts >= bound) log(name + ": prolonged recovery failure; game window present, healthy CODE status missing");
      if (state.attempts === 1 && game.code_active) boundFired({ bound: "steamRunnerStaleMs", owner: "13", subject: name, state: { ms: pick.steamRunnerStaleMs.default } });
      if (state.attempts === bound) boundFired({ bound: "steamRecoveryAttemptsBound", owner: "13", subject: name, state: { attempts: state.attempts, codeActive: !!game.code_active } });
      try {
        await persist(name);
        if (!allowed(name) || !game.socket?.connected) return;
        game.start_runner?.("maincode", bootstrap);
        await persist(name);
      } catch (error) {
        log(name + ": recovery failed: " + String(error));
      }
    }
    async function recover(reply) {
      for (const name of reply.steam || []) {
        const game = gameFor(name);
        if (!game || game.character?.name !== name) continue;
        observe(game);
        const now = Date.now(), state = observeState(name, game, now);
        if (!allowed(name)) {
          state.next = now + firstWait();
          continue;
        }
        if (state.connected && stale(game, state, now)) await restart(name, game, state, now);
      }
    }
    return {
      async tick(reply) {
        latest = reply;
        if (running || disposed) return;
        running = true;
        try {
          await recover(reply);
        } finally {
          running = false;
        }
      },
      dispose() {
        disposed = true;
        host2.document.removeEventListener("click", logout, true);
        for (const restore of restores) restore();
      }
    };
  }

  // runtime/lifecycle/roster/observations.ts
  function steamObservations(host2, stopped, starting, errors) {
    const active = { ...host2.get_active_characters?.() };
    for (const name of starting) active[name] ||= "loading";
    for (const name of errors.keys()) active[name] ||= "waiting";
    if (host2.character)
      active[host2.character.name] = host2.socket?.connected ? host2.code_active ? "code" : "loading" : "waiting";
    return Object.entries(active).map(([name, value]) => {
      const state = stopped(name) ? "stopped" : value === "code" ? "code" : value === "loading" ? "loading" : "waiting";
      if (state === "code") errors.delete(name);
      return { name, state, primary: name === host2.character?.name, error: errors.get(name) };
    });
  }

  // runtime/lifecycle/roster/bridge.ts
  var fields = lifecycleSavedFields.settings;
  function nativeErrorMessage(error) {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const fields2 = error;
      const messages = [fields2.reason, fields2.error, fields2.message].filter((value) => typeof value === "string" && !!value.trim()).map((value) => value.slice(0, 500));
      if (messages.length) return [...new Set(messages)].join(": ");
    }
    return "Native Steam operation failed without an error reason";
  }
  var slotKey = "party-console-bootstrap-slot-v1";
  var operationKey = "party-console-steam-operation-v1";
  var releaseKey = "party-console-steam-release-v1";
  function restoreRelease(storage) {
    try {
      const value = JSON.parse(storage.getItem(releaseKey) || "null");
      if (value?.released === true && typeof value.operationId === "string" && (value.from === null || typeof value.from === "string"))
        return value;
    } catch {
    }
    return null;
  }
  function installSteamBridge(host2) {
    const server = serverAddress(host2);
    const API = server + "/party-api";
    const bootstrap = steamBootstrap(server);
    if (!hostsSteamBridge(host2)) return;
    host2.__partySteamBridge?.dispose();
    const lifecycle = new AbortController();
    let timer;
    let released = restoreRelease(host2.sessionStorage);
    let releasing = released?.operationId || null;
    let navigating = null;
    let failure = null;
    const clientId = host2.sessionStorage.getItem("party-steam-client") || crypto.randomUUID();
    host2.sessionStorage.setItem("party-steam-client", clientId);
    const sessionId = host2.__partySteamSessionId ||= crypto.randomUUID();
    const switcher = createSwitcher(host2, (character, action = "primary") => post("/steam/action", { character, action }));
    const realmChoice = createRealmChoice(host2.document, (operationId, choice) => post("/steam/realm-choice", { operationId, choice }));
    const starting = /* @__PURE__ */ new Set();
    const startErrors = /* @__PURE__ */ new Map();
    let rosterRefreshPending = null;
    let lastRosterRefreshAt = 0;
    async function refreshRejectedRoster(error) {
      const reason = typeof error === "string" ? error : error && typeof error === "object" && "reason" in error ? error.reason : null;
      if (reason !== "already_running" || lifecycle.signal.aborted) return;
      if (rosterRefreshPending) return rosterRefreshPending;
      if (Date.now() - lastRosterRefreshAt < fields.steamRosterRefreshMs.default) return;
      lastRosterRefreshAt = Date.now();
      rosterRefreshPending = Promise.resolve().then(async () => {
        if (lifecycle.signal.aborted) return;
        await host2.api_call("servers_and_characters", {});
        if (lifecycle.signal.aborted) return;
      }).catch((refreshError) => {
        if (!lifecycle.signal.aborted)
          console.warn("[Steam bridge] Refreshing account roster: " + nativeErrorMessage(refreshError));
      }).finally(() => {
        rosterRefreshPending = null;
      });
      return rosterRefreshPending;
    }
    let missingSince = 0;
    const recovery = createSteamRecovery(
      host2,
      bootstrap,
      ensureBootstrap,
      (message) => {
        console.warn("[Steam recovery] " + message);
        host2.add_log?.(message, "#ffcc77");
      }
    );
    let bootstrapSaved = false;
    const bridgeBound = (name, what) => requestBound(lifecycle.signal, fields[name].default, () => boundFired({ bound: name, owner: "13", state: { what, ms: fields[name].default } }));
    async function post(path, body) {
      const bound = bridgeBound("steamBridgeRequestMs", path);
      try {
        const response = await host2.fetch(API + path, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: bound.signal
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Steam bridge request failed");
        return payload;
      } catch (error) {
        bound.ended();
        throw error;
      }
    }
    async function ensureBootstrap(target) {
      const connectionSlotKey = slotKey + ":" + server;
      let slot = host2.localStorage.getItem(connectionSlotKey);
      const excluded = /* @__PURE__ */ new Set();
      if (!slot || !/^(?:[1-9]|[1-9][0-9]|100)$/.test(slot)) slot = null;
      if (slot && !bootstrapSaved) {
        const bound = bridgeBound("steamSlotCheckMs", "code.js");
        let code;
        try {
          const response = await host2.fetch("/code.js?name=" + encodeURIComponent(slot), { cache: "no-store", signal: bound.signal });
          if (!response.ok) throw new Error("Cannot verify managed bootstrap slot");
          code = (await response.text()).trim();
        } catch (error) {
          bound.ended();
          throw error;
        }
        const legacy = `globalThis.__partyServer=${JSON.stringify(server)};parent.__partyServer=globalThis.__partyServer;$.getScript(${JSON.stringify(server + "/CODE/adventure_land/universal-loader.js")});`;
        if (code !== bootstrap && code !== legacy && code !== previousSteamBootstrap(server)) {
          excluded.add(slot);
          slot = null;
        }
      }
      if (!slot) {
        const codes = host2.X?.codes;
        if (!codes || typeof codes !== "object" || Array.isArray(codes))
          throw new Error("Cannot inspect saved CODE slots. Refresh the Adventure Land account selection and retry.");
        for (let candidate = 100; candidate >= 1; candidate--) {
          const key = String(candidate);
          if (!Object.hasOwn(codes, key) && !excluded.has(key)) {
            slot = key;
            break;
          }
        }
        if (!slot) throw new Error("No free Adventure Land CODE slot (1\u2013100). Free a saved slot and retry; existing CODE has not been overwritten.");
      }
      if (!bootstrapSaved) {
        const saved = await host2.api_call("save_code", {
          slot,
          name: "PartyConsole",
          code: bootstrap,
          electron: true,
          auto: true
        });
        if (saved.failed || saved.success !== true)
          throw new Error(saved.reason || "Could not save the generic CODE bootstrap");
        host2.localStorage.setItem(connectionSlotKey, slot);
        bootstrapSaved = true;
      }
      const character = host2.X?.characters.find((entry) => entry.name === target);
      if (!character) throw new Error("Steam account roster does not contain " + target);
      const raw = host2.storage_get("code_cache") || "{}";
      if (!host2.localStorage.getItem(connectionSlotKey + ":original-cache"))
        host2.localStorage.setItem(connectionSlotKey + ":original-cache", raw);
      const cache = JSON.parse(raw);
      cache["slot_" + character.id] = slot;
      cache["run_" + character.id] = "1";
      cache["code_" + character.id] = bootstrap;
      host2.storage_set("code_cache", JSON.stringify(cache));
      return slot;
    }
    function persistRelease(operation) {
      releasing = operation.id;
      released = { operationId: operation.id, from: operation.from, released: true };
      host2.sessionStorage.setItem(releaseKey, JSON.stringify(released));
    }
    function disconnectPrimary() {
      host2.auto_reload = "off";
      host2.character_to_load = null;
      host2.reload_state = false;
      host2.stop_runner();
      host2.socket?.disconnect();
    }
    async function releaseNative(operation) {
      releasing = operation.id;
      if (operation.target) await ensureBootstrap(operation.target);
      if (lifecycle.signal.aborted) return;
      host2.localStorage.setItem(operationKey, operation.id);
      persistRelease(operation);
      disconnectPrimary();
    }
    function navigate(id, target, destinationRealm) {
      navigating = id;
      const realm = realmParts(destinationRealm);
      if (!realm) throw new Error("Invalid Steam destination realm");
      const destination = "/character/" + encodeURIComponent(target) + "/in/" + realm.region + "/" + realm.identifier + "/";
      if (host2.location.pathname !== destination) host2.location.href = destination;
    }
    function mayStartCompanion(operation, name) {
      const group = operation.multi;
      if (!operation.destinationRealm || !group.before || group.before.includes(name)) return true;
      return group.before.filter((member) => group.desired.includes(member)).every((member) => (group.arrived || []).includes(member));
    }
    async function act(reply) {
      const operation = reply.operation;
      realmChoice.show(operation);
      await recovery.tick(reply);
      if (lifecycle.signal.aborted) return;
      if (operation?.phase === "awaiting-realm-choice") return;
      if ((!operation || operation.phase === "complete") && reply.primary === host2.character?.name && host2.socket?.connected) {
        for (const name of reply.steam || []) await ensureBootstrap(name);
        const active = host2.get_active_characters?.() || {};
        const missing = (reply.steam || []).some((name) => name !== reply.primary && !active[name] && !codeStopped(host2.localStorage, name));
        if (!missing) missingSince = 0;
        else if (!missingSince) missingSince = Date.now();
        else if (Date.now() - missingSince >= fields.steamRestoreMs.default) {
          missingSince = Date.now();
          await post("/steam/restore", {});
          return;
        }
      }
      if (operation?.multi) {
        const group = operation.multi;
        const retryRelease = operation.phase === "failed" && group.action === "headless" && group.releaseIssued && !operation.releasedAt && host2.socket?.connected && group.release.includes(host2.character?.name || "") && !!operation.failure;
        if (operation.phase === "failed" && !retryRelease) {
          releasing = null;
          failure = null;
          return;
        }
        if (operation.phase === "complete") return;
        if (operation.phase === "release" && releasing !== operation.id || retryRelease) {
          for (const name of group.desired) await ensureBootstrap(name);
          if (lifecycle.signal.aborted) return;
          host2.localStorage.setItem(operationKey, operation.id);
          persistRelease(operation);
          for (const name of group.release) {
            if (name === host2.character?.name) disconnectPrimary();
            else host2.stop_character_runner?.(name);
          }
        }
        if (operation.phase === "navigate" && group.primary) {
          const destination = operation.destinationRealm || reply.realm;
          const wrongRealm = operation.destinationRealm && gameRealm(host2.server_region, host2.server_identifier) !== destination;
          if (host2.character?.name !== group.primary || !host2.socket?.connected || wrongRealm) {
            if (navigating !== operation.id) navigate(operation.id, group.primary, destination);
            return;
          }
          const active = host2.get_active_characters?.() || {};
          for (const name of group.desired) {
            if (active[name]) starting.delete(name);
            if (name === group.primary || active[name] || starting.has(name)) continue;
            if (!mayStartCompanion(operation, name)) continue;
            if (!host2.start_character_runner) throw new Error("This Steam client cannot start background characters");
            const slot = await ensureBootstrap(name);
            starting.add(name);
            void Promise.resolve(host2.start_character_runner(name, slot)).catch(async (error) => {
              if (lifecycle.signal.aborted) return;
              starting.delete(name);
              startErrors.set(name, nativeErrorMessage(error));
              console.warn("[Steam bridge] Starting " + name + ": " + nativeErrorMessage(error));
              await refreshRejectedRoster(error);
            });
          }
        }
        return;
      }
      if (!operation || operation.phase === "failed" || operation.phase === "complete") return;
      if (operation.phase === "release" && releasing !== operation.id) {
        await releaseNative(operation);
      }
      if (operation.phase === "navigate" && operation.target && navigating !== operation.id) {
        navigate(operation.id, operation.target, reply.realm);
      }
    }
    function clearCompleted(reply) {
      if (!reply.operation || reply.operation.phase === "complete") {
        starting.clear();
        released = null;
        failure = null;
        releasing = null;
        navigating = null;
        host2.localStorage.removeItem(operationKey);
        host2.sessionStorage.removeItem(releaseKey);
      }
    }
    async function poll() {
      if (lifecycle.signal.aborted) return;
      let reply;
      const boundsFired = boundsPending();
      try {
        reply = await post("/steam/bridge", {
          version: BRIDGE_MULTI_VERSION,
          clientId,
          sessionId,
          character: host2.socket?.connected ? host2.character?.name : null,
          realm: host2.socket?.connected ? gameRealm(host2.server_region, host2.server_identifier) : null,
          observations: steamObservations(host2, (name) => codeStopped(host2.localStorage, name), starting, startErrors),
          running: [
            ...host2.socket?.connected && host2.character && host2.code_active ? [host2.character.name] : [],
            ...Object.entries(host2.get_active_characters?.() || {}).filter(([, state]) => state === "code").map(([name]) => name)
          ],
          operationId: host2.localStorage.getItem(operationKey),
          boundsFired,
          ...released,
          ...failure
        });
        boundsSent(boundsFired.length);
        if (lifecycle.signal.aborted) return;
        clearCompleted(reply);
        switcher.render(reply);
        await act(reply);
      } catch (error) {
        const message = nativeErrorMessage(error);
        console.warn("[Steam bridge] " + message);
        if (reply?.operation) failure = { operationId: reply.operation.id, error: message };
      } finally {
        if (!lifecycle.signal.aborted)
          timer = host2.setTimeout(() => void poll(), fields.steamBridgePollMs.default);
      }
    }
    host2.__partySteamBridge = {
      realmProtocol: 2,
      version: steamBridgeVersion,
      server,
      dispose() {
        lifecycle.abort();
        host2.clearTimeout(timer);
        switcher.dispose();
        realmChoice.dispose();
        recovery.dispose();
      }
    };
    void poll();
  }

  // runtime/lifecycle/roster/entry.ts
  installSteamBridge(globalThis);
})();
