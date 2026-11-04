#!/usr/bin/env bash
# Install NixOS on the target machine. The ONLY secret you provide is the decryption key.
#
#   scripts/install.sh --key <ssh_host_ed25519_key> root@<ip>
#
# Prerequisite: the target is booted from any NixOS/Linux installer with root ssh (or kexec-able).
# This wipes the disk named in settings.nix (disko), generates hosts/erpnext/hardware-configuration.nix,
# drops the key into /etc/ssh, and installs. On first boot agenix decrypts everything with that key
# and the cluster builds itself (secrets -> operator -> MariaDB -> site).
set -euo pipefail
cd "$(dirname "$0")/.."

key=""
target=""
while [ $# -gt 0 ]; do
  case "$1" in
    --key) key="$2"; shift 2 ;;
    -*) echo "unknown argument: $1" >&2; exit 2 ;;
    *) target="$1"; shift ;;
  esac
done
[ -n "$key" ] && [ -n "$target" ] || { sed -n '2,10p' "$0"; exit 2; }
[ -r "$key" ] || { echo "cannot read key: $key" >&2; exit 1; }

# Refuse to install a key that cannot decrypt what is in the repo.
want=$(awk '{print $2}' secrets/host.pub)
have=$(ssh-keygen -y -f "$key" | awk '{print $2}')
[ "$want" = "$have" ] || { echo "key does not match secrets/host.pub, secrets would not decrypt" >&2; exit 1; }

# disk = "auto" only works with the autoinstall ISO (scripts/build-iso.sh)
if [ "$(nix eval --raw --file settings.nix disk)" = auto ]; then
  echo 'settings.nix has disk = "auto": set a /dev/disk/by-id/... path for this script' >&2
  exit 1
fi

stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
install -d -m 755 "$stage/etc/ssh"
install -m 600 "$key" "$stage/etc/ssh/ssh_host_ed25519_key"
install -m 644 secrets/host.pub "$stage/etc/ssh/ssh_host_ed25519_key.pub"

echo ">> this will ERASE the disk configured in settings.nix on $target. Ctrl-C to abort (5s)"
sleep 5

nix run github:nix-community/nixos-anywhere -- \
  --flake ".#erpnext" \
  --extra-files "$stage" \
  --generate-hardware-config nixos-generate-config ./hosts/erpnext/hardware-configuration.nix \
  "$target"

echo ">> installed. Commit hosts/erpnext/hardware-configuration.nix. Inbound: SSH from the LAN only."
echo "   Watch it converge: ssh admin@<server-lan-ip> (or: tailscale ssh admin@erpnext) 'journalctl -fu erpnext-bootstrap'"
