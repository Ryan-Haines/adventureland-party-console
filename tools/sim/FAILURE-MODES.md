# Simulation harness failure inventory

Recorded before integration. Validate with real ChronAL server/client/CODE journeys.

- Setup drifts from exact commits, silently accepts a dirty checkout, or installs outside .build/sim.
- Windows cannot launch npm or create unprivileged symlinks.
- Simulation reads credentials, publishes CODE, opens real coordinator ports, or contacts live game services.
- Coordinator or planner uses wall time; threaded IPC deadlocks or fails recording commands.
- Stale bundles execute instead of current working-tree sources.
- Requests fail or steps return HTTP errors while the run reports success.
- Offline actors, incomplete duration, or missing native kills pass vacuous expectations.
- Invalid durations/sampling/steps loop forever; pending requests lack a bounded virtual deadline.
- A repeated seed or passive tracing changes timeline bytes.
- Timing reports omit setup/build costs or imply the Playwright suite was accelerated.
- Interrupted runs lose diagnostics or leave threads/processes alive.

Keep reports, timeline hashes, exact build/scenario/pin identities and measured wall time.
Compare the same bounded native scenario at paced real time and accelerated time.
The existing console/native Playwright suites retain their independent coverage.
