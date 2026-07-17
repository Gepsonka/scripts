import frappe
from erpnext.stock.doctype.item.item import Item as ERPNextItem

from scripts.utils.item_naming import get_next_item_code


class CustomItem(ERPNextItem):
	def autoname(self):
		"""Generate a compact 6-digit numeric item code.

		Replaces the default naming-series / variant-abbreviation logic
		with a simple zero-padded sequential number (e.g. ``000001``)
		that fits inside a Code-128 barcode label.

		- **Regular items** — the naming-series code is discarded.
		- **Variants** — the ``template-abbr1-abbr2`` code produced
		  by ``make_variant_item_code`` is discarded.
		- **User-typed codes** (on non-variant items) are preserved.
		"""
		if self.variant_of or not self.item_code or not self.item_code.strip():
			# Always generate a sequential code for:
			#   - variants (overrides make_variant_item_code)
			#   - items without a manually-typed code
			self.item_code = get_next_item_code()
		# else: user typed the code themselves — keep it.

		self.item_code = self.item_code.strip() if self.item_code else self.item_code
		self.name = self.item_code
