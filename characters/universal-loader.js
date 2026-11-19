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
  var CHARACTER_PICKS = {
    // The character's report period (character/run.ts `startReports`). The coordinator measures each
    // member's interval from these reports (runtime/protocol/reports.ts `ageOf`), and movement's and
    // The turns owner's backstop wait on that measure, so the period is the clock the others read; nothing in the
    // game reports one.
    lifecycleReportMs: 1e3,
    // The CODE loader's picks (character/loader.ts). The host answers its deployment reply and the
    // activation record on request and sends nothing to a CODE frame, so the loader asks each
    // `loaderPollMs`; with no record named it asks for activation.json each `loaderRecordRecheckMs` (a
    // record the reply does not name, as live-console-explicit-activation.spec.ts serves, is adopted
    // within it). A source fetch and the deployment reply each end after their kept bound, since a
    // request the host never answers sends no fact; each firing tells the status owner's bound record.
    loaderPollMs: 2e3,
    loaderRecordRecheckMs: 1e4,
    loaderFetchMs: 6e3,
    loaderLeaseFetchMs: 3e3
  };

  // runtime/lifecycle/character/run.ts
  function anySignal(signals) {
    const host2 = AbortSignal;
    if (typeof host2.any === "function" && signals.every((signal) => signal instanceof AbortSignal))
      return host2.any(signals);
    if (signals.length === 1) return signals[0];
    const controller = new AbortController();
    const listeners = [];
    const settle = (source2) => {
      for (const [signal, listener] of listeners) signal.removeEventListener("abort", listener);
      listeners.length = 0;
      controller.abort(source2.reason);
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

  // runtime/lifecycle/roster/connection.ts
  var steamBridgeVersion = 15;
  function hostsSteamBridge(host2) {
    return !host2.caracAL && !host2.no_html && !host2.is_bot;
  }
  function needsSteamBridge(bridge, server2) {
    return !bridge || bridge.version !== steamBridgeVersion || bridge.server !== server2;
  }
  function initializeConnection(host2 = globalThis) {
    const script = host2.document?.currentScript;
    const src = script && "src" in script ? script.src : void 0;
    let server2 = serverAddress(host2);
    if (src) {
      const url = new URL(src);
      const suffix = "/CODE/adventure_land/universal-loader.js";
      if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith(suffix))
        throw new Error("Invalid Party Console loader URL");
      server2 = url.origin + url.pathname.slice(0, -suffix.length);
    }
    host2.__partyServer = server2;
    if (host2.parent) host2.parent.__partyServer = server2;
    return server2;
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

  // runtime/lifecycle/character/loader.ts
  async function classArtifact(read, name) {
    return manifestClass(JSON.parse(await read("manifest.json")), name);
  }
  function manifestClass(manifest, name) {
    const entry = manifest.classes?.[name];
    if (manifest.schema !== 1 || !entry || !/^generated\/[a-f0-9]{64}\/[a-z]+\.js$/.test(entry.file))
      throw new Error("Invalid compiled class manifest");
    return entry;
  }
  async function compileArtifact(read, entry, baseUrl2) {
    const bundle = await read(entry.file);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== entry.sha256) throw new Error("Compiled class checksum mismatch");
    const compiled = new Function(bundle + "\n//# sourceURL=" + baseUrl2 + entry.file);
    return () => {
      compiled();
    };
  }
  var server = initializeConnection();
  var baseUrl = server + "/CODE/adventure_land/";
  var root = globalThis;
  var gameHost = root.parent;
  root.__partyCodeLoader?.dispose();
  var generation = (root.__partyLoaderGeneration || 0) + 1;
  root.__partyLoaderGeneration = generation;
  var abort = new AbortController();
  var lastSource = null;
  var loading = false;
  var bridgeLoading = false;
  var timer;
  var hostActivation;
  var missingRecordAt = 0;
  var loaderBound = (name, what) => requestBound(abort.signal, CHARACTER_PICKS[name], () => boundFired({ bound: name, owner: "13", state: { what, ms: CHARACTER_PICKS[name] } }));
  async function source(file) {
    const bound = loaderBound("loaderFetchMs", file);
    try {
      const response = await fetch(baseUrl + file + "?t=" + Date.now(), { cache: "no-store", signal: bound.signal });
      if (!response.ok) throw new Error(`CODE ${file}: HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      bound.ended();
      throw error;
    }
  }
  function current() {
    return !abort.signal.aborted && root.__partyLoaderGeneration === generation && root.parent === gameHost;
  }
  function occupied() {
    return !!root.sharedRoutine && !root.sharedRoutine.canReload();
  }
  function needsNewFrame() {
    return lastSource !== null && !root.parent.caracAL;
  }
  function replaceFrame() {
    dispose();
    const bootstrap = steamBootstrap(server);
    gameHost.setTimeout(() => gameHost.start_runner("maincode", bootstrap), 0);
  }
  function install(signature, compiled) {
    root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
    root.partyRoleRunner?.stop();
    root.sharedRoutine?.stop();
    if (!current()) return;
    root.__partyCodeHash = signature;
    root.__partyConsoleMaintenance = gameHost.__partyConsoleMaintenance;
    root.__partyConsoleMaintenanceAt = gameHost.__partyConsoleMaintenanceAt;
    compiled();
    if (!current()) return;
    lastSource = signature;
    root.__partyLoaderRuntimeStartedAt = Date.now();
    gameHost.__partyCodeLoads = (gameHost.__partyCodeLoads || 0) + 1;
    root.partyRoleRunner?.start();
    root.game_log("Loaded party CODE generation " + generation, "#51D2E1");
  }
  function report(error) {
    if (current()) root.game_log("Party loader failed: " + String(error), "red");
  }
  async function refresh(force = false) {
    if (loading || !current()) return;
    loading = true;
    try {
      let activation = null;
      if (lastSource !== null && hostActivation === null && Date.now() - missingRecordAt < CHARACTER_PICKS.loaderRecordRecheckMs) return;
      try {
        activation = JSON.parse(await source("activation.json"));
        missingRecordAt = 0;
      } catch (error) {
        if (lastSource !== null) {
          missingRecordAt = Date.now();
          return;
        }
      }
      if (activation && (typeof activation.id !== "string" || !activation.id)) throw Error("Invalid CODE activation");
      if (activation?.maintenance && (activation.serverNow || 0) >= (gameHost.__partyConsoleMaintenanceAt || 0)) {
        gameHost.__partyConsoleMaintenance = activation.maintenance;
        gameHost.__partyConsoleMaintenanceAt = activation.serverNow;
      }
      await refreshControl();
      const entry = activation ? manifestClass(activation.manifest, root.character.ctype) : await classArtifact(source, root.character.ctype);
      if (entry.sha256 === lastSource && !force) return;
      const compiled = await compileArtifact(source, entry, baseUrl);
      if (!current()) return;
      if (lastSource !== null && occupied()) return;
      if (needsNewFrame()) {
        replaceFrame();
        return;
      }
      install(entry.sha256, compiled);
    } catch (error) {
      report(error);
    } finally {
      loading = false;
    }
  }
  var disposed = false;
  function dispose() {
    if (disposed) return;
    disposed = true;
    abort.abort();
    clearInterval(timer);
    root.removeEventListener?.("pagehide", dispose);
    root.__partyRuntimeGeneration = (root.__partyRuntimeGeneration || 0) + 1;
    root.partyRoleRunner?.stop();
    if (root.parent === gameHost) root.sharedRoutine?.stop();
  }
  var controlLoading = false;
  function observeActivation(value) {
    const published = hostActivation === null && typeof value.activation === "string";
    hostActivation = "activation" in value ? value.activation ?? null : void 0;
    if (published && !deliberatelyStopped()) void refresh();
  }
  async function refreshControl() {
    if (controlLoading || !current()) return;
    controlLoading = true;
    const bound = loaderBound("loaderLeaseFetchMs", "console-deployment");
    try {
      const response = await fetch(server + "/party-api/console-deployment", { cache: "no-store", signal: bound.signal });
      if (!response.ok) return;
      const value = await response.json();
      if (!current() || value.serverNow < (gameHost.__partyConsoleMaintenanceAt || 0)) return;
      observeActivation(value);
      gameHost.__partyConsoleMaintenance = value.consoleMaintenance;
      gameHost.__partyConsoleMaintenanceAt = value.serverNow;
      root.partyLifecycle?.drain?.receive(value.consoleMaintenance, value.serverNow);
      if (value.consoleMaintenance) root.__partyStatusSuccessAt = Date.now();
    } catch {
      bound.ended();
    } finally {
      controlLoading = false;
    }
  }
  root.__partyCodeLoader = { dispose };
  root.addEventListener?.("pagehide", dispose);
  async function refreshBridge() {
    if (bridgeLoading || !current() || !needsSteamBridge(gameHost.__partySteamBridge, server)) return;
    bridgeLoading = true;
    try {
      const text2 = await source("steam-bridge.js");
      if (current() && needsSteamBridge(gameHost.__partySteamBridge, server)) gameHost.eval(text2);
    } catch (error) {
      if (current()) root.game_log("Steam bridge unavailable; retrying: " + String(error), "red");
    } finally {
      bridgeLoading = false;
    }
  }
  var bridgeHost = hostsSteamBridge(gameHost);
  if (bridgeHost) {
    void refreshBridge();
  }
  timer = setInterval(() => {
    void refreshControl();
    if (bridgeHost) void refreshBridge();
    if (!deliberatelyStopped()) void refresh();
  }, CHARACTER_PICKS.loaderPollMs);
  function deliberatelyStopped() {
    return !!gameHost.localStorage && codeStopped(gameHost.localStorage, gameHost.character?.name);
  }
  if (!deliberatelyStopped()) void refresh();
})();
