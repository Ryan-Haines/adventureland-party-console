# Apps that talk to the console

An app is a program outside the dashboard, such as the PWA, the APK or your own script, that reads
or drives the console over HTTP. What an app can see and change follows from its key:

- What it shows or changes: a key with `read` reads every GET route the dashboard reads, except
  the routes that hold secrets. `command` sends the dashboard's party commands (travel, Town,
  escape, Pause, event rejoin and the like), `settings` writes the settings routes, and `spend`
  sends the orders that spend gold or items (merchant orders, mail, upgrades, deconstruction).
  runtime/status/coordinator/routes.ts `appRouteScope` maps each route to its scope.
- Its scopes and tier: you issue a key in the dashboard's Apps settings with the scopes you tick.
  The app sends it as `Authorization: Bearer <key>`; the console keeps only its SHA-256 and shows
  the key once. A key's commands move characters at the `app` tier, below your own clicks, unless
  you tick that its commands count as yours. The card line, the records and the settings history
  name the app beside each change, and an app's settings write meets the locks you set on the Apps
  screen. Revoking a key ends its access at once.
- The PWA and the APK read the config section's single `farmingPolicy` and send the farming mode
  route's old `mode` field: both are interface `v1` in routes.ts's version table, kept until the
  app release that ships the two mode rows.
