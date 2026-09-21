#!/usr/bin/env bash
set -euo pipefail
image=$1
arch=$2
container=$(docker run -d --rm --platform "linux/$arch" "$image")
trap 'docker logs --tail 60 "$container"; docker stop "$container" >/dev/null' EXIT
for ((attempt=0; attempt<60; attempt++)); do
  # Exercise the gateway, rendered dashboard, and one emitted static asset.
  if docker exec "$container" node --input-type=module -e '
    const base="http://127.0.0.1:3010";
    const health=await fetch(base+"/health");
    if(!health.ok)process.exit(1);
    const dashboard=await fetch("http://127.0.0.1:3030/");
    const html=await dashboard.text();
    if(!dashboard.ok || !html.includes("<html"))process.exit(1);
    const asset=html.match(/src="([^" ]+\.js[^" ]*)"/);
    if(!asset)process.exit(1);
    const script=await fetch(new URL(asset[1],"http://127.0.0.1:3030"));
    if(!script.ok || !script.headers.get("content-type")?.includes("javascript"))process.exit(1);
    const {verifyHTTPS}=await import("./tools/hosting/verify-https.mts");
    await verifyHTTPS("/data",3443);
  ' >/dev/null 2>&1; then
    echo "Party Console startup passed on $arch"
    exit 0
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)" != true ]]; then break; fi
  sleep 5
done
echo "Party Console startup failed on $arch" >&2
exit 1
