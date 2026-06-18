# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Shared constants and helpers for the `scripts.migrate` package.

This module exists to break the circular import between
`scripts.migrate.__init__` (which re-exports the patch's public API)
and `scripts.migrate.reattach_standard_erpnext_doctypes` (which needs
to read `ERP_NEXT_DOCTYPE_MODULE` and call `snake_case_to_table_name`).
Both files import from this leaf module instead, so the import graph
stays acyclic.
"""


# Standard ERPNext doctypes that the scripts app used to ship custom
# copies of, mapped to the ERPNext module they belong to.
ERP_NEXT_DOCTYPE_MODULE = {
	"Item": "Stock",
	"Item Price": "Stock",
	"Sales Order": "Selling",
	"Sales Order Item": "Selling",
	"Purchase Receipt": "Buying",
	# Purchase Receipt Item lives under Stock (erpnext.stock.doctype),
	# not Buying - despite the parent Purchase Receipt being a Buying
	# doctype. The earlier version of this map got it wrong, which made
	# `bench migrate` print
	#   Module import failed for Purchase Receipt Item ... No module named
	#   'erpnext.buying.doctype.purchase_receipt_item'
	# every run.
	"Purchase Receipt Item": "Stock",
	# Removed scripts-module duplicates in favour of the standard
	# ERPNext versions + fixtures (Custom Field / Property Setter /
	# Client Script). Logic from the old subclasses now runs as
	# doc_events in scripts/utils/{bom_autoname,so_validate,wo_overrides}.py
	"BOM": "Manufacturing",
	"Work Order": "Manufacturing",
	"Work Order Item": "Manufacturing",
	"Project": "Projects",
}


def snake_case_to_table_name(doctype: str) -> str:
	"""
	Return the physical table name for a given DocType, e.g. "Item Price"
	-> "tabItem Price", "Sales Order Item" -> "tabSales Order Item".

	Frappe's `db.count` needs the literal table name, not the doctype
	name, and doctype names can contain spaces. We deliberately avoid
	`frappe.db.get_tabename` to keep this helper import-light (patches
	run before the app registry is fully populated in some flows).
	"""
	return "tab" + doctype
