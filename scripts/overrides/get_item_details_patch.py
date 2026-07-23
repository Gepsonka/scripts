"""Patches `get_item_price` to include variant->template fallback.

Imported at app startup via `scripts.hooks.setup` so that EVERY call to
`erpnext.stock.get_item_details.get_item_price` automatically falls
back to the template item's price when the variant has none.
"""

import frappe
from erpnext.stock.get_item_details import get_item_price as _original_get_item_price


_original = _original_get_item_price


def get_item_price(pctx, item_code, ignore_party=False, force_batch_no=False):
	"""Wrapper that adds variant->template price fallback.

	After calling the original function, if no price was found AND
	the item is a variant (has a ``variant_of``), the query is retried
	with the template item's code.
	"""
	result = _original(pctx, item_code, ignore_party=ignore_party, force_batch_no=force_batch_no)

	if result:
		return result

	# No direct price — try the template item.
	template_code = frappe.db.get_value("Item", item_code, "variant_of", cache=True)
	if template_code:
		result = _original(pctx, template_code, ignore_party=ignore_party, force_batch_no=force_batch_no)

	return result


def install():
	"""Apply the patch by replacing the function in the module."""
	import erpnext.stock.get_item_details as gid

	gid.get_item_price = get_item_price
