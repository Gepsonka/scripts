"""Patches `get_item_price` to include variant->template fallback.

Installed via the ``before_request`` hook in ``scripts/hooks.py`` so that
EVERY worker process patches ``erpnext.stock.get_item_details.get_item_price``
on its first request (the import-time bootstrap in hooks.py alone is not
reliable: in production get_hooks() comes from the shared redis cache, so
most workers never import scripts.hooks). The wrapper falls back to the
template item's price when the variant has none.
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

	Runs on every request via the ``before_request`` hook, so it must stay
	cheap and idempotent. The ``is`` check does double duty: it skips the
	work once patched AND guarantees ``_install_original`` can never capture
	our own wrapper (which would recurse infinitely).
	"""
	import erpnext.stock.get_item_details as gid

	if gid.get_item_price is get_item_price:
		return

	_install_original()
	gid.get_item_price = get_item_price
