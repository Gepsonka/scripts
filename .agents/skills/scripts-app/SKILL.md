---
name: scripts-app
description: Map of the "scripts" Frappe app — ERPNext v16 customizations for a made-to-order suit/garment business (custom doctypes, overrides, whitelisted API, QZ Tray barcode printing, Docker/CI/k8s deployment). Load before changing any code in this repo.
type: prompt
whenToUse: When working on this repository — editing Python hooks/overrides/utils, client JS, fixtures, custom doctypes, Docker/CI/deployment, or debugging production behavior of the scripts app
---

# scripts — ERPNext customization app

Customizes ERPNext v16 for a made-to-order suit/garment manufacturer. Sales Order rows carry fabric (`custom_anyag`/`fabric`), finishing (`custom_kidolgozasok`/`finishing`), style (`custom_fazon`) and size (`custom_meret`); Work Orders are generated per SO row with a fabric+finishing-matched BOM; the `ANYAG` template fabric in BOMs is swapped for the chosen fabric; physical stock reservations move material to a reserved warehouse via Stock Entry; Bin barcode labels print to a Zebra ZD220 via QZ Tray.

Naming is mixed Hungarian/English — doctype names and many msgprint/log strings are Hungarian (Fazon = style/cut, Kidolgozás = finishing/workmanship, Mérettábla = size chart, Szedés = size breakdown, vendéganyag = customer-supplied fabric). Keep them intact: BOM autoname embeds the Kidolgozas record name.

## Layout

