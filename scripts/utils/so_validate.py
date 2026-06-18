# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Sales Order logic ported from `scripts.doctype.sales_order.sales_order`
after we deleted that duplicate doctype folder.

The `validate()` method used to live on a `SalesOrder(Document)` subclass;
now it runs as a `validate` doc_event so it applies to the standard
ERPNext Sales Order DocType without us owning a custom copy of it.
"""
import frappe


def populate_item_defaults(doc, method=None):
	"""
	For each Sales Order Item, fill `item_name`, `stock_uom`, `uom`, and
	`conversion_factor` from the parent Item if those values are missing.

	This used to be `SalesOrder.validate`; running it as a doc_event keeps
	the behaviour identical without us subclassing the standard ERPNext
	SalesOrder class.
	"""
	for item in doc.items:
		if not item.item_code:
			continue
		if item.item_name and item.uom and item.stock_uom and item.conversion_factor:
			continue

		item_defaults = frappe.db.get_value(
			"Item",
			item.item_code,
			["item_name", "stock_uom", "sales_uom"],
			as_dict=True,
		)
		if not item_defaults:
			continue

		if not item.item_name:
			item.item_name = item_defaults.item_name
		if not item.stock_uom:
			item.stock_uom = item_defaults.stock_uom
		if not item.uom:
			item.uom = item_defaults.sales_uom or item_defaults.stock_uom
		if not item.conversion_factor or item.conversion_factor == 0:
			if item.uom == item.stock_uom:
				item.conversion_factor = 1.0
			else:
				cf = frappe.db.get_value(
					"UOM Conversion Factor",
					{"parent": item.item_code, "uom": item.uom},
					"conversion_factor",
				)
				item.conversion_factor = cf or 1.0