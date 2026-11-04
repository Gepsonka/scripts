#!/usr/bin/env bash
# Build the autoinstall ISO. It carries the decryption key, so treat the image and the stick like the key.
#
#   scripts/build-iso.sh [--key install-root/etc/ssh/ssh_host_ed25519_key] [--out erpnext-autoinstall.iso]
#
# Boot the target from it (UEFI). It picks the disk (settings.disk), gives 15s to abort with any key,
# wipes the disk, installs offline and reboots into the installed system.
set -euo pipefail
cd "$(dirname "$0")/.."

key=install-root/etc/ssh/ssh_host_ed25519_key
out=erpnext-autoinstall.iso
while [ $# -gt 0 ]; do
  case "$1" in
    --key) key="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    *) sed -n '2,7p' "$0"; exit 2 ;;
  esac
done
[ -r "$key" ] || { echo "cannot read key: $key (run scripts/init.sh first)" >&2; exit 1; }

# Refuse a key that cannot decrypt what is in the repo (the build checks it again).
want=$(awk '{print $2}' secrets/host.pub)
have=$(ssh-keygen -y -f "$key" | awk '{print $2}')
[ "$want" = "$have" ] || { echo "key does not match secrets/host.pub, secrets would not decrypt" >&2; exit 1; }

# flakes only see tracked files
if git rev-parse --git-dir >/dev/null 2>&1; then
  untracked=$(git ls-files --others --exclude-standard)
  if [ -n "$untracked" ]; then
    printf 'untracked files are invisible to the flake, git add them first:\n%s\n' "$untracked" >&2
    exit 1
  fi
fi

result=$(ERPNEXT_HOST_KEY="$(realpath "$key")" nix build --impure --no-link --print-out-paths .#iso)
install -m 600 "$result"/iso/*.iso "$out"

cat <<MSG
>> $out ($(du -h "$out" | cut -f1)). It contains the decryption key: store it like the key.
   Write it:   sudo dd if=$out of=/dev/sdX bs=4M conv=fsync status=progress
   Copies of the key also sit in /nix/store until: nix store delete $result && nix-collect-garbage
MSG
