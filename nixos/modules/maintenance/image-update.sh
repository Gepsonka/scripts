# erpnext-image-update: deploys new ERPNext builds (timer in default.nix, every 5 minutes).
# The image build of this repo (../.github/workflows/docker-build.yml) builds REPO on every master push and moves the CHANNEL
# tag (latest) to it. This resolves CHANNEL to the immutable build-NNN tag with the same digest and, if
# the bench runs something else, deploys it exactly like the deploy workflow:
#   bench image -> wait for re-init -> site-version annotation (migrate, cache clear) -> wait -> smoke test
# No automatic rollback: a migrated database cannot be undone by switching images back.
# Reports to healthchecks (<host>-image): ok every run, fail with the log when a deploy fails.
# writeShellApplication adds `set -euo pipefail`.

state="$STATE_DIRECTORY"
log=$(mktemp)
trap 'rm -f "$log"' EXIT
say() { echo "$*" | tee -a "$log"; }
run() { "$@" 2>&1 | tee -a "$log"; }

# never together with the weekly OS update, which restarts k3s
exec 9>/run/erpnext-maintenance.lock
flock -n 9 || { echo "weekly update running, next round"; exit 0; }

# an outage of Docker Hub or of k3s is not a failed deploy: skip the round (the watchdog covers k3s)
tags=$(curl -fsS -m 20 "https://hub.docker.com/v2/repositories/$REPO/tags?page_size=100&ordering=last_updated") ||
  { echo "Docker Hub unreachable, next round"; exit 0; }
current=$(kubectl -n "$NS" get frappebench "$BENCH" -o jsonpath='{.spec.imageConfig.tag}' 2>/dev/null) ||
  { echo "no $BENCH yet (first boot?), next round"; exit 0; }

target=$(jq -r --arg ch "$CHANNEL" '
  (.results[] | select(.name == $ch) | .digest) as $d
  | [.results[] | select(.digest == $d and (.name | test("^build-[0-9]+$"))) | .name]
  | max_by(ltrimstr("build-") | tonumber) // empty' <<<"$tags")
if [ -z "$target" ]; then
  say "no build-NNN tag has the digest of $REPO:$CHANNEL"
  erpnext-ping image fail <"$log"
  exit 1
fi

verify() {
  run kubectl -n "$NS" wait --for=jsonpath='{.status.phase}'=Ready "frappesite/$SITE" --timeout=300s &&
    curl -fsS -m 15 -H "Host: $SITE_NAME" "http://$TRAEFIK_IP/api/method/ping" | grep -q pong &&
    [ "$(curl -s -o /dev/null -w '%{http_code}' -m 15 -H "Host: $SITE_NAME" "http://$TRAEFIK_IP/login")" = 200 ]
}

if [ "$current" = "$target" ]; then
  # a deploy that failed earlier stays reported until the site is healthy on it
  if [ "$(cat "$state/attempted" 2>/dev/null)" = "$target" ] && [ "$(cat "$state/verified" 2>/dev/null)" != "$target" ]; then
    say "$target was deployed but never verified, checking again"
    if verify; then
      echo "$target" >"$state/verified"
      say "$target is healthy now"
      erpnext-ping image ok <"$log"
      exit 0
    fi
    say "site still not healthy on $target"
    erpnext-ping image fail <"$log"
    exit 1
  fi
  echo "running $REPO:$target, current" | erpnext-ping image ok
  exit 0
fi

say "deploying $REPO:$target (bench runs $current, $CHANNEL points to $target)"
erpnext-ping image start </dev/null
echo "$target" >"$state/attempted"

deploy() {
  run kubectl -n "$NS" patch frappebench "$BENCH" --type merge \
    -p "{\"spec\":{\"imageConfig\":{\"repository\":\"$REPO\",\"tag\":\"$target\"}}}" &&
    run kubectl -n "$NS" wait --for=jsonpath='{.status.initializedImage}'="$REPO:$target" \
      "frappebench/$BENCH" --timeout=900s &&
    # a bench image change alone does not re-run site init: the annotation triggers migrate + cache clear
    run kubectl -n "$NS" annotate frappesite "$SITE" "frappe.io/site-version=$target" --overwrite &&
    sleep 30 &&
    run kubectl -n "$NS" wait --for=condition=complete "job/$SITE-init" --timeout=900s &&
    verify
}

if deploy; then
  echo "$target" >"$state/verified"
  say "deployed $REPO:$target"
  erpnext-ping image ok <"$log"
else
  say "deploy of $target FAILED, the bench stays on it: check kubectl -n $NS get pods,frappesite,jobs"
  erpnext-ping image fail <"$log"
  exit 1
fi
