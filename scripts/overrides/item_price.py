import frappe
from erpnext.stock.doctype.item_price.item_price import ItemPrice


class CustomItemPrice(ItemPrice):
	def validate_item_template(self):
		"""Allow creating Item Price for template items.

		ERPNext v15+ blocks Item Prices for template items (items with
		``has_variants = 1``). This override removes that restriction so
		you can set a single price on the template and all variants will
		inherit it automatically.

		The variant→template price fallback already exists in
		``erpnext.stock.get_item_details.get_price_list_rate`` (line ~1043),
		so no additional changes are needed on the fetching side.
		"""
		pass
