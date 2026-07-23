"""Patches `get_item_price` to include variant->template fallback.

Installed at app startup via ``scripts/__init__.py`` so that EVERY call to
``erpnext.stock.get_item_details.get_item_price`` automatically falls
back to the template item's price when the variant has none.
"""

import frappe


_original = None


def _install_original():
	"""Lazy-import and cache the original ERPNext function."""
	global _original
	if _original is not None:
		return
	from erpnext.stock.get_item_details import get_item_price as _orig

	_original = _orig


def get_item_price(pctx, item_code, ignore_party=False, force_batch_no=False):
	"""Wrapper that adds variant->template price fallback."""
	_install_original()
	result = _original(pctx, item_code, ignore_party=ignore_party, force_batch_no=force_batch_no)

	if result:
		return result

	template_code = frappe.db.get_value("Item", item_code, "variant_of")
	if template_code:
		result = _original(pctx, template_code, ignore_party=ignore_party, force_batch_no=force_batch_no)

	return result


def install():
	"""Replace ``get_item_price`` in the erpnext module.

	The original is captured *before* the replacement so that the
	import inside ``_install_original`` picks up the real ERPNext
	function, not our wrapper.
	"""
	_install_original()
	import erpnext.stock.get_item_details as gid

	gid.get_item_price = get_item_price
