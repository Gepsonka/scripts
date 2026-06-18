# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
The actual post-migrate self-heal patch.

`patches.txt` lists this as
`scripts.migrate.reattach_standard_erpnext_doctypes`; Frappe's
patch_handler automatically appends `.execute` and resolves it via
`frappe.get_attr`, so this module must expose a function called
`execute` (the canonical name Frappe uses for patch entry points).
"""
import frappe

from scripts.migrate._constants import ERP_NEXT_DOCTYPE_MODULE


def reattach_standard_erpnext_doctypes():
	"""
	For every doctype in ERP_NEXT_DOCTYPE_MODULE, ensure the `tabDocType`
	row is owned by the canonical ERPNext module and is no longer
	marked as `custom`.

	Why we keep data instead of deleting the DocType row:
	  Earlier iterations of this app shipped a fully populated custom
	  `Item` doctype with thousands of real records. Deleting the row
	  via `frappe.delete_doc("DocType", "Item", ...)` would cascade
	  and destroy that data, which is unacceptable. Re-pointing the
	  `module` column instead makes Frappe resolve the doctype to the
	  ERPNext standard definition on the next request, while preserving
	  every existing row in `tabItem`, `tabItem Price`, etc.

	Why we also force `custom = 0`:
	  The custom flag is what triggers Frappe's per-doctype
	  customisations (load_custom_script, add_html_templates on a
	  per-app doctype folder, etc.). A custom doctype that lives in
	  the Stock module would have its stock doctype folder looked up
	  against the scripts app and crash the same way. Resetting the
	  flag tells Frappe "this is a standard doctype, load the standard
	  assets and nothing else".

	Idempotency:
	  The SELECT guard at the top of the function bails out early when
	  every affected doctype already points to its canonical module,
	  so re-running the patch on a healthy site is a single SELECT
	  with no side effects.
	"""
	# Bail out fast if everything is already healthy. This is the
	# common case once the patch has run on a given site, so we keep
	# the fast path cheap.
	#
	# We consider a site "healthy" when every doctype in the map is
	# either (a) absent from the database (it will be created later by
	# the normal migration, with the right module), or (b) present and
	# pointing at its canonical ERPNext module. Only when at least one
	# present row points at the wrong module do we proceed to the
	# repair loop.
	placeholders = ", ".join(["%s"] * len(ERP_NEXT_DOCTYPE_MODULE))
	healthy = frappe.db.sql(
		f"""
		SELECT name, module FROM `tabDocType`
		WHERE name IN ({placeholders})
		""",
		tuple(ERP_NEXT_DOCTYPE_MODULE.keys()),
		as_dict=True,
	)
	current = {row["name"]: row["module"] for row in healthy}
	has_orphan = any(
		current.get(name) not in (None, target_module)
		for name, target_module in ERP_NEXT_DOCTYPE_MODULE.items()
	)
	if not has_orphan:
		print(
			"scripts.migrate.reattach_standard_erpnext_doctypes: all doctypes "
			"already healthy, nothing to do"
		)
		return

	for doctype, target_module in ERP_NEXT_DOCTYPE_MODULE.items():
		# Skip doctypes that don't exist on this site (e.g. a fresh
		# install where Item Price hasn't been created yet because no
		# pricelist exists). `bench migrate` will create them later
		# with the correct module.
		if not frappe.db.exists("DocType", doctype):
			print(f"  - {doctype}: not present on this site, skipping")
			continue

		meta = frappe.get_meta(doctype)
		row_count = frappe.db.count(doctype)
		print(
			f"  - {doctype}: module={meta.module!r} custom={meta.custom} rows={row_count}"
		)

		# Preserve data: never delete the DocType row, just rewrite the
		# module and custom columns. The next request to
		# frappe.desk.form.load.getdoctype will then resolve the path
		# via ERPNext's standard module and find the doctype folder.
		frappe.db.sql(
			"""
			UPDATE `tabDocType`
			SET module = %(module)s, custom = 0
			WHERE name = %(doctype)s
			""",
			{"doctype": doctype, "module": target_module},
		)
		# Drop the doctype meta cache so the next read reflects the
		# change immediately. Without this, the worker may keep using
		# the cached FormMeta for the rest of the request.
		frappe.clear_cache(doctype=doctype)
		print(f"    -> set module={target_module!r} custom=0 (preserved {row_count} rows)")

	frappe.db.commit()


def execute():
	"""
	Frappe patch entry point. `patches.txt` lists the patch as
	`scripts.migrate.reattach_standard_erpnext_doctypes`; Frappe's
	patch_handler automatically appends `.execute` and resolves it via
	`frappe.get_attr`, so this thin wrapper is the function that gets
	invoked.
	"""
	reattach_standard_erpnext_doctypes()
