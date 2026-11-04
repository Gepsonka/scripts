# Wipe one disk and install the prebuilt ERPNext system on it, then reboot into it. Fully offline.
# Runs on tty1 of the autoinstall ISO (erpnext-autoinstall.service). Environment, see default.nix:
#   DISK_SETTING  settings.disk: "auto" or a fixed device path
#   DISKO_SCRIPT  partitions, formats and mounts the disk at /mnt (expects TARGET_LINK -> the disk)
#   TARGET_LINK   symlink the disko config points at
#   SYSTEM        the system closure to install (already in the ISO's nix store)
#   HOST_KEY_DIR  ssh_host_ed25519_key{,.pub}: the agenix decryption key, also the ssh host key
set -euo pipefail

log=/tmp/erpnext-autoinstall.log
exec > >(tee -a "$log" >(systemd-cat -t erpnext-autoinstall)) 2>&1

min_bytes=$((16 * 1024 * 1024 * 1024))

bail() {
  echo
  echo "!! $*"
  echo "   Nothing was erased. Shell: Alt+F2. Retry: systemctl start erpnext-autoinstall"
  exit 1
}

# ask <prompt>: one line from the keyboard (empty when there is none)
ask() {
  local answer=""
  read -r -p "$1" answer || true
  printf '%s' "$answer"
}

echo "=== ERPNext autoinstall ==="

[ -d /sys/firmware/efi ] || bail "Booted in legacy BIOS mode. The system boots with systemd-boot: switch the firmware to UEFI and boot the stick again."

# the stick (or CD) this installer runs from is never a candidate
iso_disk=""
if src=$(findmnt -no SOURCE /iso 2>/dev/null); then
  iso_disk=$(lsblk -npo PKNAME "$src" | head -n1)
  [ -n "$iso_disk" ] || iso_disk=$src
fi

udevadm settle || true
mapfile -t candidates < <(
  lsblk -dbJpo NAME,TYPE,RM,RO,TRAN,SIZE | jq -r --arg iso "$iso_disk" --argjson min "$min_bytes" '
    .blockdevices[]
    | select(.type == "disk" and (.rm | not) and (.ro | not) and .tran != "usb" and .size >= $min)
    | select(.name != $iso and (.name | test("^/dev/(loop|zram|ram|sr|nbd)") | not))
    | .name'
)

disk=""
if [ "$DISK_SETTING" != auto ]; then
  disk=$(readlink -f "$DISK_SETTING")
  [ -b "$disk" ] || bail "Disk from settings.nix not found: $DISK_SETTING"
elif [ ${#candidates[@]} -eq 1 ]; then
  disk=${candidates[0]}
elif [ ${#candidates[@]} -eq 0 ]; then
  bail "No internal disk of at least 16 GiB found (USB disks are never used)."
else
  echo "More than one internal disk. Pick the one to ERASE:"
  lsblk -dpo NAME,SIZE,MODEL,SERIAL,TRAN "${candidates[@]}"
  while [ -z "$disk" ]; do
    choice=$(ask "Device to erase (e.g. ${candidates[0]}), empty = cancel: ")
    [ -n "$choice" ] || bail "Cancelled."
    for c in "${candidates[@]}"; do
      if [ "$c" = "$choice" ]; then disk=$c; fi
    done
    [ -n "$disk" ] || echo "   not one of the disks listed above"
  done
fi

# The installed system mounts by partition label. A second disk with the same labels would be ambiguous.
other=$(lsblk -lnpo PKNAME,PARTLABEL | awk -v d="$disk" '($2 == "disk-main-ESP" || $2 == "disk-main-root") && $1 != d { print $1 }' | sort -u)
[ -z "$other" ] || bail "$other already carries this system's partition labels (disk-main-*). Wipe it or take it out first."

echo
echo "Target disk:"
lsblk -po NAME,SIZE,TYPE,FSTYPE,LABEL,MODEL "$disk"
echo

if lsblk -lnpo PARTLABEL "$disk" | grep -qx disk-main-root; then
  # Most likely the stick booted again after a finished install. Never wipe that unattended.
  echo "$disk already holds an ERPNext install. If the stick just booted again by accident: remove it and reboot."
  [ "$(ask "Type WIPE to erase it and reinstall: ")" = WIPE ] || bail "Kept the existing install."
else
  for i in $(seq 15 -1 1); do
    printf '\rERASING %s in %2ds. Press any key to abort. ' "$disk" "$i"
    rc=0
    read -r -s -n 1 -t 1 _ || rc=$?
    if [ "$rc" -eq 0 ]; then
      echo
      bail "Aborted by keypress."
    elif [ "$rc" -le 128 ]; then
      sleep 1 # no keyboard input available (EOF), keep counting
    fi
  done
  echo
fi

echo ">> partitioning $disk"
ln -sfn "$disk" "$TARGET_LINK"
"$DISKO_SCRIPT" --yes-wipe-all-disks

echo ">> installing the decryption key (= ssh host key)"
install -d -m 755 /mnt/etc/ssh
install -m 600 "$HOST_KEY_DIR/ssh_host_ed25519_key" /mnt/etc/ssh/ssh_host_ed25519_key
install -m 644 "$HOST_KEY_DIR/ssh_host_ed25519_key.pub" /mnt/etc/ssh/ssh_host_ed25519_key.pub

echo ">> installing NixOS from the stick (offline)"
nixos-install --root /mnt --system "$SYSTEM" --no-root-passwd --no-channel-copy --option substituters ""

echo ">> done"
install -d -m 755 /mnt/var/log
cp "$log" /mnt/var/log/erpnext-autoinstall.log
umount -R /mnt
rm -f "$TARGET_LINK"

echo
echo "Installed on $disk. Rebooting in 15s. Remove the stick now."
echo "(If it boots the stick again anyway, it stops and asks before touching the new install.)"
sleep 15
systemctl reboot
