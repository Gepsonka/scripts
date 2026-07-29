# Migrating the production k3s deployment to the frappe-operator strategy

Target reader: whoever runs the bare-metal k3s production cluster that
today serves `deployment/frappe-bench` (namespace `default`), updated by
`.github/workflows/deploy.yml` (`kubectl set image` + manual
`bench migrate` / `bench clear-cache`).

Goal: move to operator-managed `FrappeBench` + `FrappeSite` **without
losing the production database, site files, or the site's encryption
key**, and with instant rollback until the new stack is proven.

## Why the old deploys break (and why this fixes it)

The old pipeline has no ordering guarantees: pods with new code start
serving before/while `bench migrate` runs in one pod, `clear-cache` is
best-effort per pod, nothing re-syncs assets into the volume, and the
same image tag can silently change content. Any of these produces
"works in dev, broken in prod".

The operator flow is deterministic: an upgrade is one declarative change
(`spec.imageConfig.tag` → new immutable tag); the operator then
re-syncs assets (bench init job), rolls every component to the same
image, and — once you bump the site's `frappe.io/site-version`
annotation to the same tag (REQUIRED: a bench image change alone does
not re-run site init) — runs the site's init job in upgrade mode:
`bench migrate` + cache clear with Redis-flush fallback. Same image
digest everywhere, every time.

## Strategy: side-by-side (blue/green), keep the database where it is

Do NOT migrate the database in the same step. The operator supports
`dbConfig.provider: external`, pointing at your existing MariaDB with
the existing database and user. That removes the riskiest part of the
migration entirely. (You can adopt mariadb-operator later if you want.)

Both live deployments map onto the operator's multi-bench model — one
bench per environment, each with its own site, sharing the cluster:

```
old stack (namespace default)          new stack
deployment/frappe-bench (prod)         FrappeBench/prod-bench ── FrappeSite/prod-site
  stays, rollback path                   ──► same MariaDB, same prod DB/user
deployment/frappe-bench-dev (dev)      FrappeBench/dev-bench ─── FrappeSite/dev-site
  pilot, migrate it FIRST                ──► same MariaDB, dev DB/user
existing sites PVC(s) ── copy files ─► new bench PVCs (one per bench)
```

Migrate the dev deployment FIRST (Phase 1–3 below applied to dev): it is
expendable, and it validates the operator install, the image pipeline,
secrets, and the file-copy step before you touch prod. Then repeat the
exact same steps for prod.

## Prerequisites

- The image build produces the operator variant too (see "CI changes"
  below) and pushes immutable tags (your `build-NNN` tags already are).
- A full, verified backup: `bench backup --with-files` (or `mysqldump`
  + tarball of `sites/<site>/private|public`) + the site's
  `site_config.json` (contains `encryption_key` — without it, all
  encrypted fields, e.g. stored passwords, are unreadable).
- kubectl access to the prod cluster (you already have the bastion flow).

## Phase 0 — Rehearse on the local demo cluster (optional but cheap)

Restore the prod backup into the OrbStack demo stack as a second site
(`restore.k8s.orb.local`, external DB mode against a throwaway DB).
This exercises every step below except DNS cutover.

## Phase 1 — Stand up the new stack (old one keeps serving)

1. Install the frappe-operator exactly as in `deploy.sh`
   (CRDs + static install + the ClusterRole pods patch — the patch
   matters, without it site deletion hangs). Skip mariadb-operator and
   ingress-nginx if the cluster already has an ingress controller; set
   `spec.ingress.className` accordingly (k3s ships Traefik — use
   `className: traefik` or install ingress-nginx).

2. Create namespace + secrets:

   ```bash
   kubectl create ns frappe-prod

   # existing DB credentials (the user must have full rights on its DB)
   kubectl -n frappe-prod create secret generic prod-site-db \
     --from-literal=host=<mariadb-service-or-IP> \
     --from-literal=port=3306 \
     --from-literal=database=<existing_db_name> \
     --from-literal=username=<existing_db_user> \
     --from-literal=password=<existing_db_password>

   # from the OLD site_config.json — keeps encrypted data readable
   kubectl -n frappe-prod create secret generic prod-site-encryption-key \
     --from-literal=encryption_key=<value from old site_config.json>

   kubectl -n frappe-prod create secret generic prod-site-admin-password \
     --from-literal=password=<current admin password>
   ```

