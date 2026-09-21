#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo"
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is missing. Install Docker and its Compose plugin, then try again.' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo 'Docker Compose is missing. Install the Docker Compose plugin, then try again.' >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo 'Cannot access Docker. Make sure Docker is running and your user has permission to use it.' >&2
  exit 1
fi
export AL_DEV_UID=${AL_DEV_UID:-$(id -u)}
export AL_DEV_GID=${AL_DEV_GID:-$(id -g)}
compose=(docker compose --project-directory "$repo" -f "$repo/compose.yaml" -f "$repo/compose.dev.yaml")
if ! "${compose[@]}" build; then
  echo 'Party Console build failed. Fix the error above and run this command again.' >&2
  exit 1
fi
echo 'Party Console built! Starting with hot reload…'
echo 'Waiting for Party Console to become ready (up to five minutes)…'
if ! "${compose[@]}" up -d --force-recreate --wait --wait-timeout 300; then
  echo 'Party Console did not become ready within five minutes, or startup failed.' >&2
  "${compose[@]}" ps >&2 || true
  "${compose[@]}" logs --no-color --tail 50 party-console >&2 || true
  exit 1
fi

# Read the effective container setting and actual published port, including .env.
public_url=$("${compose[@]}" exec -T party-console node -p 'process.env.AL_PUBLIC_URL || ""')
if [[ -n "$public_url" ]]; then
  url=$public_url
else
  binding=$("${compose[@]}" port party-console 3010 | head -n 1)
  if [[ -z "$binding" ]]; then
    echo 'Party Console is healthy, but no published dashboard port was found.' >&2
    exit 1
  fi
  port=${binding##*:}
  host=${binding%:*}
  if [[ "$host" == '0.0.0.0' || "$host" == '[::]' || "$host" == '::' ]]; then
    # Route lookup selects the host's LAN interface without sending a packet.
    host=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<NF;i++)if($i=="src"){print $(i+1);exit}}' || true)
    if [[ -z "$host" ]]; then
      host=localhost
      echo 'Could not detect a LAN address. The URL below works on this host; use its LAN IP from another computer.'
    fi
  fi
  url="http://$host:$port"
fi
printf '\nParty Console ready! Open at %s\n' "$url"
printf 'Steam/browser linking: open %s/setup for localhost or HTTPS instructions.\n' "$url"
