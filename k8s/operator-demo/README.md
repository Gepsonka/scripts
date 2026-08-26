# k3s demo deployment — frappe-operator

Demo deployment strategy for ERPNext + the `scripts` app on a local k3s
(developed against [OrbStack Kubernetes](https://docs.orbstack.dev/kubernetes/)),
managed by the [vyogotech frappe-operator](https://github.com/vyogotech/frappe-operator).

**Migrating the production bare-metal k3s deployment to this strategy?
Read [MIGRATION.md](./MIGRATION.md).**

## Why this exists (the stale-cache problem)

The previous deployment (`deployment/frappe-bench` + CI-driven
`kubectl set image`) had recurring "the new feature is in the image but
doesn't work after deploy" issues: browsers/pods kept serving old assets
and cached metadata. This strategy makes the whole update path
declarative and automatic:

1. **Immutable image tags** — every build gets a fresh tag (`demo`,
   `demo2`, `build-NNN`, ...). Never move a tag to new content.
2. **The FrappeBench spec is the source of truth** — an upgrade is a
   one-line change to `spec.imageConfig.tag` (see `upgrade.sh`).
3. **The operator does the rest**:
   - re-runs the bench init job with the new image, re-syncing
     `/home/frappe/assets_cache` → `sites/assets` on the shared PVC
     (assets are baked into the image at build time; the Dockerfile
     `touch`es `scripts/public/**` so nginx serves a fresh
     `Last-Modified` and browsers revalidate — no `?v=` buster needed);
   - rolling-updates gunicorn, nginx, socketio, scheduler and workers;
   - re-runs each site's init job in upgrade mode: `bench migrate`,
     app install, admin-password sync, then `bench clear-cache` with a
     Redis-flush fallback (preserves sessions).

No more manual `bench migrate` / `bench clear-cache` exec loops.

## Architecture

```
ingress-nginx (LoadBalancer, *.k8s.orb.local)
      │
      ▼
scripts-bench-nginx ──────► scripts-bench-gunicorn ──► MariaDB (mariadb-operator)
      │                        ├─ scheduler               (per-site DB+user,
      ├─ socketio              ├─ worker-default/short/long  provisioned by the
      └─ redis (cache+queue)   └─ shared sites PVC            frappe-operator)
```

Managed objects (this directory, `kubectl apply -k`):

- `00-namespace.yaml` — `frappe-demo`
- `01-mariadb.yaml` — shared MariaDB 10.11 (mariadb-operator CR) + root secret
- `02-bench.yaml` — `FrappeBench/scripts-bench` (image, apps, sizing, UID 1000)
- `03-site.yaml` — `FrappeSite/demo-site` (`demo.k8s.orb.local`, apps
  `erpnext` + `scripts`, shared DB mode, nginx ingress) + admin secret

## Images

Two-stage build, run from the repo root:

```bash
# 1. Production image (bench + apps + built assets) — same as CI
docker build -f docker/Dockerfile -t erpnext-scripts:demo .

# 2. Operator-compatible variant (thin layer: asset cache location,
#    operator entrypoint, nginx template, runtime utils)
docker build -f docker/Dockerfile.operator \
  --build-arg BASE_IMAGE=erpnext-scripts:demo \
  -t erpnext-scripts-operator:demo .
```

OrbStack Kubernetes shares the Docker image store, so local tags are
usable directly — no registry needed. Keep `pullPolicy: IfNotPresent`
and never use `:latest`.

## Deploy (fresh cluster)

```bash
./deploy.sh
```

Installs ingress-nginx, mariadb-operator (+CRDs), the frappe-operator,
then applies this kustomization and waits for the bench and site to
become Ready. Requires `kubectl` and `helm`.

When done: `http://demo.k8s.orb.local`, login `Administrator` / `admin`.

## Upgrade (the demo's point)

```bash
# build a new tag, then:
./upgrade.sh demo2
```

Patches `spec.imageConfig.tag` and watches the operator re-sync assets,
roll components, migrate the site DB and clear caches.

## Verify a rollout is really fresh

```bash
# asset sync + config happened with the NEW image
kubectl -n frappe-demo logs job/scripts-bench-init | tail

# migrate + cache clear ran for the site
kubectl -n frappe-demo logs job/demo-site-init | tail

# all components run the new tag
kubectl -n frappe-demo get pods -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.containers[*].image}{"\n"}{end}'

# scripts app assets serve with a current Last-Modified
curl -sI http://demo.k8s.orb.local/assets/scripts/js/qz_utils.js | grep -i last-modified
```

## Notes / limits of this demo

- KEDA autoscaling is off (static 1 replica per component).
- `deploy.sh` patches the operator's ClusterRole to add `pods,pods/log`
  permissions — the static `install.yaml` (v4.1.2) lacks them, which
  stalls site deletions and pod watches.
- Operator quirks found during the dev production migration:
  - Site deletion is destructive to the DB: the finalizer runs
    `bench drop-site --force --no-backup`. Remove the finalizer
    (`{"metadata":{"finalizers":[]}}` merge patch) before deleting a
    FrappeSite whose DB you keep — and re-check, the operator re-adds
    it while the object isn't terminating.
  - A FrappeSite whose site dir exists on the PVC but lacks
    `.init_complete` is treated as a failed half-install: the operator
    deletes the dir and runs `bench new-site`. Always
    `touch sites/<site>/.init_complete` (UID 1000) when migrating an
    existing site.
  - Ingress is only created, never updated ("Ingress already exists").
    To change TLS/annotations on a Ready site: delete the Ingress and
    bump the CR generation (any `spec` change) so it gets recreated.
    `tls` lives at `spec.tls`, NOT `spec.ingress.tls`.
  - A bench image bump alone does NOT re-run site init jobs. Site
    upgrades (bench migrate + cache clear) require bumping the
    `frappe.io/site-version` annotation on the FrappeSite AFTER the
    bench reports the new `initializedImage`. `upgrade.sh` and
    `deploy.yml` do this; forgetting it means new code with an
    unmigrated DB.
- Create or upgrade FrappeSites only AFTER the bench reports Ready with
  the new image tag; a site created mid-bench-upgrade can get an init
  job with the old image and end up terminally Failed (delete and
  recreate the FrappeSite to recover).
- QZ Tray printing needs the `qz-tray` secret (see `../qz-secret.yaml`);
  apply it into `frappe-demo` and mount it per `../qz-secret-patch.yaml`
  (adapt deployment name to `scripts-bench-gunicorn`).
- Single-node storage (`local-path`, RWO) — fine for k3s/OrbStack, not
  for multi-node.
- Demo passwords are in plaintext manifests on purpose.
- The `scripts` app fixtures must not reference other apps' DocTypes:
  POS Awesome's `posa_*` fields were removed from
  `scripts/fixtures/custom_field.json` because they broke clean installs
  (POS Awesome creates those fields itself).
