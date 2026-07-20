"""Remove stale ``doctype_to_sync`` and ``snapshot_report`` fields from Report.

ERPNext fixtures can introduce table fields whose ``options`` target
a DocType that does not exist in the running Frappe version (e.g.
*Doctype To Sync* was added in a later Frappe release).  Attempting to
open or save a Report that carries those child rows causes an import
error because ``frappe.get_controller("Doctype To Sync")`` fails.

This patch cleans up the stale data and columns so the Report form
works normally again.
"""

import frappe


def execute():
	for field_name in ("doctype_to_sync", "snapshot_report"):
		if not frappe.db.has_column("tabReport", field_name):
			continue

		# 1. Delete child rows from the phantom table field
		frappe.db.sql(f"UPDATE `tabReport` SET `{field_name}` = NULL")

		# 2. Remove the column (safe -- custom app leftovers)
		try:
			frappe.db.sql(f"ALTER TABLE `tabReport` DROP COLUMN `{field_name}`")
		except Exception:
			frappe.log_error(
				f"Could not drop column {field_name} from tabReport",
				title="fix_report_sync_fields",
			)

	# 3. Clean any property setter / custom field remnants
	frappe.db.delete("Custom Field", {
		"dt": "Report",
		"fieldname": ("in", ("doctype_to_sync", "snapshot_report")),
	})
	frappe.db.delete("Property Setter", {
		"doc_type": "Report",
		"field_name": ("in", ("doctype_to_sync", "snapshot_report")),
	})

	frappe.db.commit()
	print("OK: Removed stale doctype_to_sync / snapshot_report fields from Report.")