- `scripts/hooks.py` — all wiring: `override_doctype_class` (Item, Item Price), `doc_events` (Purchase Receipt, Sales Order, Work Order, BOM), fixtures (Client Script, Custom Field, Property Setter), `app_include_js` (qz_utils, bin_list), `doctype_js` (Item, Stock Entry, Item Price), jinja method `scripts.utils.barcode_svg`, and the price-patch bootstrap at the bottom.
- `scripts/api.py` — whitelisted endpoints (see below).
- `scripts/overrides/` — `item.py` (autoname: 6-digit zero-padded numeric item codes via `SELECT MAX...FOR UPDATE`; variants never keep template codes; validate also appends the item code as a `barcodes` row (barcode_type `CODE-39`, UOM = item's `stock_uom`) so scan-barcode fields resolve new items immediately), `item_price.py` (re-allows Item Prices on template items), `get_item_details_patch.py` (monkey-patches `erpnext.stock.get_item_details.get_item_price` with variant→template price fallback).
- `scripts/utils/` — `so_validate.py` (fills SO row item defaults), `wo_overrides.py` (re-implements WO `set_required_items` + operations; **clears and rebuilds `required_items` on every validate**), `bom_autoname.py` (`BOM-{item}-{kidolgozas}-{hash}` for items under the "Products" group), `pr_cancel_reset_barcode.py`, `item_naming.py`; `barcode_svg()` in `utils/__init__.py` (CODE128 SVG).
- `scripts/scripts/` — module content: `fabric_length_propagation_pr.py` (PR on_submit copies `custom_width_cm` to Batches), `guest_material_reservation.py`, `work_order_scripts/` (BOM selection, fabric swap, template-item submit block), `utils/merettabla_utils.py`, `custom/` (Customize-Form exports), `report/barcode_labels/`, `doctype/`.
- `scripts/migrate/` — heal patches (see traps).
- `docker/` — production `Dockerfile` (+`entrypoint.sh`/`start.sh`), `Dockerfile.operator` (frappe-operator variant), `operator/` (vendored operator entrypoints), `compile-translations.py`, `apps.json.template`.
- `k8s/` — `qz-secret*.yaml` (QZ Tray signing key/cert), `operator-demo/` (k3s/frappe-operator demo deployment).

## Whitelisted API (`scripts/api.py`)

- `qz_sign(challenge)` — RSA-SHA512 signs QZ Tray challenges; key from `/run/secrets/qz_private_key` (k8s Secret) or `frappe.conf.qz_private_key`. `qz_certificate()` is `allow_guest=True`.
- `create_physical_reservation` / `update_physical_reservation` / `cancel_physical_reservation` — Material Transfer Stock Entries to a reservation warehouse, audit rows in WO `custom_reservation_log`, rewrites WO `source_warehouse` with `ignore_validate_update_after_submit`.
- `generate_work_orders(sales_order)` / `generate_work_orders_from_project(project)` — per-SO-row WO creation with fabric+kidolgozás-matched BOM.
- `get_related_work_orders`, `copy_finishing_details`, `duplicate_sales_orders`, `update_barcode_print_date`, `get_item_translations(_batch)`.
- Also: `scripts.scripts.utils.merettabla_utils.api_get_merettabla_for_fazon`, `...report.barcode_labels.barcode_labels.get_barcode_html`.

## Client JS (`scripts/public/js/`)

`qz_utils.js` (lazy-loads qz-tray from CDN, signs via `scripts.api.qz_sign`, prints ZPL to Zebra ZD220 TCP:9100), `bin_list.js` (Bin list bulk print), `item.js`, `stock_entry.js`, `item_price.js` (removes `has_variants:0` filter so template items can be priced). Most UI buttons live in fixture Client Scripts (`fixtures/client_script.json`) and call the `api.py` endpoints.

## Deployment

- CI (`.github/workflows/`): `docker-build.yml` builds `DOCKERHUB_USERNAME/erpnext-scripts` from `docker/Dockerfile` (frappe `v16.25.0`, erpnext `version-16`, scripts shipped via build context, not apps.json); `deploy.yml` then SSHes to a bastion, `kubectl set image deployment/frappe-bench`, runs `bench migrate` and `bench clear-cache` in the pods; `ci.yml` runs a soft (continue-on-error) bench install test.
- **Cache-busting contract**: `app_include_js` has deliberately NO `?v=` buster. The Dockerfile `touch`es everything under `scripts/public/` at build time so nginx serves fresh `Last-Modified`; browsers revalidate automatically. Do not add a hardcoded version query — and do not remove the `touch` step.
- `k8s/operator-demo/` — operator-based k3s demo (vyogotech frappe-operator). Image variant: `docker/Dockerfile.operator` layers on the production image (assets at `/home/frappe/assets_cache`, operator entrypoint, nginx template). Upgrade flow: bump `spec.imageConfig.tag` on the FrappeBench → operator re-runs the bench init job (asset re-sync to PVC) and rolls all components; then bump the site's `frappe.io/site-version` annotation to the same tag → site init job re-runs (`bench migrate` + cache clear). The annotation bump is REQUIRED — a bench image change alone does not re-run site init. See `k8s/operator-demo/README.md`.
- QZ Tray secrets mount from k8s Secret `qz-tray` at `/run/secrets/` (see `k8s/qz-secret-patch.yaml`).

## Conventions

- Ruff: line-length 110, tabs, double quotes (pyproject.toml). Pre-commit: ruff + prettier + eslint 8.44. Older files (`api.py`, `work_order_scripts/`) still use spaces — match the file you're editing.
- Tests are scaffold stubs only; CI is effectively soft. Verify changes manually on a bench (`development/frappe-bench` in the parent workspace has one).

## Traps (read before editing)

- **Price patch install**: `get_item_details_patch.install()` is registered as a `before_request` hook in hooks.py and must stay that way — in production `get_hooks()` is served from the shared redis cache, so most gunicorn workers never import scripts.hooks and an import-time bootstrap alone leaves them unpatched (this was the 2026-08 "price inheritance broken in dev/prod" bug; `install()` is idempotent and cheap, per-request calls are fine). The import-time bootstrap at the bottom of hooks.py stays only for console/background-job contexts; its `try/except` is required because `bench compile-translations` imports hooks before erpnext is importable. Never remove the try/except or reorder the import.
- **DocEvent order matters**: WO `before_validate` (BOM selection) must run before `validate` (wo_overrides rebuilds `required_items`).
- **Magic names**: logic probes `custom_anyag` vs `fabric`, `custom_kidolgozasok` vs `finishing`, the `ANYAG` template item, and the "Products" item-group root. Renaming any of these breaks BOM matching and fabric propagation.
- **Split custom-field definitions**: some fields live in `fixtures/custom_field.json`, others only in `scripts/scripts/custom/*.json` (e.g. Bin `custom_barcodes_printed_qty`, WO `custom_finishing_detail` / `custom_reservation_log`). Check both before assuming a field exists on a fresh site. POS Awesome's `posa_*` fields were removed from `fixtures/custom_field.json` (2026-07) because POS Awesome creates them on install — they made the app uninstallable on vanilla ERPNext. Never re-add fields whose Link/Table options point to another app's DocTypes.
- **migrate/ patches heal former standard-doctype copies**: `strip_phantom_standard_fields` (pre_model_sync) drops leftover regular fields so fixtures recreate them as Custom Fields; `reattach_standard_erpnext_doctypes` (post_model_sync) re-points DocType modules and forces `custom=0`. Do not re-add custom doctypes named like standard ERPNext doctypes.
- **`material_reservation_from_work_order.py` is a dead stub** — the real reservation code is in `api.py`.
- `guest_material_reservation.py` and `fabric_length_propagation*.py` contain debug `frappe.msgprint` calls.
- **`private-key.pem` is committed at the repo root** (QZ Tray RSA key). It is a real secret in git — don't rotate production against it without updating the `qz-tray` k8s Secret; production reads `/run/secrets/qz_private_key`, not this file.
- **Frappe `unique` checkbox trap**: setting `unique=1` on a standard field via Customize Form (e.g. `Item.item_name`, done site-side via Property Setter, NOT in fixtures) does NOT enforce uniqueness if a same-named non-unique index already exists — frappe's schema sync emits `ADD UNIQUE INDEX IF NOT EXISTS item_name`, which MariaDB no-ops because the non-unique index `item_name` exists. The Property Setter saves (checkbox shows) but duplicates are allowed. Fix at DB level: `ALTER TABLE tabItem DROP INDEX item_name, ADD UNIQUE INDEX item_name (item_name);` (after deduping). Applied 2026-08-12 to `erpnext_prod` and the old prod DB `_7af3a03d56f6b302`. If the dev DB ever gets a unique-index ALTER failing with `Duplicate entry ... for key 'item_name'`, dedupe first (or refresh dev from a prod backup).