3. Apply `FrappeBench/prod-bench` (copy of `02-bench.yaml`, namespace
   `frappe-prod`, `imageConfig.repository: <dockerhub-user>/erpnext-scripts-operator`,
   `tag:` = the tag of the **currently running, known-good** prod build,
   `pullPolicy: IfNotPresent`, sizing/storage class to match the node).
   Wait for `status.phase: Ready`. Do not create the site yet.

4. Copy site files into the new PVC. Run a temp pod mounting BOTH the
   old sites PVC and the new `prod-bench-sites` PVC and copy:

   ```bash
   # on the temp pod:
   cp -a /old-sites/<site.name>/. /new-sites/<site.name>/
   # keep file permissions; include private/ and public/
   ```

   (The operator mounts the PVC subPath `frappe-sites` as the sites dir;
   inside the bench pods the destination is
   `/home/frappe/frappe-bench/sites/<site.name>`. On single-node k3s
   with local-path storage you can also copy directly on the host
   between the `/var/lib/rancher/k3s/storage/pvc-*` dirs.) You can
   delete `site_config.json` from the copy — the operator rewrites it —
   or keep it; the operator merges and preserves unknown keys.

   **Then, three mandatory fixes learned the hard way on the dev
   migration:**

   a. `touch /new-sites/<site.name>/.init_complete` (owned by UID 1000).
      Without this marker the operator assumes a failed half-install,
      DELETES your copied directory and runs `bench new-site` against
      the existing database — which fails on duplicate rows after
      writing partial data into it.
   b. If the database service lives in a different namespace, edit the
      copied `site_config.json` so `db_host` is the full FQDN
      (`<svc>.<namespace>.svc.cluster.local`). In external-DB mode the
      site init's maintenance path runs `bench migrate` BEFORE updating
      `db_host` from the connection secret, and a short service name
      does not resolve across namespaces.
   c. NEVER `kubectl delete frappesite` for a site whose database you
      want to keep. The operator's finalizer runs a delete job that
      executes `bench drop-site --force --no-backup`. To remove a
      FrappeSite without touching the DB, remove the finalizer first
      and verify no `*-site-delete` job appears — the operator re-adds
      the finalizer if the object isn't terminating yet, so patch, then
      delete, then patch again if needed:
      `kubectl patch frappesite <name> --type merge -p '{"metadata":{"finalizers":[]}}'`

5. Create `FrappeSite/prod-site`:

   ```yaml
   spec:
     benchRef: {name: prod-bench}
     siteName: <your.real.domain>        # must match the Host header
     adminPasswordSecretRef: {name: prod-site-admin-password}
     encryptionKeySecretRef: {name: prod-site-encryption-key, key: encryption_key}
     apps: [erpnext, scripts]            # already installed → no-op
     dbConfig:
       provider: external
       connectionSecretRef: {name: prod-site-db}
     ingress:
       enabled: true
       className: <traefik|nginx>
   ```

   The init job detects the existing site directory and runs the
   "maintenance" path: update config → `bench migrate` (a no-op if the
   tag matches the code the DB is already on) → cache clear. Watch:
   `kubectl -n frappe-prod logs job/prod-site-init -f`.

## Phase 2 — Validate in parallel (old stack still live)

- Browse `https://<your.real.domain>` via the new ingress (or a temp
  `/etc/hosts` / Host-header override before DNS switch).
- Log in, open the doctypes your app customizes (Sales Order, Work
  Order, Bin barcode printing, Item Price on template items), submit a
  test Work Order, check background jobs run (workers/scheduler pods).
- QZ Tray printing: the operator has no extra-volumes field, so the
  `kubectl patch deployment` approach from `../qz-secret-patch.yaml`
  will be reverted by the operator. Instead put the key in
  `site_config.json` — `scripts.api.qz_sign` already falls back to
  `frappe.conf.qz_private_key`:

  ```bash
  kubectl -n frappe-prod exec deploy/prod-bench-gunicorn -- \
    bench --site <your.real.domain> set-config qz_private_key \
    "$(cat private-key.pem)"   # multiline: use --as-json or edit the file
  ```

  (site_config.json lives on the PVC, protected by cluster RBAC; the
  operator's config merge preserves unknown keys, so it survives
  upgrades.)

## Phase 3 — Cutover

