#!/usr/bin/env bash
set -euo pipefail
if [[ $EUID -eq 0 ]]; then echo 'Run this as your desktop user, without sudo. It requests sudo only for system trust.' >&2; exit 1; fi
mode=${1:-install}
if [[ "$mode" != install && "$mode" != --remove ]]; then echo 'Usage: bash party-console-trust.sh [--remove]' >&2; exit 1; fi
command -v openssl >/dev/null || { echo 'Install openssl with your package manager, then retry.' >&2; exit 1; }
temporary=$(mktemp -d)
trap 'rm -f -- "$temporary/root.crt"; rmdir -- "$temporary"' EXIT
printf '%s' '__CERT_BASE64__' | base64 --decode > "$temporary/root.crt"
fingerprint=$(openssl x509 -in "$temporary/root.crt" -noout -fingerprint -sha256 | cut -d= -f2)
[[ "$fingerprint" == '__FINGERPRINT__' ]] || { echo 'Certificate fingerprint mismatch' >&2; exit 1; }
echo "Party Console certificate: $fingerprint"
echo 'Trusting this certificate allows this Party Console installation to issue trusted HTTPS certificates.'
read -r -p "$mode this certificate? Close Steam and your browsers, then type YES: " answer
[[ "$answer" == YES ]] || exit 0
name="party-console-__ID__"
if command -v update-ca-certificates >/dev/null; then
 target="/usr/local/share/ca-certificates/$name.crt"
 if [[ "$mode" == --remove ]]; then sudo rm -f -- "$target"; else sudo install -m 644 "$temporary/root.crt" "$target"; fi
 sudo update-ca-certificates
elif command -v update-ca-trust >/dev/null; then
 target="/etc/pki/ca-trust/source/anchors/$name.crt"
 [[ -d /etc/ca-certificates/trust-source/anchors ]] && target="/etc/ca-certificates/trust-source/anchors/$name.crt"
 if [[ "$mode" == --remove ]]; then sudo rm -f -- "$target"; else sudo install -m 644 "$temporary/root.crt" "$target"; fi
 sudo update-ca-trust extract
else
 echo 'Automatic system trust is unsupported here. Import the certificate using your distribution certificate manager.' >&2; exit 1
fi
if command -v certutil >/dev/null; then
 shopt -s nullglob
 for database in "$HOME/.pki/nssdb" "$HOME/.local/share/pki/nssdb" "$HOME"/.mozilla/firefox/*; do
  [[ -f "$database/cert9.db" ]] || continue
  if [[ "$mode" == --remove ]]; then
   certutil -D -d "sql:$database" -n "$name" 2>/dev/null || true
  else
   certutil -A -d "sql:$database" -n "$name" -t 'C,,' -i "$temporary/root.crt" || { echo "Could not update $database; close the browser and retry or import manually." >&2; exit 1; }
  fi
 done
else
 echo 'Browser trust may still need manual import. Optional NSS tools: libnss3-tools (Debian/Ubuntu), nss-tools (Fedora), nss (Arch).'
fi
echo 'System certificate step complete. Restart your client/browser and check HTTPS in setup.'
echo 'Flatpak, Snap, and Proton may use separate stores: follow the manual import instructions in setup.'
