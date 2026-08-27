import frappe
from erpnext.stock.doctype.item.item import Item as ERPNextItem
from frappe import _

from scripts.utils.item_naming import get_next_item_code


class CustomItem(ERPNextItem):
	def autoname(self):
		"""Generate a compact 6-digit numeric item code.

		Replaces the default naming-series / variant-abbreviation logic
		with a simple zero-padded sequential number (e.g. ``000001``)
		that fits inside a Code-128 barcode label.

		- **Regular items** -- the naming-series code is discarded.
		- **Variants** -- the ``template-abbr1-abbr2`` code produced
		  by ``make_variant_item_code`` is discarded.
		- **User-typed codes** (on non-variant items) are preserved
		  and validated for uniqueness.
		"""
		if self.variant_of or not self.item_code or not self.item_code.strip():
			self.item_code = get_next_item_code()

		self.item_code = self.item_code.strip() if self.item_code else self.item_code
		self.name = self.item_code

	def validate(self):
		"""Extend parent validation with duplicate code check and barcode."""
		super().validate()
		self._validate_item_code_unique()
		self._ensure_item_code_barcode()

	def _ensure_item_code_barcode(self):
		"""Register the item code as a scan-able barcode on creation.

		Every "Scan Barcode" field searches ``tabItem Barcode``, so once the
		final item code exists (autoname has already run), a matching row
		makes the item scannable immediately. The row uses barcode type
		``CODE-39`` and the item's default UOM (``stock_uom``). Idempotent:
		items that already have a barcode row equal to their code are left
		untouched.
		"""
		if not self.item_code:
			return
		if any(row.barcode == self.item_code for row in self.barcodes):
			return
		self.append(
			"barcodes",
			{
				"barcode": self.item_code,
				"barcode_type": "CODE-39",
				"uom": self.stock_uom,
			},
		)

	def _validate_item_code_unique(self):
		"""Block manually typed codes that collide with existing items."""
		if not self.item_code:
			return

		existing = frappe.db.exists("Item", self.item_code)
		if existing and existing != self.name:
			frappe.throw(
				_("Item Code {0} is already in use by Item {1}.").format(
					frappe.bold(self.item_code),
					frappe.bold(existing),
				)
			)
