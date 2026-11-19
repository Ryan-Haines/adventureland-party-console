# Deployment transaction failure inventory

Recorded before implementation: acceptance blocked by hashing; duplicate requests
conflict with their own operation; operation invisible after refresh; status carries
full file inventories; fixed-duration lease expires during verification/activation;
Steam frame replacement loses its hold; a new headless runner attacks before its
first control reply; partial client readiness releases combat; dashboard switch
returns 503 or drops old assets; gameplay-only loads navigate the browser;
terminal cleanup keeps admission busy; Main mode loses checkpoints or moves the
merchant; Cave offers safe modes; rollback or restart loses the cohort.

Use owned controller/store/HTTP routes for transaction admission and durability;
native process readiness is an explicit external boundary in these focused cases.
Native mixed-client gameplay must additionally prove hits, defense, Main arrivals,
CODE identities and resumption. Never use the running account as a test fixture.
Retain phase journals, lease samples, HTTP outcomes and browser screenshots.

## Repeatable validation

Run the console project for `console-build.spec.ts`,
`console-build-browser-recovery.spec.ts`, `console-build-transaction.spec.ts`,
`console-build-safe-host.spec.ts`, `console-build-host.spec.ts` and
`console-build-gateway.spec.ts`. Run the live project for
`live-console-main-reload.spec.ts`, `live-console-mixed-deployment.spec.ts` and
the console reload rows of the Arena table (`e2e/console-reload-rows.ts`); these are five native journeys. Use the normal
Docker fixture installation documented in docs/testing.md, never the live account.
Run `node e2e/verify-artifacts.cjs` after each group before retaining its report.

The mixed journey uses a native browser runner and two genuine headless workers.
Its coordinator process is restarted with a declared artifact identity; it uses
the maintained compiled coordinator, not a fabricated gameplay implementation.
It does not automate the desktop Steam launcher. Exact production artifact
selection, rollback and pinned startup are covered by the process-host journeys.

Local validation isolates source and Vite cache from concurrent sessions. Reduced
traces retain actions and sources; screenshots, deployment/lease journals, native
hit events and coordinator logs remain attached. Failed cold-start and oversized
trace runs are retained separately and do not count as passing evidence.
