# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Migration helpers for the scripts app.

The scripts app historically shipped its own copies of a few standard
ERPNext doctypes (Item, Item Price, Sales Order, Sales Order Item,
Purchase Receipt, Purchase Receipt Item, plus more recently BOM, Work
Order, Work Order Item, and Project) under the "Scripts" module. Those
custom doctypes have since been removed from the app source in favor of
the ERPNext standard doctypes plus a set of fixtures (Custom Field /
Property Setter / Client Script). The Python logic that used to live
on the deleted subclasses now runs as doc_events in:

  - scripts/utils/bom_autoname.py       (BOM.before_naming)
  - scripts/utils/so_validate.py        (Sales Order.validate)
  - scripts/utils/wo_overrides.py       (Work Order.validate)

Because `bench migrate` is additive and never deletes a DocType that
already exists in the database, sites that were migrated while the
custom versions were still present keep the *orphan* DocType rows
with `module = "Scripts"`. At runtime that breaks
`frappe.desk.form.load.getdoctype` (and any other path that calls
`get_module(self.module)` for one of these doctypes): the path
resolver looks under `apps/scripts/scripts/scripts/doctype/<name>/`,
finds nothing, and raises `FileNotFoundError`.

The functions in this package repair that state by re-pointing the
canonical ERPNext doctypes back to their original modules and
resetting `custom=0`. They are idempotent and safe to run on any
site, and are also wired up as a `post_model_sync` patch in
`patches.txt` so production sites self-heal on the next
`bench migrate`.

The patch registered in patches.txt is
`scripts.migrate.reattach_standard_erpnext_doctypes`. Frappe's
patch_handler automatically appends `.execute` and resolves it via
`frappe.get_attr`, so the function on the submodule must be named
`execute` (not the submodule's own name).
"""
from scripts.migrate._constants import ERP_NEXT_DOCTYPE_MODULE
from scripts.migrate.reattach_standard_erpnext_doctypes import (
	reattach_standard_erpnext_doctypes,
	execute,
)


__all__ = [
	"ERP_NEXT_DOCTYPE_MODULE",
	"reattach_standard_erpnext_doctypes",
	"execute",
	"remove_custom_item_doctype",
]


def remove_custom_item_doctype():
	"""
	Backwards-compatible alias for the original manual migration. The
	scripts app's first attempt at this fix was a one-off Item-only
	helper that printed messages and returned; some deployment notes
	still reference `bench execute scripts.migrate.remove_custom_item_doctype`.
	Keep that entry point working so operators who run it manually get
	the new generalised behaviour.
	"""
	reattach_standard_erpnext_doctypes()
