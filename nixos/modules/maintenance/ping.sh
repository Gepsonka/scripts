# erpnext-ping <check> <ok|start|fail>   (message on stdin)
# Reports to healthchecks.io, which sends the emails. The check is created on first use (?create=1).
# Does nothing without the healthchecks-ping-key secret, and never fails the caller.

check="$1"
kind="$2"
if [ ! -r "$PING_KEY_FILE" ]; then
  echo "alerting off (no healthchecks-ping-key secret): $check $kind" >&2
  cat >/dev/null
  exit 0
fi
case "$kind" in
  ok) suffix="" ;;
  start | fail) suffix="/$kind" ;;
  *) echo "erpnext-ping: bad kind '$kind'" >&2; exit 2 ;;
esac

# the URL holds the ping key: keep it out of logs and process arguments
url="$PING_URL/$(tr -d '[:space:]' <"$PING_KEY_FILE")/$PREFIX-$check$suffix?create=1"
# healthchecks keeps the first 100 kB of a body, the end of a log is what matters
tail -c 90000 | curl -fsS -m 20 --retry 3 -o /dev/null --data-binary @- --config <(printf 'url = "%s"\n' "$url") ||
  echo "erpnext-ping: could not reach $PING_URL ($check $kind)" >&2
exit 0
