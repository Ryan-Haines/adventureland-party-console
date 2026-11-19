// The saved fields of lifecycle (13), its declarations for the settings owner (11), which builds its
// table from them at load. The saved field consoleResumeWaitMs moved unchanged from the held block
// runtime/settings/held/13-lifecycle.ts; 13 parts 2 and 3 added the hidden picks and kept bounds, each
// read by the file its comment names.
import { wholeFrom, type Declarations } from '../settings/api.ts';

export const lifecycleSavedFields = {
  name: 'core:lifecycle',
  settings: {
    // How long the automatic resume after a clean shutdown waits for the characters running at
    // the Pause to connect (coordinator/control.ts). 180 s is the fork's wait (default,
    // unconfirmed).
    consoleResumeWaitMs: { label: 'Resume wait after a clean shutdown (ms)', kind: 'number', min: 0, default: 180_000, check: wholeFrom(0, Infinity) },
    // The host's forced exit after SIGTERM (tools/hosting/start.mts): nothing in the game or the run
    // ends a stop that hangs. The supervisor's own deadline, compose's `stop_grace_period: 30s`, stays
    // in compose.yaml and reaches no process in the container, so the host has no setting to read. The
    // prepared shutdown's worker wait ends this long after the stop, less the measured storage close.
    hostExitGraceMs: { label: 'Host forced exit after a stop (ms)', kind: 'number', min: 1, default: 15_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A connected worker told to close (coordinator/workers.ts, table W's stop row) is killed this long
    // after, unless its last acknowledgement shows an open boundary. The worker disposes its runner and
    // exits (patches/caracal-current-api.patch `closing_client`) and sends nothing in between, so no
    // progress fact ends a hung close.
    workerCloseGraceMs: { label: 'Worker close grace (ms)', kind: 'number', min: 1, default: 500, hidden: true, check: wholeFrom(1, Infinity) },
    // An enabled worker that exited restarts once its game cache repair answers, and then this long
    // after. A failed start gives no cause the restart could wait on, so the pause bounds a crash
    // loop.
    workerRestartMs: { label: 'Worker restart after an exit (ms)', kind: 'number', min: 0, default: 1_500, hidden: true, check: wholeFrom(0, Infinity) },
    // A client update's restarted worker fails when it exits (caracAL redeploys a game that has not
    // loaded in the add-on owner s, CharacterThread.js:249, and a CODE start that fails) or reports the old version.
    // A worker whose CODE runs and never reports sends no fact, so this bounds it.
    clientUpdateWaitMs: { label: 'Client update report wait (ms)', kind: 'number', min: 1, default: 60_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The saved headless slots restore this long after start, so a Steam window's reservation can
    // arrive first. With Steam members configured and the Steam client closed no post ever arrives,
    // so no fact ends the wait.
    slotRestoreDelayMs: { label: 'Headless slot restore after start (ms)', kind: 'number', min: 0, default: 4_000, hidden: true, check: wholeFrom(0, Infinity) },
    // A standalone script's reload waits this long after its last change event (coordinator/code.ts):
    // an editor's save is not atomic, and fs.watch reports writes, not a finished save.
    codeSaveSettleMs: { label: 'CODE save settle (ms)', kind: 'number', min: 0, default: 300, hidden: true, check: wholeFrom(0, Infinity) },
    // A Steam handoff phase that has not moved this long fails, its ownership kept reserved until
    // recovery (roster/handoff.ts `expire`). A phase waits on the Steam client's navigation and the
    // player, and no fact marks a phase that will not move.
    steamHandoffExpiryMs: { label: 'Steam handoff phase expiry (ms)', kind: 'number', min: 1, default: 90_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A CODE reload with no reply fails and restarts its worker after this long; a worker exit ends the
    // wait at once. The worker sends nothing between `reload_code` and its result.
    reloadReplyMs: { label: 'CODE reload reply wait (ms)', kind: 'number', min: 1, default: 15_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The host programs' waits (tools/console-build/safe-reload.ts, hosting.ts, controller.ts,
    // tools/update/transaction.ts), which import this file as data. The deploy lease lives this
    // long unless its writer renews it, at a third of its life, so a host that dies leaves no lease; only
    // time marks a writer gone.
    leaseLifeMs: { label: 'Deploy lease life (ms)', kind: 'number', min: 1, default: 10_000, hidden: true, check: wholeFrom(1, Infinity) },
    // How long the drain must read ready before the host loads: the coordinator's answer carries no
    // stamp of when each participant last acknowledged, so the window is time.
    leaseClearMs: { label: 'Deploy safe window (ms)', kind: 'number', min: 0, default: 3_000, hidden: true, check: wholeFrom(0, Infinity) },
    // How often the host asks the coordinator's drain answer, and each other host loop its answer: the
    // coordinator answers on request and sends nothing on its own.
    leasePollMs: { label: 'Deploy drain poll (ms)', kind: 'number', min: 1, default: 500, hidden: true, check: wholeFrom(1, Infinity) },
    hostPollMs: { label: 'Host poll of the coordinator (ms)', kind: 'number', min: 1, default: 200, hidden: true, check: wholeFrom(1, Infinity) },
    // A started coordinator that has not reported the candidate this long fails its activation, and
    // released characters that have not reported after the release this long fail the release wait:
    // each waits on a start that sends no progress.
    activationMs: { label: 'Coordinator activation wait (ms)', kind: 'number', min: 1, default: 120_000, hidden: true, check: wholeFrom(1, Infinity) },
    releaseWaitMs: { label: 'Release wait after a deploy (ms)', kind: 'number', min: 1, default: 30_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A saved character's inspection reuses the game's profile answer this long, so repeated opens of
    // one card ask the game's character API once; the profile changes only when the game saves it,
    // and no fact says when.
    inspectionReuseMs: { label: 'Saved character inspection reuse (ms)', kind: 'number', min: 0, default: 30_000, hidden: true, check: wholeFrom(0, Infinity) },
    // A safety bound on the game's own cached client files (data.js, old_common_functions.js, stats.js),
    // which the inspection evaluates once per game version: a script of the game's that does not end
    // stops at this bound and tells the status owner's bound record (bigcheck/bounds.md).
    gameScriptEvalMs: { label: 'Game file evaluation bound (ms)', kind: 'number', min: 1, default: 10_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A safety bound on the game's account API, which the inspection asks for a saved profile: a game
    // server that never answers ends the read here, the card shows the read failed, and the status owner's bound
    // record hears of it (bigcheck/bounds.md).
    inspectionFetchBoundMs: { label: 'Saved character fetch bound (ms)', kind: 'number', min: 1, default: 10_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The update's health check rolls back after `updateHealthMs` without a healthy answer ("hidden
    // picks").
    updateHealthMs: { label: 'Update health wait (ms)', kind: 'number', min: 1, default: 120_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The host programs' own picks. Each waits on nothing the game or the run reports: a crashed
    // dashboard respawns after `dashboardRespawnMs`, doubling to `dashboardRespawnMaxMs`; the store
    // keeps `retainedCandidates` builds besides the referenced ones (tools/build-store.ts
    // `RETAIN_BUILDS`, which the game and dashboard histories share); the updater asks GitHub each
    // `updateCheckMs`; an access code lives `accessCodeMs` and takes `accessCodeAttempts` wrong
    // guesses (a security bound, not a retry); the builder polls the source each `builderPollMs` and
    // builds once it has been quiet as long (polling works on network-mounted checkouts, where change
    // events do not); the game build waits `gameWatchMs` after a change event for the writes of one
    // save.
    dashboardRespawnMs: { label: 'Dashboard respawn after a crash (ms)', kind: 'number', min: 1, default: 3_000, hidden: true, check: wholeFrom(1, Infinity) },
    dashboardRespawnMaxMs: { label: 'Dashboard respawn limit (ms)', kind: 'number', min: 1, default: 60_000, hidden: true, check: wholeFrom(1, Infinity) },
    retainedCandidates: { label: 'Builds kept', kind: 'number', min: 1, default: 20, hidden: true, check: wholeFrom(1, Infinity) },
    updateCheckMs: { label: 'Update check period (ms)', kind: 'number', min: 1, default: 21_600_000, hidden: true, check: wholeFrom(1, Infinity) },
    accessCodeMs: { label: 'Access code life (ms)', kind: 'number', min: 1, default: 600_000, hidden: true, check: wholeFrom(1, Infinity) },
    accessCodeAttempts: { label: 'Access code guesses', kind: 'number', min: 1, default: 5, hidden: true, check: wholeFrom(1, Infinity) },
    builderPollMs: { label: 'Builder source poll (ms)', kind: 'number', min: 1, default: 1_000, hidden: true, check: wholeFrom(1, Infinity) },
    gameWatchMs: { label: 'Game build change settle (ms)', kind: 'number', min: 0, default: 250, hidden: true, check: wholeFrom(0, Infinity) },
    // The Steam bridge's picks (roster/bridge.ts, L3.3). The bridge polls the coordinator each
    // `steamBridgePollMs`; a bridge request and the managed slot's code check end after their bounds,
    // since a request no one answers sends no fact. An `already_running` refusal refreshes the roster
    // at most once each `steamRosterRefreshMs`: game 15555's functions.js refreshes the list itself
    // through handle_information, so the bridge's refresh only bounds the lag. A configured Steam
    // member absent from the game's active list for `steamRestoreMs` is restored: the game sends no
    // fact when a window that should open never does.
    steamBridgePollMs: { label: 'Steam bridge poll (ms)', kind: 'number', min: 1, default: 1_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The Steam connection list marks a window delayed once it has stayed short of connected this long,
    // a display length with no fact behind it.
    steamConnectionDelayedMs: { label: 'Steam connection delayed after (ms)', kind: 'number', min: 1, default: 30_000, hidden: true, check: wholeFrom(1, Infinity) },
    // A safety bound on a multi-character Steam handoff. Each step waits on the Steam client or the game
    // (a window that never navigates, a release the game never confirms), and a client that hangs sends
    // no answer, so the handoff fails here and keeps its reservations until recovery. It tells the status
    // owner's bound record when it trips (bigcheck/bounds.md).
    steamHandoffBoundMs: { label: 'Steam handoff bound (ms)', kind: 'number', min: 1, default: 180_000, hidden: true, check: wholeFrom(1, Infinity) },
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
    steamRunnerStaleMs: { label: 'Steam CODE stale after (ms)', kind: 'number', min: 1, default: 20_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamRecoveryAttemptsBound: { label: 'Steam CODE recovery attempts bound', kind: 'number', min: 1, default: 3, hidden: true, check: wholeFrom(1, Infinity) },
    steamRecoveryFirstMs: { label: 'Steam CODE recovery first wait (ms)', kind: 'number', min: 1, default: 5_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamRecoveryMaxMs: { label: 'Steam CODE recovery longest wait (ms)', kind: 'number', min: 1, default: 30_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamBridgeRequestMs: { label: 'Steam bridge request bound (ms)', kind: 'number', min: 1, default: 10_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamSlotCheckMs: { label: 'Steam bootstrap slot check bound (ms)', kind: 'number', min: 1, default: 6_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamRosterRefreshMs: { label: 'Steam roster refresh gap (ms)', kind: 'number', min: 1, default: 3_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamRestoreMs: { label: 'Steam member restore after missing (ms)', kind: 'number', min: 1, default: 8_000, hidden: true, check: wholeFrom(1, Infinity) },
    // The handoff routes check each phase's expiry (`steamHandoffExpiryMs`) this often
    // (roster/routes.ts); the switcher's sound buttons follow the game's flags, which game settings and
    // CODE change with no event, this often (roster/switcher.ts).
    steamHandoffCheckMs: { label: 'Steam handoff expiry check (ms)', kind: 'number', min: 1, default: 1_000, hidden: true, check: wholeFrom(1, Infinity) },
    steamAudioRefreshMs: { label: 'Switcher sound buttons refresh (ms)', kind: 'number', min: 1, default: 250, hidden: true, check: wholeFrom(1, Infinity) },
    // The game client download's picks (coordinator/client-files.cjs): a file download and the
    // candidate data.js's check run end after their bounds, since a server or a script that never
    // answers sends no fact.
    clientDownloadMs: { label: 'Game client file download bound (ms)', kind: 'number', min: 1, default: 30_000, hidden: true, check: wholeFrom(1, Infinity) },
    clientDataCheckMs: { label: 'Game data check run bound (ms)', kind: 'number', min: 1, default: 5_000, hidden: true, check: wholeFrom(1, Infinity) },
  },
} satisfies Declarations;

// The lifecycle owner's character picks. No screen shows them and no player chooses one, so each is
// a named pick beside the declarations and none is a saved setting: a saved copy never reached a
// character or the dashboard.
export const CHARACTER_PICKS = {
  // The character's report period (character/run.ts `startReports`). The coordinator measures each
  // member's interval from these reports (runtime/protocol/reports.ts `ageOf`), and movement's and
  // The turns owner's backstop wait on that measure, so the period is the clock the others read; nothing in the
  // game reports one.
  lifecycleReportMs: 1_000,
  // The CODE loader's picks (character/loader.ts). The host answers its deployment reply and the
  // activation record on request and sends nothing to a CODE frame, so the loader asks each
  // `loaderPollMs`; with no record named it asks for activation.json each `loaderRecordRecheckMs` (a
  // record the reply does not name, as live-console-explicit-activation.spec.ts serves, is adopted
  // within it). A source fetch and the deployment reply each end after their kept bound, since a
  // request the host never answers sends no fact; each firing tells the status owner's bound record.
  loaderPollMs: 2_000,
  loaderRecordRecheckMs: 10_000,
  loaderFetchMs: 6_000,
  loaderLeaseFetchMs: 3_000,
} as const;
