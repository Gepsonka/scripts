# erpnext-auto-update: the weekly OS update (timer in default.nix).
#   1. copy the flake source the RUNNING system was built from (/etc/erpnext/flake), so a config deployed
#      by hand is never reverted, and move only nixpkgs to the newest commit of its release branch
#   2. build; nothing to do if the result is the running system
#   3. switch, then wait until no health problem exists that was not there before; otherwise roll back
#   4. reboot only when kernel/initrd changed (and REBOOT=1)
# Reports start/ok/fail with the log to healthchecks (<host>-update). writeShellApplication adds `set -euo pipefail`.
set -E

log=$(mktemp)
work=$(mktemp -d)
current=$(readlink -f /run/current-system)
profile=/nix/var/nix/profiles/system
trap 'rm -rf "$work" "$log"' EXIT
trap 'say "FAILED at line $LINENO, still running $current"; erpnext-ping update fail <"$log"' ERR

say() { echo "$*" | tee -a "$log"; }
run() { "$@" 2>&1 | tee -a "$log"; }
# stable problem keys, see health.sh
problems() { { erpnext-health || true; } | cut -d: -f1 | sort -u; }

# returns once health has no problem beyond $1 in two checks in a row, fails after HEALTH_TIMEOUT seconds
wait_healthy() {
  local before="$1" deadline=$(($(date +%s) + HEALTH_TIMEOUT)) good=0 new
  while [ "$(date +%s)" -lt "$deadline" ]; do
    sleep 30
    new=$(comm -13 <(printf '%s\n' "$before") <(problems))
    if [ -z "$new" ]; then
      good=$((good + 1))
      [ "$good" -ge 2 ] && return 0
    else
      good=0
    fi
  done
  say "new problems after the switch:"
  say "$new"
  return 1
}

erpnext-ping update start </dev/null
# wait for a running ERPNext image deploy (image-update.sh) to finish, switching restarts k3s
exec 9>/run/erpnext-maintenance.lock
flock -w 3600 9
say "weekly update of $HOST_NAME, running $current"

mkdir "$work/flake"
cp -rL --no-preserve=mode,ownership /etc/erpnext/flake/. "$work/flake/"
run nix flake update nixpkgs --flake "path:$work/flake"
run nix build --out-link "$work/result" "path:$work/flake#nixosConfigurations.$HOST_NAME.config.system.build.toplevel"
new=$(readlink -f "$work/result")

# a release branch that stopped moving is end-of-life: no more security fixes until flake.nix moves on
status=ok
age_days=$((($(date +%s) - $(jq .nodes.nixpkgs.locked.lastModified "$work/flake/flake.lock")) / 86400))
if [ "$age_days" -gt 30 ]; then
  status=fail
  say "WARNING: nixpkgs $(jq -r .nodes.nixpkgs.original.ref "$work/flake/flake.lock") had no commit for $age_days days."
  say "         The NixOS release is probably end-of-life: move flake.nix to the next release and redeploy."
fi

if [ "$new" = "$current" ]; then
  say "already up to date"
  erpnext-ping update "$status" <"$log"
  exit 0
fi

# exit 4 = "some unit failed", also when it had already failed before: wait_healthy judges new failures
switch() {
  local rc=0
  run "$1/bin/switch-to-configuration" switch || rc=$?
  [ "$rc" -eq 0 ] || [ "$rc" -eq 4 ]
}

before=$(problems)
nix-env -p "$profile" --set "$new"
if ! switch "$new" || ! wait_healthy "$before"; then
  say "rolling back to $current"
  nix-env -p "$profile" --set "$current"
  switch "$current" || say "rollback switch reported errors, check the server"
  erpnext-ping update fail <"$log"
  exit 1
fi
say "updated to $new"

booted=$(readlink /run/booted-system/{initrd,kernel,kernel-modules} || true)
built=$(readlink /run/current-system/{initrd,kernel,kernel-modules} || true)
if [ "$REBOOT" = 1 ] && [ "$booted" != "$built" ]; then
  say "kernel changed, rebooting"
  erpnext-ping update "$status" <"$log"
  systemctl reboot
  exit 0
fi
erpnext-ping update "$status" <"$log"
