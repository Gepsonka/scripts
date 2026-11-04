# Run by erpnext-bootstrap.service (see default.nix). Idempotent: safe to re-run on every boot/switch.
# Inputs come from environment variables set in the unit. writeShellApplication adds `set -euo pipefail`.

apply() { kubectl apply --server-side --force-conflicts -f "$@"; }

# mk_secret <namespace> <name> key=file:/path | key=lit:value ...
# Builds the Secret with jq so values never appear in process arguments, and trailing newlines
# from the agenix files are stripped (a stray "\n" in a password would break logins).
mk_secret() {
  local ns="$1" name="$2"
  shift 2
  local -a args=()
  # shellcheck disable=SC2016  # $name/$ns are jq variables, not shell ones
  local filter='{apiVersion:"v1",kind:"Secret",type:"Opaque",metadata:{name:$name,namespace:$ns},stringData:{}}'
  local i=0 item key src
  for item in "$@"; do
    key="${item%%=*}"
    src="${item#*=}"
    case "$src" in
      file:*)
        args+=(--rawfile "v$i" "${src#file:}")
        filter+=" | .stringData[\"$key\"] = (\$v$i | rtrimstr(\"\\n\"))"
        ;;
      lit:*)
        args+=(--arg "v$i" "${src#lit:}")
        filter+=" | .stringData[\"$key\"] = \$v$i"
        ;;
      *)
        echo "mk_secret: bad item '$item'" >&2
        return 1
        ;;
    esac
    i=$((i + 1))
  done
  jq -n --arg ns "$ns" --arg name "$name" "${args[@]}" "$filter" | apply -
}

echo "==> waiting for the k3s API"
until [ -s "$KUBECONFIG" ] && kubectl get --raw=/readyz >/dev/null 2>&1; do sleep 5; done
kubectl wait --for=condition=Ready node --all --timeout=600s

echo "==> namespaces"
apply "$NAMESPACES_MANIFEST"

echo "==> secrets (from agenix)"
mk_secret "$NS_DB" erpnext-credentials \
  "mysql-root-password=file:$F_MYSQL_ROOT_PASSWORD" \
  "site-db-password=file:$F_SITE_DB_PASSWORD"

mk_secret "$NS_SITE" prod-site-db \
  "host=lit:$DB_HOST" \
  "port=lit:3306" \
  "database=lit:$DB_NAME" \
  "username=lit:$DB_USER" \
  "password=file:$F_SITE_DB_PASSWORD"
mk_secret "$NS_SITE" prod-site-admin-password "password=file:$F_ADMIN_PASSWORD"
mk_secret "$NS_SITE" prod-site-encryption-key "encryption_key=file:$F_ENCRYPTION_KEY"
mk_secret "$NS_SITE" r2-backup-credentials \
  "access-key-id=file:$F_R2_ACCESS_KEY_ID" \
  "secret-access-key=file:$F_R2_SECRET_ACCESS_KEY"

echo "==> frappe-operator"
apply "$OPERATOR_MANIFEST"
kubectl wait --for=condition=Established crd --all --timeout=180s
kubectl -n frappe-operator-system rollout status deploy/frappe-operator-controller-manager --timeout=900s

echo "==> mariadb"
apply "$MARIADB_MANIFEST"

echo "==> bench, site, backups"
# The tag in settings.nix is the first install only. Afterwards erpnext-image-update moves the bench to
# newer builds: keep the image it runs now (bench and the R2 push job) instead of resetting it.
current=$(kubectl -n "$NS_SITE" get frappebench "$BENCH" -o jsonpath='{.spec.imageConfig.tag}' 2>/dev/null || true)
if [ -n "$current" ]; then
  echo "    keeping the running image $IMAGE_REPO:$current"
  jq --arg tag "$current" --arg repo "$IMAGE_REPO" '
    (.items[] | select(.kind == "FrappeBench") | .spec.imageConfig.tag) = $tag
    | (.items[] | select(.kind == "CronJob") | .spec.jobTemplate.spec.template.spec.containers[].image)
      |= if startswith($repo + ":") then $repo + ":" + $tag else . end' "$FRAPPE_MANIFEST" | apply -
else
  apply "$FRAPPE_MANIFEST"
fi

echo "==> done. Site init runs inside the cluster, follow it with: kubectl -n $NS_SITE get pods,frappesite"
