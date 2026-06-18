# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
BOM logic ported from `scripts.doctype.bom.bom` after we deleted that
duplicate doctype folder.

The naming rule below used to live on a `BOM(Document)` subclass; now it
runs as a `before_naming` doc_event so it applies to the standard
ERPNext BOM DocType without us owning a custom copy of it.
"""
import frappe


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


def bom_autoname(doc, method=None):
	"""
	Custom naming for BOMs:
	- If item is in a group that is descendant of 'Products':
	  BOM-{item_code}-{finishing_name}-{bom_id}
	- Otherwise: leave name empty so Frappe falls back to the
	  DocType-level autoname.
	"""
	if not getattr(doc, "item", None):
		return

	if not is_item_in_products_group(doc.item):
		return

	# Get finishing name from Kidolgozas
	finishing_name = (
		frappe.db.get_value("Kidolgozas", doc.kidolgozasok, "name")
		or doc.kidolgozasok
	)
	# Generate unique suffix using hash of item + fabric + finishing
	suffix = frappe.generate_hash(length=4)
	# Format: BOM-{item_code}-{finishing_name}-{suffix}
	doc.name = f"BOM-{doc.item}-{finishing_name}-{suffix}"