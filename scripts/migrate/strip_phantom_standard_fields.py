# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Pre-migration cleanup of "phantom" regular fields left over from the
deleted scripts-module doctypes.

Background
----------
The scripts app historically shipped its own copies of `BOM`, `Sales
Order`, `Sales Order Item`, `Project`, etc. (under the "Scripts"
module). Those doctypes defined a few fields that the standard ERPNext
versions do not have, including:

  - BOM.main_fabric           (Link -> Item)
  - BOM.kidolgozasok          (Link -> Kidolgozas)
  - BOM.custom_kidolgozasok   (Link -> Kidolgozas)
  - Sales Order Item.fabric   (Link -> Item, default "ANYAG")
  - Sales Order Item.finishing(Link -> Kidolgozas)

When we deleted the scripts doctype folders in favour of the stock
ERPNext versions + fixtures, those fields were no longer defined by any
doctype JSON. But because `bench migrate` never *removes* a field row
that already exists in `tabDocType.fields`, the phantom fields stayed
in the database. The new `fixtures/custom_field.json` entries then fail
to apply with:

    ValidationError: A field with the name main_fabric already exists
    in BOM

What this patch does
--------------------
For every (doctype, fieldname) pair below, we:

  1. Check whether the field already exists as a proper Custom Field
     record (i.e. the fixtures have been applied). If so, nothing to
     do.
  2. Check whether the field exists as a *regular* field on the
     DocType's `fields` table (the phantom state). If so, drop it.
  3. The next `bench migrate` run will then succeed in creating the
     Custom Field records from the new fixtures.

Idempotency
-----------
- Fields that are already proper Custom Fields are left alone.
- Fields that do not exist on the doctype at all are left alone (the
  fixtures will create them as proper Custom Fields).
- Fields that exist only as regular fields are removed exactly once.
- The patch is safe to re-run on a healthy site (no-op).
"""
import frappe


# Each entry: (doctype, fieldname). `options` is documented for the
# reviewer only - we never use it programmatically because the field
# row already carries the correct options.
PHANTOM_FIELDS = [
	("BOM", "main_fabric"),
	("BOM", "kidolgozasok"),
	("BOM", "custom_kidolgozasok"),
	("Sales Order Item", "fabric"),
	("Sales Order Item", "finishing"),
]


def strip_phantom_standard_fields():
	"""Remove regular-field rows left over from the old scripts doctypes
	so the new Custom Field fixtures can be applied."""
	stripped = 0
	skipped = 0
	for doctype, fieldname in PHANTOM_FIELDS:
		if not frappe.db.exists("DocType", doctype):
			print(f"  - {doctype}.{fieldname}: doctype not present, skipping")
			skipped += 1
			continue

		# If a Custom Field record already exists, the fixtures have
		# been applied and there is nothing to do.
		if frappe.db.exists("Custom Field", f"{doctype}-{fieldname}"):
			print(f"  - {doctype}.{fieldname}: already a Custom Field, leaving alone")
			skipped += 1
			continue

		dt_doc = frappe.get_doc("DocType", doctype)
		field_row = next((f for f in dt_doc.fields if f.fieldname == fieldname), None)
		if not field_row:
			print(f"  - {doctype}.{fieldname}: no phantom field present, fixtures will create it")
			skipped += 1
			continue

		dt_doc.remove(field_row)
		dt_doc.save()
		frappe.clear_cache(doctype=doctype)
		print(f"  - {doctype}.{fieldname}: stripped phantom regular field")
		stripped += 1

	frappe.db.commit()
	print(
		f"scripts.migrate.strip_phantom_standard_fields: "
		f"stripped {stripped}, skipped {skipped}"
	)


def execute():
	"""
	Frappe patch entry point. `patches.txt` lists the patch as
	`scripts.migrate.strip_phantom_standard_fields`; Frappe's
	patch_handler automatically appends `.execute` and resolves it via
	`frappe.get_attr`, so this thin wrapper is the function that gets
	invoked.
	"""
	strip_phantom_standard_fields()
