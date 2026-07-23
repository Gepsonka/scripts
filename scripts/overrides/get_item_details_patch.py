"""Patches `get_item_price` to include variant->template fallback.

Installed at app startup via ``scripts/__init__.py`` so that EVERY call to
``erpnext.stock.get_item_details.get_item_price`` automatically falls
back to the template item's price when the variant has none.
"""

import frappe


_original = None


def _get_original():
	"""Lazy-import the original function so the module doesn't crash
	the Docker build when erpnext is not yet loaded."""
	global _original
	if _original is None:
		from erpnext.stock.get_item_details import get_item_price as _orig

		_original = _orig
	return _original


def get_item_price(pctx, item_code, ignore_party=False, force_batch_no=False):
	"""Wrapper that adds variant->template price fallback."""
	orig = _get_original()
	result = orig(pctx, item_code, ignore_party=ignore_party, force_batch_no=force_batch_no)

	if result:
		return result

	# No direct price -- try the template item.
	template_code = frappe.db.get_value("Item", item_code, "variant_of")
	if template_code:
		result = orig(pctx, template_code, ignore_party=ignore_party, force_batch_no=force_batch_no)

	return result


def install():
	"""Replace ``get_item_price`` in the erpnext module."""
	import erpnext.stock.get_item_details as gid

	gid.get_item_price = get_item_price
