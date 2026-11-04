# erpnext-health: one line per problem, "<check>: <details>", and exit 1. Silent with exit 0 when healthy.
# The part before ":" is stable per problem (watchdog.sh and auto-update.sh compare on it).
# Inputs come from environment variables set in default.nix. writeShellApplication adds `set -euo pipefail`.

problems=()
fail() { problems+=("$1: $2"); }
# add problem lines from stdin
add() {
  local l
  while IFS= read -r l; do [ -n "$l" ] && problems+=("$l"); done
  return 0
}

# ---- systemd: the core services run, and nothing is in the failed state ----------------------
for u in $REQUIRED_UNITS; do
  systemctl is-active --quiet "$u" || fail "unit-$u" "$(systemctl is-active "$u" || true)"
done
add < <(systemctl list-units --state=failed --plain --no-legend | awk '{ print "failed-" $1 ": unit failed" }')

# ---- Kubernetes: node healthy, every Deployment/StatefulSet fully ready ----------------------
if ! nodes=$(kubectl get nodes -o json 2>/dev/null); then
  fail k8s-api "kubectl cannot reach the k3s API server"
else
  add < <(jq -r '.items[] | .metadata.name as $n | .status.conditions[]
    | select((.type == "Ready" and .status != "True") or (.type != "Ready" and .status == "True"))
    | "node-\($n)-\(.type): \(.message)"' <<<"$nodes")
  add < <(kubectl get deployments,statefulsets -A -o json | jq -r '.items[]
    | select((.spec.replicas // 1) > (.status.readyReplicas // 0))
    | "\(.kind | ascii_downcase)-\(.metadata.namespace)/\(.metadata.name): \(.status.readyReplicas // 0)/\(.spec.replicas // 1) ready"')
  # daily jobs (backup, R2 push): a successful run within 26h, once the CronJob is older than that
  add < <(kubectl get cronjobs -n "$NS_SITE" -o json | jq -r --argjson now "$(date +%s)" '.items[]
    | select(.spec.suspend != true and (.spec.schedule | test("^\\S+ \\S+ \\* \\* \\*$")))
    | select($now - (.metadata.creationTimestamp | fromdate) > 93600)
    | select(.status.lastSuccessfulTime == null or $now - (.status.lastSuccessfulTime | fromdate) > 93600)
    | "job-\(.metadata.name): no successful run in 26h (last: \(.status.lastSuccessfulTime // "never"))"')
fi

# ---- ERPNext answers through Traefik, the same path cloudflared uses ------------------------
if ! out=$(curl -sS -m 15 -H "Host: $SITE_NAME" "http://$TRAEFIK_IP/api/method/ping" 2>&1) || [[ $out != *pong* ]]; then
  fail erpnext-http "ping via Traefik failed: ${out:0:200}"
fi

# ---- remote access and disk ----------------------------------------------------------------
state=$(tailscale status --json 2>/dev/null | jq -r .BackendState || true)
[ "$state" = Running ] || fail tailscale "state ${state:-unknown} (expired auth key? see journalctl -u tailscaled-autoconnect)"

# a full disk is what takes k3s down (disk-pressure eviction), warn well before
while read -r mount pct; do
  [ "${pct%\%}" -lt "$DISK_LIMIT" ] || fail "disk-$mount" "$pct used"
done < <(df --output=target,pcent / /boot | tail -n +2)

[ ${#problems[@]} -eq 0 ] && exit 0
printf '%s\n' "${problems[@]}"
exit 1
