// Lifecycle's door for the status owner's host programs in tools/dashboard/. The
// build store's locked JSON, retention and live pins (build-store.ts), the public port
// (defaults.ts), the process tree stop and health wait (process-tree.ts) and the host bound
// (http.ts). tools/console-build/contracts.ts stays the pure file the runtimes load, so nothing that
// needs node:fs or node:child_process goes out through it.
export { RETAIN_BUILDS, applyRemovals, atomicJson, directoryNames, inspectRemoval, livePins, pinLive, readJson, withBuildLock } from '../build-store.ts';
export { DEFAULT_PUBLIC_PORT, publicPort } from './defaults.ts';
export { stopTree, waitForHealthy } from './process-tree.ts';
export type { HostBound } from './http.ts';
