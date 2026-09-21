import frappe
from frappe import _
from frappe.model.document import Document

from scripts.utils.get_origin_doc import get_origin_doc


def propagate_chosen_fabric(doc: Document, method):
	if doc.sales_order and doc.sales_order_item:
		template_fabric_code = "ANYAG"

		# Stock SO has no fabric columns - degrade to no-op instead of
		# raising Unknown column on every Work Order save.
		try:
			fields = [f for f in ("custom_anyag", "fabric") if frappe.db.has_column("Sales Order Item", f)]
			if not fields:
				return
			chosen_fabric = frappe.db.get_value(
				"Sales Order Item",
				doc.sales_order_item,
				fields,
				as_dict=True,
			)
		except Exception:
			return
		chosen_fabric = (
			(chosen_fabric.get("custom_anyag") or chosen_fabric.get("fabric")) if chosen_fabric else None
		)

		if chosen_fabric:
			item_data = (
				frappe.db.get_value(
					"Item", chosen_fabric, ["item_name", "description", "stock_uom"], as_dict=True
				)
				or {}
			)

			for req_item in doc.required_items:
				if req_item.item_code == template_fabric_code:
					req_item.item_code = chosen_fabric
					req_item.item_name = item_data.get("item_name")
					req_item.description = item_data.get("description")
					req_item.stock_uom = item_data.get("stock_uom")
					req_item.original_item = template_fabric_code

					frappe.msgprint(
						f"Az alapanyag automatikusan lecserélve a vevő választására: {chosen_fabric}",
						alert=True,
					)
