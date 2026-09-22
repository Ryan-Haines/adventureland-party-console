#!/usr/bin/env bash
# Linux smoke test: real launcher/bootstrap with fake installers and host, no game login.
set -euo pipefail
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture="$(mktemp -d)/party console"
mkdir -p "$fixture"/{scripts,tools/hosting,tools/caracal,tools/game,tools/dashboard,dashboard,bin}
trap 'result=$?; if [[ $result != 0 ]]; then cat "$fixture/output" 2>/dev/null || true; fi; rm -rf "${fixture%/*}"' EXIT
cp "$source_root/scripts/start-console.sh" "$fixture/scripts/"
cp "$source_root/tools/hosting/native.mts" "$fixture/tools/hosting/"
export PARTY_TEST_LOG="$fixture/events"
export PATH="$fixture/bin:$PATH"
cat > "$fixture/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -eu
echo "dependencies:$PWD" >> "$PARTY_TEST_LOG"
if [[ "${PARTY_TEST_FAIL:-}" == 1 ]]; then exit 7; fi
mkdir -p node_modules
EOF
chmod +x "$fixture/bin/npm"
for directory in "$fixture" "$fixture/dashboard"; do
  echo '{}' > "$directory/package.json"
  echo '{}' > "$directory/package-lock.json"
done
cat > "$fixture/tools/caracal/setup.mts" <<'EOF'
import {mkdirSync, existsSync, writeFileSync} from 'node:fs';
mkdirSync('.caracal', {recursive:true});
for (const name of ['package.json','package-lock.json']) {
  if (!existsSync('.caracal/'+name)) writeFileSync('.caracal/'+name, '{}');
}
EOF
for script in tools/hosting/install-caddy.mts tools/build-shared.mts tools/build-runtime.mts tools/game/build.mts tools/dashboard/build.mts; do
  echo "import {appendFileSync} from 'node:fs'; appendFileSync(process.env.PARTY_TEST_LOG, '$script\\n');" > "$fixture/$script"
done
cat > "$fixture/tools/hosting/start.mts" <<'EOF'
import {appendFileSync} from 'node:fs';
appendFileSync(process.env.PARTY_TEST_LOG, process.argv.includes('--development') ? 'development\n' : 'production\n');
if (process.env.PARTY_TEST_HOLD === '1') {
  process.on('SIGTERM', () => process.exit(0));
  setInterval(() => {}, 1000);
}
EOF
launch() { bash "$fixture/scripts/start-console.sh" "$@" > "$fixture/output" 2>&1; }
launch
[[ $(grep -c '^dependencies:' "$PARTY_TEST_LOG") == 3 ]]
grep -q '^development$' "$PARTY_TEST_LOG"
launch
[[ $(grep -c '^dependencies:' "$PARTY_TEST_LOG") == 3 ]]
echo '{"changed":true}' > "$fixture/dashboard/package-lock.json"
launch --production
[[ $(grep -c '^dependencies:' "$PARTY_TEST_LOG") == 4 ]]
grep -q '^production$' "$PARTY_TEST_LOG"
grep -q '^tools/dashboard/build.mts$' "$PARTY_TEST_LOG"
echo '{"changed":true}' > "$fixture/package-lock.json"
if PARTY_TEST_FAIL=1 launch; then echo 'Expected dependency failure'; exit 1; fi
grep -q 'startup stopped' "$fixture/output"
PARTY_TEST_HOLD=1 launch &
launcher=$!
for attempt in {1..100}; do
  if grep -q 'Party Console built' "$fixture/output"; then break; fi
  sleep 0.1
done
# Open the same lock in a separate process to verify it stays held after exec.
if flock -n "$fixture/.build/native-console.lock" true; then
  echo 'Launcher failed to retain its lock'; exit 1
fi
if launch; then echo 'Expected duplicate launch rejection'; exit 1; fi
grep -q 'already starting or running' "$fixture/output"
# Find the host child of the background shell function, without touching other services.
host=$(pgrep -P "$launcher" | head -1)
kill -TERM "$host"
wait "$launcher" || true
launch
echo 'Native launcher smoke checks passed: first/repeat launch, spaces, dependencies, production, failure, lock and shutdown.'
