# Offsite backups → Cloudflare R2

Daily `SiteBackup` schedules (frappe-operator) pushing full site backups
(DB + files) to the `erp-backups` R2 bucket at 02:00 UTC:

- `prod-site-daily.yaml` → namespace `frappe-prod`, site `erp.d-trend.com`
- `dev-site-daily.yaml` → namespace `frappe-dev`, site `dev-erp.d-trend.com`

## Prerequisite: R2 credentials secret (NOT in git)

Each namespace needs a secret named `r2-backup-credentials` with keys
`access-key-id` and `secret-access-key`:

```sh
for ns in frappe-prod frappe-dev; do
  kubectl -n "$ns" create secret generic r2-backup-credentials \
    --from-literal=access-key-id='<R2_ACCESS_KEY_ID>' \
    --from-literal=secret-access-key='<R2_SECRET_ACCESS_KEY>' \
    --dry-run=client -o yaml | kubectl apply -f -
done
```

R2 API tokens are created in the Cloudflare dashboard (R2 → Manage R2 API
Tokens). The bucket endpoint is
`https://<account-id>.r2.cloudflarestorage.com` with `region: auto`.

## Apply

```sh
kubectl apply -f k8s/backups/
kubectl get sitebackups -A
```

## One-shot manual backup (no schedule)

Drop `schedule:` from a copy of the manifest and apply it — the operator
runs it once immediately. Useful to verify R2 connectivity after setup.
