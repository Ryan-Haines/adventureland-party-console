# Manual Windows E2E runner

The repository runner `party-console-5090-manual` uses the unique label
`party-console-manual-windows`. It has no default labels, so existing jobs targeting
GitHub-hosted Ubuntu/Windows or generic self-hosted runners do not select it.

On the Actions **Validate and release** workflow, choose **Run workflow**, select
`1.5-feature-branch`, and enable `self_hosted`. The project defaults to `all` and
the optional title filter defaults to empty, so this runs the complete suite.

- `console`: dashboard/browser and console deployment journeys; no live gameplay.
- `live`: ChronAL gameplay journeys with actual clients and server boundaries.
- `debug`: debug-instance and debug-container journeys.
- `all`: all three projects, including browser, deployment, debug and gameplay.

An optional title filter deliberately narrows the selected project(s) for diagnosis.
For a full run, leave it empty. The equivalent command is:

```powershell
gh workflow run release.yml --ref 1.5-feature-branch -f self_hosted=true -f local_project=all -f local_grep=
```

The local job only validates and uploads evidence. It does not create a release,
publish packages/images, or activate the live console. The version job explicitly
rejects `self_hosted=true`, and all packaging/publishing jobs depend on that job.
The self-hosted job requires the repository owner to invoke it on the named branch.
Automatic PR checks retain hosted CI.
Do not approve untrusted workflow changes for execution on this personal machine:
labels and workflow conditions are routing controls, not an isolation boundary.
See [GitHub runner security](https://docs.github.com/en/actions/reference/security/secure-use).

The dedicated checkout lives under `C:\al-ci\`, separate from the live installation.
This is a real short directory, not a drive alias or junction: it avoids Windows
native executable path limits while retaining the repository's strict cleanup
root checks. Preparation installs pinned dependencies and fixtures there; it never
activates the live console. Ignored build/dependency caches are reused.
The runner application lives in `.build/self-hosted-runner/`, including its local
credentials; neither directory belongs in Git. The initial official Windows x64
runner package is v2.338.0, SHA256
`f48e0750a21812bca5f82de5f7f5aeae71abee647fab5a582f1742d07eba455f`;
normal GitHub runner updates remain enabled.

`tools/ci/start-local-runner.ps1` runs hidden through the current user's Startup
shortcut **Party Console GitHub runner**. It uses BelowNormal priority and all available CPUs. A single runner and workflow
concurrency group prevent simultaneous local jobs; each job uses `--workers=8`.
This does not limit the separate Docker/WSL VM or enforce a memory ceiling. Docker
Desktop must be running for live/debug projects. Signing out stops this interactive
runner; signing in starts it again. Administrator privileges were not required.

To stop it, first cancel any running local Actions job and wait for teardown, then
stop the `Runner.Listener` process belonging to `.build/self-hosted-runner`.
To start it again, open the Startup shortcut. Removing that shortcut disables login
startup; remove the repository runner in GitHub Settings to unregister it.

The workflow explicitly requests hardware rendering and the RTX 5090, ChronAL at
4x, eight workers, and browser CPU diagnostics. Reports, traces, screenshots, videos,
and timing evidence are uploaded as `self-hosted-e2e-RUN-ATTEMPT` for 14 days.
Completed owned scenario workspaces are removed by the normal E2E teardown.
A single local machine is not equivalent to sixteen parallel hosted machines:
compare the same selected scenarios and distinguish queue/setup from test duration
before claiming a speedup. Idle runner memory was approximately 83 MiB at setup.

## Automatic CI policy

Updates to an open pull request run only typechecking. They
do not install browsers or start console, deployment, debug, or gameplay E2Es.
New PR updates cancel superseded automatic checks for that PR. Pushes to `main`
retain full hosted validation before release. A manual hosted dispatch runs the
complete hosted suite; a manual `self_hosted=true` dispatch runs the selected local
project/filter. Explicit full validation should be run before merging a release PR.
