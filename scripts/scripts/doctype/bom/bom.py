# Copyright (c) 2026, asd and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class BOM(Document):
	def autoname(self):
		"""
		Custom naming for BOMs:
		- If item is in a group that is descendant of 'Products': BOM-{item_code}-{finishing_name}-{bom_id}
		- Otherwise: use default naming (autoname from DocType)
		"""
		if not self.item:
			return

		# Check if item is in a group descendant of Products
		if is_item_in_products_group(self.item):
			# Get finishing name
			finishing_name = frappe.db.get_value("Kidolgozas", self.default_finishing, "name") or self.default_finishing
			# Generate unique suffix using hash of item + fabric + finishing
			suffix = frappe.generate_hash(length=4)
			# Format: BOM-{item_code}-{finishing_name}-{suffix}
			self.name = f"BOM-{self.item}-{finishing_name}-{suffix}"
		# If not Products group or missing data, Frappe will use default autoname


def is_item_in_products_group(item_code):
	"""
	Check if an item belongs to 'Products' or any of its descendant item groups.
	"""
	item_group = frappe.db.get_value("Item", item_code, "item_group")
	if not item_group:
		return False

	# Walk up the item group hierarchy
	while item_group:
		if item_group == "Products":
			return True
		parent = frappe.db.get_value("Item Group", item_group, "parent_item_group")
		item_group = parent

	return False
