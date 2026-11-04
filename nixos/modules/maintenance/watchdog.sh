# erpnext-watchdog: runs erpnext-health every 5 minutes (timer in default.nix) and reports to healthchecks:
#   healthy                               -> ok ping
#   a problem seen in 2 runs in a row     -> fail ping with the problem list  => "down" email
#   a problem seen once                   -> no ping yet (filters blips, the grace period covers the gap)
# If the server or its network dies, the pings stop and healthchecks emails after the grace period.

state="$STATE_DIRECTORY/last-problems"

# the weekly update and an image deploy restart services, check health themselves, and report on their
# own checks
for u in erpnext-auto-update erpnext-image-update; do
  if [ "$(systemctl show -P ActiveState "$u.service")" = activating ]; then
    echo "$u running, health is checked by it" | erpnext-ping health ok
    exit 0
  fi
done

if report=$(erpnext-health); then
  rm -f "$state"
  erpnext-ping health ok </dev/null
  exit 0
fi

echo "$report"
keys=$(cut -d: -f1 <<<"$report" | sort -u)
previous=$(cat "$state" 2>/dev/null || true)
printf '%s\n' "$keys" >"$state"
if [ -z "$(comm -12 <(printf '%s\n' "$keys") <(printf '%s\n' "$previous"))" ]; then
  echo "new problem, alerting if it is still there in the next run"
  exit 0
fi
printf '%s\n\n%s\n' "$report" "Details: ssh in (LAN or tailscale ssh admin@$HOSTNAME), then: erpnext-health; journalctl -b" |
  erpnext-ping health fail
