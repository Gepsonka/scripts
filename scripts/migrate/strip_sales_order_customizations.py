# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Restore stock ERPNext Sales Order / Sales Order Item.

Background
----------
The scripts app used to customize Sales Order via fixtures:

  - 1x Sales Order Custom Field (custom_foglalás)
  - 11x Sales Order Item Custom Fields (custom_anyagfoglalas,
    custom_anyag, custom_kidolgozasok, custom_fazon, custom_szett,
    custom_meret, custom_merettabla, custom_vendeganyag, fabric,
    finishing, + section break)
  - 2x Client Scripts (Sales Order-Custom-Buttons,
    Sales Order Item-Auto-Fill)
  - 1x field_order Property Setter per doctype (Customize Form layout)
  - 1x validate doc_event (scripts.utils.so_validate.populate_item_defaults)

All of the above were removed from the app source so Sales Order is
plain stock ERPNext again. But `bench migrate` is additive: removing a
fixture from JSON does NOT delete the already-created records in the
database. Without cleanup, existing sites keep the custom columns,
buttons and layout forever.

What this patch does
--------------------
For doctypes ("Sales Order", "Sales Order Item"), it:

  1. Deletes every Custom Field record. (Note: Frappe 16's
     CustomField.on_trash does NOT drop the physical DB column, so
     step 4 below is required - otherwise orphan columns linger and
     `has_column` keeps returning True for dead fields.)
  2. Deletes every Client Script record.
  3. Deletes the `field_order` Property Setter(s) so the form layout
     falls back to the ERPNext standard field order. Other Property
     Setters (e.g. ERPNext's own is_system_generated hidden/print_hide
     flags) are left alone.
  4. Drops the orphan physical columns left by the deleted Custom
     Fields (both columns of still-present docs and the known
     historical ones from docs deleted by an earlier run of this
     patch, including leftover `posa_*` POS Awesome columns).
  5. Clears the doctype cache.

Idempotency
-----------
Safe to re-run: missing records/columns are skipped, and a healthy
stock site is a fast no-op.
"""
import frappe

TARGET_DOCTYPES = ("Sales Order", "Sales Order Item")

# Physical columns ever created by the removed Custom Fields (plus
# orphan `posa_*` leftovers from a previously installed POS app).
# Entries without a backing column (Section Breaks) are harmless:
# the has_column guard skips them. Kept as a fallback because step 1
# deletes the Custom Field docs, so a re-run can no longer discover
# the fieldnames from the database.
KNOWN_ORPHAN_COLUMNS = {
	"Sales Order": [
		"custom_foglalás",
		"posa_coupons",
		"posa_offers",
		"posa_notes",
		"posa_additional_notes_section",
	],
	"Sales Order Item": [
		"custom_anyagfoglalas",
		"custom_section_break_ss33m",
		"custom_anyag",
		"custom_kidolgozasok",
		"custom_fazon",
		"custom_szett",
		"custom_meret",
		"custom_merettabla",
		"custom_vendeganyag",
		"fabric",
		"finishing",
		"posa_row_id",
		"posa_notes",
	],
}


def _drop_column(doctype, fieldname):
	"""Drop one physical column if it exists. Returns True if dropped."""
	try:
		if not frappe.db.has_column(doctype, fieldname):
			return False
	except Exception:
		return False
	table = f"tab{doctype}"
	frappe.db.sql_ddl(f"ALTER TABLE `{table}` DROP COLUMN `{fieldname}`")
	print(f"  - {doctype}.{fieldname}: dropped column")
	return True


def strip_sales_order_customizations():
	"""Delete SO Custom Fields / Client Scripts / field_order setters."""
	deleted_cf = 0
	deleted_cs = 0
	deleted_ps = 0
	dropped_cols = 0
	skipped = 0

	for dt in TARGET_DOCTYPES:
		# 1. Custom Fields (all of them on these doctypes came from
		#    this app or from the uninstalled POS app - stock ERPNext
		#    defines zero Custom Fields here). Collect fieldnames
		#    first so we can drop their columns in step 4.
		pending_columns = list(KNOWN_ORPHAN_COLUMNS.get(dt, []))
		for cf in frappe.get_all(
			"Custom Field", filters={"dt": dt}, fields=["name", "fieldname"]
		):
			pending_columns.append(cf.fieldname)
			frappe.delete_doc("Custom Field", cf.name, ignore_missing=True)
			print(f"  - Custom Field {cf.name}: deleted")
			deleted_cf += 1

		# 2. Client Scripts.
		for name in frappe.get_all("Client Script", filters={"dt": dt}, pluck="name"):
			frappe.delete_doc("Client Script", name, ignore_missing=True)
			print(f"  - Client Script {name}: deleted")
			deleted_cs += 1

		# 3. field_order layout override only. Anything else (ERPNext
		#    system setters) stays so we converge on stock, not on empty.
		for name in frappe.get_all(
			"Property Setter",
			filters={"doc_type": dt, "property": "field_order"},
			pluck="name",
		):
			frappe.delete_doc("Property Setter", name, ignore_missing=True)
			print(f"  - Property Setter {name}: deleted")
			deleted_ps += 1

		# 4. Drop orphan physical columns (see note in step 1).
		for fieldname in dict.fromkeys(pending_columns):
			if _drop_column(dt, fieldname):
				dropped_cols += 1

		frappe.clear_cache(doctype=dt)
		skipped += 1

	frappe.db.commit()
	print(
		"scripts.migrate.strip_sales_order_customizations: "
		f"deleted {deleted_cf} custom fields, {deleted_cs} client scripts, "
		f"{deleted_ps} property setters, dropped {dropped_cols} columns "
		f"(checked {skipped} doctypes)"
	)


def execute():
	"""
	Frappe patch entry point. `patches.txt` lists the patch as
	`scripts.migrate.strip_sales_order_customizations`; Frappe's
	patch_handler automatically appends `.execute` and resolves it via
	`frappe.get_attr`, so this thin wrapper is the function that gets
	invoked.
	"""
	strip_sales_order_customizations()
