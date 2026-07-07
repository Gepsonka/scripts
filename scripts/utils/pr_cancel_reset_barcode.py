# Copyright (c) 2026, asd
# For license information, please see license.txt

"""
Resets the barcode-printed counter on Bin records when a Purchase
Receipt is cancelled.

When a Purchase Receipt is cancelled the stock is returned, but the
``custom_barcodes_printed_qty`` counter on the affected Bin rows stays
at its old value.  If a new Purchase Receipt for the same items arrives
later, the report would wrongly show those barcodes as "already printed"
(``actual_qty <= custom_barcodes_printed_qty``).

This hook zeroes the counter for every (item_code, warehouse) pair that
the cancelled PR touched, so the next receipt starts with a clean slate.
"""

import frappe


def reset_printed_qty_on_cancel(doc, method=None):
	"""Zero custom_barcodes_printed_qty for all item+warehouse
	combinations in the cancelled Purchase Receipt."""
	# In many PRs rows inherit warehouse from parent `set_warehouse` and
	# `item.warehouse` can be empty; include that fallback so cancel always resets.
	affected_pairs = set()
	default_warehouse = getattr(doc, "set_warehouse", None)

	for item in doc.items:
		item_code = item.get("item_code")
		warehouse = item.get("warehouse") or default_warehouse
		if not item_code or not warehouse:
			continue
		affected_pairs.add((item_code, warehouse))

	for item_code, warehouse in affected_pairs:
		frappe.db.sql(
			"""
			UPDATE `tabBin`
			SET custom_barcodes_printed_qty = 0
			WHERE item_code = %(item_code)s
			  AND warehouse = %(warehouse)s
			""",
			{"item_code": item_code, "warehouse": warehouse},
		)