1. Lower DNS TTL to ~60s a day before.
2. Point DNS (or the existing ingress host rule) at the new stack.
3. Scale the old deployment to 0 — but keep it, its PVC, and the
   namespace untouched for at least a week as instant rollback.
4. Smoke test again; watch `prod-bench-*` pod logs for a day.

Rollback during the week: scale old deployment back to 1, point DNS
back. (DB schema changes from `bench migrate` in the new stack are the
only non-reversible part — since Phase 1 pins the same image tag the
prod DB already runs, the cutover migrate is a no-op; the first REAL
migrate happens on the next release bump, after you've taken a backup.)

## Phase 4 — New release process (replaces deploy.yml)

IMPLEMENTED in `.github/workflows/` (docker-build.yml + deploy.yml):

1. `docker-build.yml` pushes the base image AND the operator variant
   (`<dockerhub-user>/erpnext-scripts-operator:build-NNN`) on every
   master/dev push. The operator variant wraps the exact base image
   from the same run (`load: true` + `BASE_IMAGE=...:build-NNN`).

2. `deploy.yml` patches the bench `spec.imageConfig` (repository + tag),
   waits for `status.initializedImage`, then bumps the site's
   `frappe.io/site-version` annotation to the same tag (this is what
   actually triggers `bench migrate` + cache clear on the site — a
   bench image change alone does not re-run site init), waits for the
   site init job and Ready phase, then runs smoke checks (ping, login
   200, asset Last-Modified). deploy-dev is active; deploy-prod ships
   disabled (`if: false`) with instructions to enable after Phases 1–3.

   Keep tags immutable — never rebuild the same tag. This matters for
   the current `dev` tag especially: today a push to the dev branch
   moves the `dev` tag to new content, which is exactly the mutable-tag
   trap this strategy removes. Always deploy `build-NNN` tags; treat
   `dev`/`latest` as informational only. (The old Docker-Hub deploy
   watcher cronjob on the server is suspended and superseded by
   deploy.yml.)

3. Use the dev deployment as the release gate (this is what kills
   "breaks in prod but works in dev"). One pipeline, promotion by tag:

   ```text
   push to dev branch ──► build build-NNN ──► patch dev-bench ──► wait Ready
        │                                                   │
        │                                                   ▼
        │                                            smoke checks (login 200,
        │                                            key API endpoints, your
        │                                            critical custom flows)
        ▼                                                   │
   merge to master ──► NO rebuild — patch prod-bench ◄──────┘
                       to the SAME build-NNN tag that
                       passed on dev
   ```

   Prod then runs bit-for-bit the image dev already validated — not a
   fresh rebuild of "the same" source. The dev site's DB should
   periodically be refreshed from a prod backup so dev testing happens
   against prod-shaped data (that is the usual reason a feature works
   locally but misbehaves live).

   Note: sites on the SAME bench share the image — environment
   isolation requires separate benches (dev-bench / prod-bench), not
   just two sites on one bench.

4. Backups: schedule the operator's `SiteBackup` CRD (or keep your
   current mysqldump cron). Take a manual backup before every release
   bump until you trust the flow.

## Phase ordering with two environments

1. Install operator + RBAC patch.
2. Migrate **dev** end-to-end (Phases 1–3 with `dev-bench`/`dev-site`,
   the dev DB, and the dev site's files/encryption key). Dev is
   expendable — if anything goes wrong you lose nothing.
3. Point the CI dev-branch pipeline at `dev-bench` and run one real
   dev release through it.
4. Migrate **prod** (Phases 1–3 with `prod-bench`/`prod-site`).
5. Switch the master pipeline to tag promotion (Phase 4, item 3).

## Checklist summary

- [ ] operator + RBAC patch installed in prod cluster
- [ ] dev-bench + dev-site migrated first (pilot), dev release run through CI
- [ ] prod-bench Ready on the current prod image tag
- [ ] site files copied into the new PVC (per environment)
- [ ] db / encryption-key / admin secrets created (per environment)
- [ ] prod-site Ready, init job migrate was a no-op
- [ ] features validated (incl. QZ printing via site_config key)
- [ ] DNS cutover, old stack scaled to 0 (kept for rollback)
- [ ] CI builds + pushes the operator image variant
- [ ] deploy.yml = single tag patch + waits (per environment)
- [ ] dev bench gates prod releases via immutable-tag promotion; no more mutable `dev`/`latest` deploys
