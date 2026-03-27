# Copyright (c) 2026, asd and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class SalesOrder(Document):
	def validate(self):
		for item in self.items:
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
