// Dashboard and status's character door:
// telemetry.ts reads the game window's DOM, so runtime/status/api.ts,
// which the dashboard and the coordinator load, does not re-export it.
// The game logs and rendering the lifecycle owner's host and loader install, and the planning schedule metrics
// movement's owner reports through.
export { installHostGameLogs, installGameRendering, installGameLogEcho, createPlanningScheduleMetrics } from "./telemetry.ts";
// The grouped queue's map rings, which the lifecycle owner's role runner installs.
export { installQueueMarkers } from "./markers.ts";
